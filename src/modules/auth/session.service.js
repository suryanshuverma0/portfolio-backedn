import crypto from "crypto";
import jwt from "jsonwebtoken";

import AuthSession from "./session.model.js";
import User from "./auth.model.js";
import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";
import { getVisitorNetworkMeta } from "../analytics/analytics.utils.js";
import { lookupIp } from "../analytics/geo.service.js";

// ---------------------------------------------------------------------------
// Signed-in device sessions: issuing, rotating and revoking refresh tokens.
//
// Revocation must also stop the (short-lived) access token at once, so a
// revoked session id is parked in Redis for longer than any access token
// lives; the auth middleware rejects tokens carrying it.
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 60 * 1000;
const REVOKED_TTL_SECONDS = 24 * 60 * 60;
const MAX_ACTIVE_SESSIONS = 20;

const isProduction = () => process.env.NODE_ENV === "production";

export const accessCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: "none",
  maxAge: 15 * 60 * 1000,
});

export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: "none",
  maxAge: SESSION_TTL_MS,
});

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie("accessToken", accessToken, accessCookieOptions());
  if (refreshToken) res.cookie("refreshToken", refreshToken, refreshCookieOptions());
  return res;
};

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const newJti = () => crypto.randomBytes(24).toString("base64url");

const signAccess = (userId, sid) =>
  jwt.sign({ id: String(userId), sid: String(sid) }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
  });

const signRefresh = (userId, sid, jti) =>
  jwt.sign({ id: String(userId), sid: String(sid), jti }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
  });

const revokedKey = (sid) => `auth:revoked:${sid}`;

const unauthorized = (message) => {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
};

const deviceContext = (req) => {
  const meta = getVisitorNetworkMeta(req);

  return {
    ip: meta.ip,
    lastIp: meta.ip,
    location: meta.location
      ? { country: meta.location.country, city: meta.location.city, region: meta.location.regionName || meta.location.region }
      : undefined,
    userAgent: meta.userAgent,
    device: meta.device,
    browser: [meta.browser, meta.browserVersion].filter(Boolean).join(" "),
    os: [meta.os, meta.osVersion].filter(Boolean).join(" "),
  };
};

const enrichLocation = async (sessionId, ip) => {
  const online = await lookupIp(ip);
  if (!online?.location?.country) return;

  await AuthSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        location: {
          country: online.location.country,
          city: online.location.city,
          region: online.location.regionName || online.location.region,
        },
        network: online.network?.org,
      },
    },
  );
};

/* ---------- issue ---------- */

// Called after any successful sign-in. Returns fresh tokens bound to a new
// session for this device.
export const startSession = async (req, user, method) => {
  const userId = user._id || user.id;
  const jti = newJti();
  const context = deviceContext(req);

  const session = await AuthSession.create({
    userId,
    method,
    tokenHash: hash(jti),
    ...context,
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });

  enrichLocation(session._id, context.ip).catch(() => {});
  pruneSessions(userId).catch(() => {});

  return {
    sessionId: String(session._id),
    accessToken: signAccess(userId, session._id),
    refreshToken: signRefresh(userId, session._id, jti),
  };
};

// Keeps the newest MAX_ACTIVE_SESSIONS; older devices are signed out.
const pruneSessions = async (userId) => {
  const stale = await AuthSession.find({ userId, revokedAt: null })
    .sort({ lastUsedAt: -1 })
    .skip(MAX_ACTIVE_SESSIONS)
    .select("_id")
    .lean();

  await Promise.all(stale.map((s) => revokeSession(userId, s._id, "limit")));
};

/* ---------- refresh ---------- */

