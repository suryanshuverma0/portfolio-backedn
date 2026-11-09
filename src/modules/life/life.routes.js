import express from "express";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";
import requireLifeUnlock from "./requireLifeUnlock.middleware.js";
import * as lock from "./lifeLock.service.js";
import { lifeOverview } from "./life.overview.js";

const router = express.Router();
router.use(protectAdmin);

// Unlock attempts are also capped per IP, on top of the per-account lockout.
const unlockLimiter = slidingWindowLimiter({ prefix: "life-unlock", limit: 20, windowInSeconds: 15 * 60 });

const send = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    if (error.code && error.statusCode) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return next(error);
  }
};

const passphrase = z.string().min(1).max(200);
const minutes = z.number().int().min(1).max(240);

router.get("/lock", send((req) => lock.status(req)));
router.post("/lock/setup", unlockLimiter, validate(z.object({ passphrase, autoLockMinutes: minutes.optional() })), send((req, res) => lock.setup(req, res, req.validatedData)));
router.post("/lock/unlock", unlockLimiter, validate(z.object({ passphrase })), send((req, res) => lock.unlock(req, res, req.validatedData)));
router.post("/lock/lock", send((req, res) => lock.lockNow(req, res)));
router.post("/lock/passkey/options", unlockLimiter, send((req) => lock.passkeyOptions(req)));
router.post(
  "/lock/passkey/verify",
  unlockLimiter,
  validate(z.object({ response: z.object({ id: z.string().max(1024) }).passthrough(), purpose: z.enum(["unlock", "reset"]).default("unlock") })),
  send((req, res) => lock.passkeyVerify(req, res, req.validatedData)),
);
router.post(
  "/lock/reset/start",
  unlockLimiter,
  validate(z.object({ method: z.enum(["recovery", "mfa"]), code: z.string().trim().min(4).max(64) })),
  send((req) => lock.startReset(req, req.validatedData)),
);
router.post(
  "/lock/reset/finish",
  unlockLimiter,
  validate(z.object({ grant: z.string().min(10).max(100), next: passphrase })),
  send((req, res) => lock.finishReset(req, res, req.validatedData)),
);

// Everything below needs the area unlocked.
router.post("/lock/ping", requireLifeUnlock, send((req) => ({ expiresAt: req.lifeExpiresAt })));
router.post("/lock/change", requireLifeUnlock, unlockLimiter, validate(z.object({ current: passphrase, next: passphrase })), send((req, res) => lock.changePassphrase(req, res, req.validatedData)));
router.put("/lock/settings", requireLifeUnlock, validate(z.object({ autoLockMinutes: minutes })), send((req, res) => lock.updateSettings(req, res, req.validatedData)));
router.post("/lock/recovery-code", requireLifeUnlock, unlockLimiter, validate(z.object({ passphrase })), send((req) => lock.newRecovery(req, req.validatedData)));

router.get("/overview", requireLifeUnlock, send((req) => lifeOverview(req.query)));

export default router;
