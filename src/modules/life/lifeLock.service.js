import crypto from "crypto";
import mongoose from "mongoose";
import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";

import redis from "../../config/redis.js";
import Passkey from "../passkey/passkey.model.js";
import { verifyMfaCode } from "../auth/mfa.service.js";
import { notifySecurityEvent } from "../alerts/alerts.service.js";
import logger from "../../utils/logger.js";

/* ---------------------------------------------------------------------------
   LIFE LOCK — a second lock, on top of the admin sign-in, in front of the
   personal side (notes, planner, vault, …).

   - A passphrase only the owner knows, stored as scrypt (N=2^15).
   - Unlocking sets an httpOnly cookie holding an HMAC-signed token bound to
     the user, the lock "version" and an idle deadline. Every personal
     request slides the deadline; idle past it and the area locks itself.
     Changing the passphrase or pressing "Lock" bumps the version, which
     kills every outstanding unlock on every device.
   - Wrong passphrases: 5 tries, then a lockout that doubles each time
     (15 min → 30 → 60 …, max 24 h) plus a security alert.
   - Forgotten passphrase: the one-time recovery code, a passkey
     (fingerprint / face / device PIN, user verification required), or an
     authenticator code if MFA is on. Each gives a 5-minute reset grant.
--------------------------------------------------------------------------- */

const lifeLockSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    passphraseHash: { type: String, required: true },
    recoveryHash: { type: String, required: true },
    version: { type: Number, default: 1 },
    autoLockMinutes: { type: Number, default: 15, min: 1, max: 240 },
    failedAttempts: { type: Number, default: 0 },
    lockouts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastUnlockedAt: { type: Date, default: null },
    passphraseChangedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const LifeLock = mongoose.models.LifeLock || mongoose.model("LifeLock", lifeLockSchema);

export const COOKIE = "lifeUnlock";
const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // hard cap, even if active
const MAX_TRIES = 5;
const GRANT_TTL = 5 * 60;
const CHALLENGE_TTL = 5 * 60;
const RP_ID = process.env.WEBAUTHN_RP_ID;
const ORIGINS = ["http://localhost:5173", "https://suryanshuverma.com.np", "https://www.suryanshuverma.com.np"];

const httpError = (message, statusCode = 400, code) => Object.assign(new Error(message), { statusCode, code });
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

/* ---------- passphrase hashing ---------- */

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const scrypt = (secret, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(secret.normalize("NFKC"), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );

const hashPassphrase = async (passphrase) => {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(passphrase, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
};

const checkPassphrase = async (passphrase, stored) => {
  const [, , , , salt, hash] = String(stored).split("$");
  if (!salt || !hash) return false;
  const key = await scrypt(String(passphrase), Buffer.from(salt, "base64"));
  const expected = Buffer.from(hash, "base64");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
};

const newRecoveryCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{5}/g).join("-"); // 20 chars ≈ 100 bits
};
const normRecovery = (code) => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* ---------- unlock token ---------- */

const key = () => crypto.createHash("sha256").update(`life-lock:${process.env.ACCESS_TOKEN_SECRET}`).digest();
const sign = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
};
const verify = (token) => {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", key()).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  path: "/api/v1",
  maxAge,
});

export const issueUnlock = (res, lock, startedAt = Date.now()) => {
  const idleMs = lock.autoLockMinutes * 60 * 1000;
  const exp = Math.min(Date.now() + idleMs, startedAt + MAX_SESSION_MS);
  res.cookie(COOKIE, sign({ uid: String(lock.user), v: lock.version, exp, st: startedAt }), cookieOptions(exp - Date.now()));
  return exp;
};

export const clearUnlock = (res) => res.clearCookie(COOKIE, { ...cookieOptions(0), maxAge: undefined });

export const getLock = (userId) => LifeLock.findOne({ user: userId });

// { configured, unlocked, lock, token } for this request.
export const readUnlock = async (req) => {
  const lock = await getLock(req.user._id);
  if (!lock) return { configured: false, unlocked: false, lock: null };
  const token = verify(req.cookies?.[COOKIE]);
  const unlocked = Boolean(token && token.uid === String(req.user._id) && token.v === lock.version && token.exp > Date.now());
  return { configured: true, unlocked, lock, token };
};

/* ---------- status / setup ---------- */

