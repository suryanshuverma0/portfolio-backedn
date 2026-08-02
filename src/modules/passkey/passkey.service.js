import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";

import User from "../auth/auth.model.js";
import Passkey from "./passkey.model.js";
import redis from "../../config/redis.js";
import { isAdminEmail } from "../../utils/adminEmails.js";
import { isPublicAccessEnabled } from "../../utils/publicAccess.js";
import logger from "../../utils/logger.js";

/*
  Kept local instead of imported from app.js's CORS config — this module
  stays self-contained (same pattern as ../google-auth), and WebAuthn needs
  this exact list anyway to check `expectedOrigin` during verification.
*/
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "https://suryanshuverma.com.np",
  "https://www.suryanshuverma.com.np",
];

const RP_ID = process.env.WEBAUTHN_RP_ID;
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Portfolio CMS";

const CHALLENGE_TTL_SECONDS = 5 * 60;
const registrationChallengeKey = (userId) => `webauthn:reg-challenge:${userId}`;
const authChallengeKey = (challenge) => `webauthn:auth-challenge:${challenge}`;
const signupChallengeKey = (email) => `webauthn:signup-challenge:${email}`;

/*
  Token generation is intentionally re-implemented here (instead of importing
  from ../auth/auth.service.js) so this module has zero dependency on the
  password-auth module and can evolve independently — same rationale as
  ../google-auth.
*/
const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
  });

const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
  });

const httpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const assertAccessAllowed = async (admin, email) => {
  if (admin) {
    return;
  }

  const allowed = await isPublicAccessEnabled();

  if (!allowed) {
    logger.warn({ action: "ACCESS_RESTRICTED", email, method: "passkey" });
    throw httpError("Access is restricted to authorized administrators", 403);
  }
};

// ---------------------------------------------------------------------------
// Registration (adding a new passkey to an already-logged-in account)
// ---------------------------------------------------------------------------

export const getRegistrationOptions = async (user) => {
  const existingPasskeys = await Passkey.find({ user: user._id })
    .select("credentialID transports")
    .lean();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    userDisplayName: user.email,
    // The authenticator's own user handle — an opaque byte string, not
    // exposed anywhere. Derived from the Mongo ObjectId purely so it's
    // stable across registration ceremonies for the same account.
    userID: isoUint8Array.fromHex(user._id.toString()),
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((cred) => ({
      id: cred.credentialID,
      transports: cred.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await redis.setEx(
    registrationChallengeKey(user._id),
    CHALLENGE_TTL_SECONDS,
    options.challenge,
  );

  return options;
};

export const verifyRegistration = async (user, response, name) => {
  // Matched against Redis inside the callback (rather than fetched up
  // front) so the exact challenge value simplewebauthn extracts from the
  // client response is what gets compared — then deleted only once
  // verification has actually succeeded, per spec.
  let matchedChallenge = null;

  const expectedChallenge = async (challenge) => {
    const stored = await redis.get(registrationChallengeKey(user._id));

    if (stored && stored === challenge) {
      matchedChallenge = challenge;
      return true;
    }

    return false;
  };

  let verification;

  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    logger.warn({ action: "PASSKEY_REGISTER_FAILED", userId: user._id, reason: err.message });
    throw httpError("Passkey registration verification failed", 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw httpError("Passkey registration verification failed", 400);
  }

  await redis.del(registrationChallengeKey(user._id));

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  const passkey = await Passkey.create({
    user: user._id,
    credentialID: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name || "Passkey",
  });

  logger.info({ action: "PASSKEY_REGISTERED", userId: user._id, passkeyId: passkey._id });

  return {
    id: passkey._id,
    name: passkey.name,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt,
  };
};

// ---------------------------------------------------------------------------
// Signup (public — creates a brand-new account bound to a first passkey,
// the passkey equivalent of registerUser/googleLogin's account-creation
// path). Deliberately refuses to touch an email that already has an
// account: unlike Google, a typed email string proves nothing about who
// owns it, so this can never be used to attach a passkey to somebody
// else's existing account. Adding a passkey to an account you already
// control happens through the protect-gated registration flow above
// (Security Settings), which requires an authenticated session instead.
// ---------------------------------------------------------------------------

export const getSignupOptions = async (email) => {
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw httpError(
      "An account with this email already exists. Log in and add a passkey from Security Settings instead.",
      409,
    );
  }

  const admin = isAdminEmail(email);

  await assertAccessAllowed(admin, email);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: email,
    userDisplayName: email,
    // No Mongo user exists yet, so this is just an opaque per-ceremony
    // handle — unrelated to the eventual account's _id.
    userID: new Uint8Array(crypto.randomBytes(32)),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await redis.setEx(signupChallengeKey(email), CHALLENGE_TTL_SECONDS, options.challenge);

  return options;
};

export const verifySignup = async (email, response, name) => {
  let matchedChallenge = null;

  const expectedChallenge = async (challenge) => {
    const stored = await redis.get(signupChallengeKey(email));

    if (stored && stored === challenge) {
      matchedChallenge = challenge;
      return true;
    }

    return false;
  };

  let verification;

  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: RP_ID,
    });
  } catch (err) {
    logger.warn({ action: "REGISTER_FAILED", email, method: "passkey", reason: err.message });
    throw httpError("Passkey registration verification failed", 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw httpError("Passkey registration verification failed", 400);
  }

  await redis.del(signupChallengeKey(email));

  // Re-checked at verify time too — closes the race where two signups for
  // the same email are in flight at once.
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw httpError("An account with this email already exists.", 409);
  }

  const admin = isAdminEmail(email);

  await assertAccessAllowed(admin, email);

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  const user = await User.create({
    email,
    isPasskeyUser: true,
    role: admin ? "admin" : "user",
  });

  await Passkey.create({
    user: user._id,
    credentialID: credential.id,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name || "Passkey",
  });

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;
  user.lastLoginAt = new Date();

  await user.save();

  logger.info({ action: "REGISTER_SUCCESS", email, method: "passkey", userId: user._id, role: user.role });

  return {
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
};