// Returns { accessToken, refreshToken? }. refreshToken is omitted when a
// parallel request already rotated it (the browser holds the new one).
export const rotateSession = async (refreshToken, req, { onReuse } = {}) => {
  if (!refreshToken) throw unauthorized("Refresh token missing");

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch {
    throw unauthorized("Invalid refresh token");
  }

  const user = await User.findById(decoded.id).select("+refreshToken");
  if (!user) throw unauthorized("User not found");
  if (!user.isActive) throw unauthorized("Account disabled");

  // Tokens issued before device sessions existed: honour them once and move
  // the device onto a proper session.
  if (!decoded.sid) {
    if (!user.refreshToken || user.refreshToken !== refreshToken) throw unauthorized("Invalid refresh token");

    user.refreshToken = "";
    await user.save({ validateBeforeSave: false });

    return startSession(req, user, "legacy");
  }

  const session = await AuthSession.findOne({ _id: decoded.sid, userId: user._id });

  if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized("Session ended");

  const presented = hash(decoded.jti || "");
  const ip = getVisitorNetworkMeta(req).ip;

  if (presented === session.tokenHash) {
    const jti = newJti();

    const rotated = await AuthSession.findOneAndUpdate(
      { _id: session._id, tokenHash: presented },
      {
        $set: {
          tokenHash: hash(jti),
          prevTokenHash: presented,
          rotatedAt: new Date(),
          lastUsedAt: new Date(),
          lastIp: ip,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      },
      { returnDocument: "after" },
    );

    // Lost the race to a parallel refresh — fall through to the grace check.
    if (rotated) {
      return { sessionId: String(session._id), accessToken: signAccess(user._id, session._id), refreshToken: signRefresh(user._id, session._id, jti) };
    }
  }

  const fresh = await AuthSession.findById(session._id).lean();

  if (fresh?.prevTokenHash === presented && Date.now() - new Date(fresh.rotatedAt) < ROTATION_GRACE_MS) {
    return { sessionId: String(session._id), accessToken: signAccess(user._id, session._id) };
  }

  // An already-used refresh token: someone has a copy of it.
  await revokeSession(user._id, session._id, "token_reuse");
  logger.warn({ action: "REFRESH_TOKEN_REUSE", userId: String(user._id), sessionId: String(session._id), ip });
  onReuse?.({ user, session, ip });

  throw unauthorized("Session ended for your security — please sign in again");
};

/* ---------- revoke ---------- */

export const revokeSession = async (userId, sessionId, reason = "signed_out") => {
  const result = await AuthSession.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  await redis.setEx(revokedKey(sessionId), REVOKED_TTL_SECONDS, reason).catch((error) =>
    logger.warn({ action: "SESSION_REVOKE_CACHE_FAILED", error: error.message }),
  );

  return result.modifiedCount > 0;
};

export const revokeAllSessions = async (userId, reason = "signed_out_everywhere", { except } = {}) => {
  const filter = { userId, revokedAt: null };
  if (except) filter._id = { $ne: except };

  const sessions = await AuthSession.find(filter).select("_id").lean();
  await Promise.all(sessions.map((s) => revokeSession(userId, s._id, reason)));

  return sessions.length;
};

// Used by the auth middleware on every request.
export const isSessionRevoked = async (sid) => {
  if (!sid) return false;

  try {
    return Boolean(await redis.exists(revokedKey(sid)));
  } catch {
    // Redis down: don't lock everyone out; refresh still checks Mongo.
    return false;
  }
};

export const sessionIdFromRequest = (req) => {
  for (const [name, secret] of [
    ["accessToken", process.env.ACCESS_TOKEN_SECRET],
    ["refreshToken", process.env.REFRESH_TOKEN_SECRET],
  ]) {
    const token = req.cookies?.[name];
    if (!token) continue;

    try {
      const decoded = jwt.verify(token, secret, { ignoreExpiration: true });
      if (decoded.sid) return decoded.sid;
    } catch {
      /* try the next cookie */
    }
  }

  return null;
};

/* ---------- list ---------- */

const REVOKE_LABELS = {
  signed_out: "Signed out",
  remote: "Signed out remotely",
  signed_out_everywhere: "Signed out everywhere",
  password_reset: "Password reset",
  token_reuse: "Ended — token reuse detected",
  limit: "Too many devices",
  account_deleted: "Account removed",
};

const present = (session, currentSid) => ({
  id: String(session._id),
  current: String(session._id) === String(currentSid),
  method: session.method,
  ip: session.lastIp || session.ip,
  firstIp: session.ip,
  location: session.location,
  network: session.network,
  device: session.device,
  browser: session.browser,
  os: session.os,
  createdAt: session.createdAt,
  lastUsedAt: session.lastUsedAt,
  expiresAt: session.expiresAt,
  revokedAt: session.revokedAt,
  revokedReason: session.revokedReason ? REVOKE_LABELS[session.revokedReason] || session.revokedReason : null,
});

export const listSessions = async (userId, currentSid) => {
  const now = new Date();

  const [active, ended] = await Promise.all([
    AuthSession.find({ userId, revokedAt: null, expiresAt: { $gt: now } }).sort({ lastUsedAt: -1 }).lean(),
    AuthSession.find({ userId, $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lte: now } }] })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  return {
    active: active.map((s) => present(s, currentSid)),
    recent: ended.map((s) => present(s, currentSid)),
  };
};
