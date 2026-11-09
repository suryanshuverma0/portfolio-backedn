import crypto from "crypto";

import User from "./auth.model.js";
import redis from "../../config/redis.js";
import { generateSecret, verifyTotp, otpauthUrl } from "../../utils/totp.js";
import { seal, open } from "../../utils/secretBox.js";

/* ---------------------------------------------------------------------------
   MFA — authenticator-app codes for password and Google sign-ins.

   Sign-in: credentials OK + MFA on → a short-lived challenge (5 min, 5
   tries) instead of a session; the session starts only after a valid
   6-digit code or one-time backup code. Passkey and QR sign-ins skip it
   (a passkey is already two factors; QR needs a signed-in device).
--------------------------------------------------------------------------- */

const ISSUER = "Suryanshu Verma Admin";
const SETUP_TTL = 10 * 60;
const CHALLENGE_TTL = 5 * 60;
const MAX_TRIES = 5;
const BACKUP_COUNT = 10;

const httpError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const normBackup = (code) => String(code || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const makeBackupCodes = () =>
  Array.from({ length: BACKUP_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });

const loadSecrets = (userId) => User.findById(userId).select("+twoFactorSecret +twoFactorBackupCodes +twoFactorLastStep");

// Checks a TOTP or backup code; consumes backup codes and records the step.
const checkCode = async (user, code) => {
  const clean = String(code || "").trim();
  if (/^\d{6}$/.test(clean.replace(/\s+/g, ""))) {
    const step = verifyTotp(open(user.twoFactorSecret), clean, { lastStep: user.twoFactorLastStep ?? -1 });
    if (step === null) return null;
    user.twoFactorLastStep = step;
    await user.save({ validateBeforeSave: false });
    return "totp";
  }
  const hashed = sha(normBackup(clean));
  const index = (user.twoFactorBackupCodes || []).indexOf(hashed);
  if (index === -1) return null;
  user.twoFactorBackupCodes.splice(index, 1);
  user.markModified("twoFactorBackupCodes");
  await user.save({ validateBeforeSave: false });
  return "backup";
};

// For step-up checks elsewhere (e.g. resetting the life lock).
export const verifyMfaCode = async (userId, code) => {
  const user = await loadSecrets(userId);
  if (!user?.is2FAEnabled) return null;
  return checkCode(user, code);
};

export const mfaStatus = async (userId) => {
  const user = await User.findById(userId).select("+twoFactorBackupCodes is2FAEnabled twoFactorEnabledAt");
  return {
    enabled: Boolean(user?.is2FAEnabled),
    enabledAt: user?.twoFactorEnabledAt || null,
    backupCodesLeft: user?.is2FAEnabled ? (user.twoFactorBackupCodes || []).length : 0,
  };
};

export const startSetup = async (user) => {
  if (user.is2FAEnabled) throw httpError("Two-factor sign-in is already on");
  const secret = generateSecret();
  await redis.set(`mfa:setup:${user._id}`, seal(secret), { EX: SETUP_TTL });
  return { secret, otpauthUrl: otpauthUrl({ secret, account: user.email, issuer: ISSUER }) };
};

export const confirmSetup = async (userId, code) => {
  const pending = await redis.get(`mfa:setup:${userId}`);
  if (!pending) throw httpError("Setup expired — start again");
  const secret = open(pending);
  const step = verifyTotp(secret, code);
  if (step === null) throw httpError("That code didn't match. Check the time on your phone and try the newest code.");

  const codes = makeBackupCodes();
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        is2FAEnabled: true,
        twoFactorSecret: seal(secret),
        twoFactorBackupCodes: codes.map((c) => sha(normBackup(c))),
        twoFactorLastStep: step,
        twoFactorEnabledAt: new Date(),
      },
    },
  );
  await redis.del(`mfa:setup:${userId}`);
  return { backupCodes: codes };
};

export const disable = async (userId, code) => {
  const user = await loadSecrets(userId);
  if (!user?.is2FAEnabled) return { enabled: false };
  if (!(await checkCode(user, code))) throw httpError("That code isn't valid");
  await User.updateOne(
    { _id: userId },
    { $set: { is2FAEnabled: false, twoFactorSecret: null, twoFactorBackupCodes: [], twoFactorLastStep: -1, twoFactorEnabledAt: null } },
  );
  return { enabled: false };
};

export const regenerateBackupCodes = async (userId, code) => {
  const user = await loadSecrets(userId);
  if (!user?.is2FAEnabled) throw httpError("Two-factor sign-in is off");
  if (!(await checkCode(user, code))) throw httpError("That code isn't valid");
  const codes = makeBackupCodes();
  await User.updateOne({ _id: userId }, { $set: { twoFactorBackupCodes: codes.map((c) => sha(normBackup(c))) } });
  return { backupCodes: codes };
};

/* ---------- sign-in challenge ---------- */

export const needsMfa = (user) => Boolean(user?.is2FAEnabled);

export const createChallenge = async (user, method) => {
  const token = crypto.randomBytes(32).toString("base64url");
  await redis.set(`mfa:challenge:${sha(token)}`, JSON.stringify({ userId: String(user._id), method, tries: 0 }), { EX: CHALLENGE_TTL });
  return token;
};

// Returns { user, method, via } on success; throws on failure.
export const redeemChallenge = async (token, code) => {
  const key = `mfa:challenge:${sha(String(token || ""))}`;
  const raw = await redis.get(key);
  if (!raw) throw httpError("Your sign-in timed out. Sign in again.", 401);

  const challenge = JSON.parse(raw);
  const user = await loadSecrets(challenge.userId);
  if (!user || !user.isActive || !user.is2FAEnabled) {
    await redis.del(key);
    throw httpError("Sign in again.", 401);
  }

  const via = await checkCode(user, code);
  if (!via) {
    challenge.tries += 1;
    if (challenge.tries >= MAX_TRIES) {
      await redis.del(key);
      throw httpError("Too many wrong codes. Sign in again.", 401);
    }
    const ttl = await redis.ttl(key);
    await redis.set(key, JSON.stringify(challenge), { EX: Math.max(1, ttl) });
    throw httpError(`That code isn't valid (${MAX_TRIES - challenge.tries} tries left)`);
  }

  await redis.del(key);
  return { user, method: challenge.method, via, backupCodesLeft: (user.twoFactorBackupCodes || []).length };
};