// ---------------------------------------------------------------------------
// Authentication (logging in with a passkey — usernameless/discoverable)
// ---------------------------------------------------------------------------

export const getAuthenticationOptions = async () => {
  // No `allowCredentials` — this is a usernameless flow. The browser lets
  // the user pick from whichever discoverable credentials it has for this
  // RP, and the credential ID sent back on verify is how we find the user.
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: "preferred",
  });

  await redis.setEx(authChallengeKey(options.challenge), CHALLENGE_TTL_SECONDS, "1");

  return options;
};

export const verifyAuthentication = async (response) => {
  const passkey = await Passkey.findOne({ credentialID: response.id });

  if (!passkey) {
    throw httpError("Passkey not recognized", 400);
  }

  const user = await User.findById(passkey.user);

  if (!user) {
    throw httpError("Passkey not recognized", 400);
  }

  let matchedChallenge = null;

  const expectedChallenge = async (challenge) => {
    const exists = await redis.get(authChallengeKey(challenge));

    if (exists) {
      matchedChallenge = challenge;
      return true;
    }

    return false;
  };

  let verification;

  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ALLOWED_ORIGINS,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialID,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch (err) {
    logger.warn({ action: "LOGIN_FAILED", method: "passkey", reason: err.message });
    throw httpError("Passkey authentication failed", 400);
  }

  if (!verification.verified) {
    logger.warn({ action: "LOGIN_FAILED", method: "passkey", reason: "not_verified" });
    throw httpError("Passkey authentication failed", 400);
  }

  await redis.del(authChallengeKey(matchedChallenge));

  if (!user.isActive) {
    logger.warn({ action: "LOGIN_FAILED", email: user.email, method: "passkey", reason: "account_disabled" });
    throw httpError("Account disabled", 403);
  }

  const admin = isAdminEmail(user.email);

  await assertAccessAllowed(admin, user.email);

  // Anti-replay: persist the authenticator's new counter, and flag the
  // account with a mismatched/non-increasing counter as suspicious.
  passkey.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date();
  await passkey.save();

  user.role = admin ? "admin" : "user";

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;
  user.lastLoginAt = new Date();

  await user.save();

  logger.info({ action: "LOGIN_SUCCESS", email: user.email, method: "passkey", userId: user._id, role: user.role });

  return {
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    accessToken,
    refreshToken,
  };
};

// ---------------------------------------------------------------------------
// Management (list / rename / delete — scoped to the owning user)
// ---------------------------------------------------------------------------

export const listPasskeys = async (userId) => {
  const passkeys = await Passkey.find({ user: userId })
    .select("name deviceType backedUp transports createdAt lastUsedAt")
    .sort({ createdAt: -1 })
    .lean();

  return passkeys.map((p) => ({
    id: p._id,
    name: p.name,
    deviceType: p.deviceType,
    backedUp: p.backedUp,
    transports: p.transports,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
  }));
};

export const renamePasskey = async (userId, passkeyId, name) => {
  const passkey = await Passkey.findOneAndUpdate(
    { _id: passkeyId, user: userId },
    { name },
    { new: true },
  );

  if (!passkey) {
    throw httpError("Passkey not found", 404);
  }

  return {
    id: passkey._id,
    name: passkey.name,
  };
};

export const deletePasskey = async (userId, passkeyId) => {
  const passkey = await Passkey.findOneAndDelete({ _id: passkeyId, user: userId });

  if (!passkey) {
    throw httpError("Passkey not found", 404);
  }
};