export const status = async (req) => {
  const { configured, unlocked, lock, token } = await readUnlock(req);
  const passkeys = await Passkey.countDocuments({ user: req.user._id });
  return {
    configured,
    unlocked,
    expiresAt: unlocked ? token.exp : null,
    autoLockMinutes: lock?.autoLockMinutes ?? 15,
    lockedUntil: lock?.lockedUntil && lock.lockedUntil > new Date() ? lock.lockedUntil : null,
    passkeys,
    mfa: Boolean(req.user.is2FAEnabled),
    passphraseChangedAt: lock?.passphraseChangedAt || null,
  };
};

const assertStrong = (passphrase) => {
  const p = String(passphrase || "");
  if (p.length < 8) throw httpError("Use at least 8 characters — a short sentence works well");
  if (p.length > 200) throw httpError("That passphrase is too long");
  if (/^(.)\1+$/.test(p) || /^(0123|1234|abcd|pass|qwer)/i.test(p)) throw httpError("That passphrase is too easy to guess");
};

export const setup = async (req, res, { passphrase, autoLockMinutes }) => {
  if (await getLock(req.user._id)) throw httpError("The life lock is already set up", 409);
  assertStrong(passphrase);
  const recoveryCode = newRecoveryCode();
  const lock = await LifeLock.create({
    user: req.user._id,
    passphraseHash: await hashPassphrase(passphrase),
    recoveryHash: sha(normRecovery(recoveryCode)),
    autoLockMinutes: autoLockMinutes || 15,
    lastUnlockedAt: new Date(),
  });
  issueUnlock(res, lock);
  logger.info({ action: "LIFE_LOCK_SETUP", userId: req.user._id });
  return { recoveryCode };
};

/* ---------- unlock / lock ---------- */

const assertNotLockedOut = (lock) => {
  if (lock.lockedUntil && lock.lockedUntil > new Date()) {
    const minutes = Math.ceil((lock.lockedUntil - Date.now()) / 60000);
    throw httpError(`Too many wrong tries — try again in ${minutes} min, or use fingerprint / recovery`, 429, "LIFE_LOCKED_OUT");
  }
};

const registerFailure = async (lock, ip) => {
  lock.failedAttempts += 1;
  if (lock.failedAttempts >= MAX_TRIES) {
    const minutes = Math.min(15 * 2 ** lock.lockouts, 24 * 60);
    lock.lockedUntil = new Date(Date.now() + minutes * 60 * 1000);
    lock.lockouts += 1;
    lock.failedAttempts = 0;
    notifySecurityEvent({
      title: "Life area locked after wrong passphrases",
      body: `${MAX_TRIES} wrong passphrases in a row. Unlocking is paused for ${minutes} minutes. If this wasn't you, change your admin password now.`,
      link: "/dashboard/life",
      ip,
    }).catch(() => {});
  }
  await lock.save();
};

const unlockSucceeded = async (res, lock) => {
  lock.failedAttempts = 0;
  lock.lockouts = 0;
  lock.lockedUntil = null;
  lock.lastUnlockedAt = new Date();
  await lock.save();
  return { expiresAt: issueUnlock(res, lock) };
};

export const unlock = async (req, res, { passphrase }) => {
  const lock = await getLock(req.user._id);
  if (!lock) throw httpError("Set up the life lock first", 409, "LIFE_SETUP_REQUIRED");
  assertNotLockedOut(lock);
  if (!(await checkPassphrase(passphrase, lock.passphraseHash))) {
    await registerFailure(lock, req.ip);
    const left = lock.lockedUntil ? 0 : MAX_TRIES - lock.failedAttempts;
    throw httpError(left ? `That's not it — ${left} ${left === 1 ? "try" : "tries"} left` : "Too many wrong tries — unlocking is paused", left ? 403 : 429);
  }
  return unlockSucceeded(res, lock);
};

// "Lock now" — also signs out every other device's unlock.
export const lockNow = async (req, res) => {
  await LifeLock.updateOne({ user: req.user._id }, { $inc: { version: 1 } });
  clearUnlock(res);
  return true;
};

/* ---------- change / settings ---------- */

export const changePassphrase = async (req, res, { current, next }) => {
  const lock = await getLock(req.user._id);
  if (!lock) throw httpError("Set up the life lock first", 409);
  assertNotLockedOut(lock);
  if (!(await checkPassphrase(current, lock.passphraseHash))) {
    await registerFailure(lock, req.ip);
    throw httpError("Your current passphrase isn't right", 403);
  }
  assertStrong(next);
  lock.passphraseHash = await hashPassphrase(next);
  lock.passphraseChangedAt = new Date();
  lock.version += 1;
  await unlockSucceeded(res, lock);
  notifySecurityEvent({ title: "Life passphrase changed", body: "Other devices were locked.", link: "/dashboard/life", ip: req.ip }).catch(() => {});
  return true;
};

