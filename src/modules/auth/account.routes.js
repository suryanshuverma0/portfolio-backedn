import crypto from "crypto";
import express from "express";
import { z } from "zod";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";
import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";
import { frontendUrl } from "../../utils/frontendUrl.js";
import User from "./auth.model.js";
import { startSession, setAuthCookies, revokeAllSessions } from "./session.service.js";
import { blockGuard } from "../blocklist/blocklist.service.js";
import { recordLogin } from "../audit/audit.service.js";
import { notifySecurityEvent, recordOffense } from "../security/security.service.js";
import { getClientIp, getVisitorNetworkMeta } from "../analytics/analytics.utils.js";

/* ---------------------------------------------------------------------------
   ACCOUNT — change password, and sign in on another device by QR code.

   QR sign-in: a signed-in screen asks for a one-time token (valid 2 min,
   single use, only its hash is stored). The QR encodes a link carrying the
   token in the URL fragment, so it never reaches server logs or analytics.
   The phone that opens it gets its own device session; the screen that
   showed the QR sees it was used, and a security alert is sent.
--------------------------------------------------------------------------- */

const router = express.Router();

const QR_TTL_SECONDS = 120;
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    next(error);
  }
};

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(128).optional(),
    newPassword: passwordSchema,
    signOutOthers: z.boolean().optional(),
  })
  .refine((d) => d.newPassword !== d.currentPassword, { message: "Choose a password different from your current one", path: ["newPassword"] });

const redeemSchema = z.object({ token: z.string().min(20).max(100) });

const changePasswordLimiter = slidingWindowLimiter({ prefix: "account-password", limit: 6, windowInSeconds: 15 * 60 });
const qrCreateLimiter = slidingWindowLimiter({ prefix: "account-qr-create", limit: 20, windowInSeconds: 10 * 60, countsAsOffense: false });
const qrRedeemLimiter = slidingWindowLimiter({ prefix: "account-qr-redeem", limit: 10, windowInSeconds: 60 });

const deviceName = (req) => {
  const meta = getVisitorNetworkMeta(req);
  return [meta.browser, meta.os].filter(Boolean).join(" on ") || "a new device";
};

/* ---------- public: redeem a QR sign-in ---------- */

router.post(
  "/qr/redeem",
  blockGuard(),
  qrRedeemLimiter,
  validate(redeemSchema),
  handle(async (req, res) => {
    const raw = await redis.getDel(`qr:login:${hash(req.validatedData.token)}`);
    if (!raw) {
      recordOffense(getClientIp(req), "login_failed");
      throw httpError("This code has expired or was already used. Show a new one on your signed-in screen.", 400);
    }

    const { userId, id } = JSON.parse(raw);
    const user = await User.findById(userId);
    if (!user || !user.isActive) throw httpError("Account unavailable", 403);

    const tokens = await startSession(req, user, "qr");
    setAuthCookies(res, tokens);

    const device = deviceName(req);
    await redis.set(`qr:status:${id}`, JSON.stringify({ status: "approved", device, at: Date.now() }), { EX: 300 });

    recordLogin(req, { user, method: "qr", success: true });
    notifySecurityEvent({
      title: "New device signed in with a QR code",
      body: `${device} was signed in to your admin panel by scanning a sign-in code.`,
      link: "/dashboard/security",
      ip: getClientIp(req),
    }).catch(() => {});

    return { ok: true, role: user.role };
  }),
);

/* ---------- everything below needs a signed-in user ---------- */

router.use(protect);

router.get("/password", handle(async (req) => ({ hasPassword: Boolean((await User.findById(req.user._id).select("+password").lean())?.password) })));

router.post(
  "/password",
  changePasswordLimiter,
  validate(changePasswordSchema),
  handle(async (req) => {
    const { currentPassword, newPassword, signOutOthers } = req.validatedData;
    const user = await User.findById(req.user._id).select("+password");
    if (!user) throw httpError("Account not found", 404);

    if (user.password) {
      if (!currentPassword) throw httpError("Enter your current password", 400);
      const ok = await user.comparePassword(currentPassword);
      if (!ok) {
        recordOffense(getClientIp(req), "login_failed");
        logger.warn({ action: "PASSWORD_CHANGE_FAILED", userId: String(user._id), reason: "bad_current" });
        throw httpError("Your current password is incorrect", 400);
      }
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    const signedOut = signOutOthers ? await revokeAllSessions(user._id, "password_changed", { except: req.sessionId }) : 0;

    logger.info({ action: "PASSWORD_CHANGED", userId: String(user._id), signedOut });
    notifySecurityEvent({
      title: "Your admin password was changed",
      body: signedOut ? `Changed from ${deviceName(req)}. ${signedOut} other device${signedOut === 1 ? " was" : "s were"} signed out.` : `Changed from ${deviceName(req)}.`,
      link: "/dashboard/security",
      ip: getClientIp(req),
    }).catch(() => {});

    return { hasPassword: true, signedOut };
  }),
);

router.post(
  "/qr",
  qrCreateLimiter,
  handle(async (req) => {
    const token = crypto.randomBytes(32).toString("base64url");
    const id = crypto.randomBytes(12).toString("base64url");

    await redis.set(`qr:login:${hash(token)}`, JSON.stringify({ userId: String(req.user._id), id }), { EX: QR_TTL_SECONDS });
    await redis.set(`qr:status:${id}`, JSON.stringify({ status: "pending" }), { EX: QR_TTL_SECONDS + 60 });

    return {
      id,
      url: `${frontendUrl()}/link-device#${token}`,
      expiresAt: new Date(Date.now() + QR_TTL_SECONDS * 1000).toISOString(),
    };
  }),
);

router.get(
  "/qr/:id",
  handle(async (req) => {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(req.params.id)) throw httpError("Invalid id", 400);
    const raw = await redis.get(`qr:status:${req.params.id}`);
    return raw ? JSON.parse(raw) : { status: "expired" };
  }),
);

export default router;