export const updateSettings = async (req, res, { autoLockMinutes }) => {
  const lock = await getLock(req.user._id);
  if (!lock) throw httpError("Set up the life lock first", 409);
  lock.autoLockMinutes = autoLockMinutes;
  await lock.save();
  const { token } = await readUnlock(req);
  issueUnlock(res, lock, token?.st);
  return { autoLockMinutes };
};

export const newRecovery = async (req, { passphrase }) => {
  const lock = await getLock(req.user._id);
  if (!lock || !(await checkPassphrase(passphrase, lock.passphraseHash))) throw httpError("Your passphrase isn't right", 403);
  const recoveryCode = newRecoveryCode();
  lock.recoveryHash = sha(normRecovery(recoveryCode));
  await lock.save();
  return { recoveryCode };
};

/* ---------- recovery ---------- */

const grantKey = (token) => `life:reset-grant:${sha(token)}`;
const issueGrant = async (userId) => {
  const token = crypto.randomBytes(24).toString("base64url");
  await redis.setEx(grantKey(token), GRANT_TTL, String(userId));
  return token;
};

// Recovery code or authenticator code → reset grant.
export const startReset = async (req, { method, code }) => {
  const lock = await getLock(req.user._id);
  if (!lock) throw httpError("Set up the life lock first", 409);
  // The recovery code is ~100 bits, so it works even during a lockout; a
  // 6-digit authenticator code does not.
  if (method === "mfa") assertNotLockedOut(lock);
  let ok = false;
  if (method === "recovery") ok = sha(normRecovery(code)) === lock.recoveryHash;
  else if (method === "mfa") ok = Boolean(await verifyMfaCode(req.user._id, code));
  if (!ok) {
    await registerFailure(lock, req.ip);
    throw httpError(method === "mfa" ? "That code didn't work" : "That recovery code isn't right", 403);
  }
  return { grant: await issueGrant(req.user._id) };
};

export const finishReset = async (req, res, { grant, next }) => {
  const userId = await redis.getDel(grantKey(grant));
  if (!userId || userId !== String(req.user._id)) throw httpError("That reset has expired — start again", 400);
  const lock = await getLock(req.user._id);
  assertStrong(next);
  const recoveryCode = newRecoveryCode();
  lock.passphraseHash = await hashPassphrase(next);
  lock.recoveryHash = sha(normRecovery(recoveryCode));
  lock.passphraseChangedAt = new Date();
  lock.version += 1;
  await unlockSucceeded(res, lock);
  notifySecurityEvent({ title: "Life passphrase was reset", body: "A recovery method was used to set a new passphrase. A new recovery code was issued.", link: "/dashboard/life", ip: req.ip }).catch(() => {});
  return { recoveryCode };
};

/* ---------- passkey (fingerprint / face / PIN) ---------- */

const challengeKey = (userId) => `life:webauthn:${userId}`;

export const passkeyOptions = async (req) => {
  const passkeys = await Passkey.find({ user: req.user._id }).select("credentialID transports").lean();
  if (!passkeys.length) throw httpError("Add a passkey in Security first — then your fingerprint can unlock this", 409);
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "required",
    allowCredentials: passkeys.map((p) => ({ id: p.credentialID, transports: p.transports })),
  });
  await redis.setEx(challengeKey(req.user._id), CHALLENGE_TTL, options.challenge);
  return options;
};

export const passkeyVerify = async (req, res, { response, purpose }) => {
  const lock = await getLock(req.user._id);
  if (!lock) throw httpError("Set up the life lock first", 409);
  const expectedChallenge = await redis.getDel(challengeKey(req.user._id));
  if (!expectedChallenge) throw httpError("That request expired — try again", 400);
  const passkey = await Passkey.findOne({ credentialID: response?.id, user: req.user._id });
  if (!passkey) throw httpError("That passkey isn't on this account", 400);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: { id: passkey.credentialID, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports },
    });
  } catch (error) {
    logger.warn({ action: "LIFE_PASSKEY_FAILED", reason: error.message });
    throw httpError("Fingerprint check failed", 400);
  }
  if (!verification.verified) throw httpError("Fingerprint check failed", 400);
  passkey.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date();
  await passkey.save();
  if (purpose === "reset") return { grant: await issueGrant(req.user._id) };
  return unlockSucceeded(res, lock);
};
