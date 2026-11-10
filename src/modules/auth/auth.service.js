import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

import User from "./auth.model.js";
import { isAdminEmail } from "../../utils/adminEmails.js";
import { isPublicAccessEnabled } from "../../utils/publicAccess.js";
import { sendPasswordResetEmail } from "../../utils/email.js";
import logger from "../../utils/logger.js";
import { revokeAllSessions } from "./session.service.js";

const restrictedAccessError = () => {
  const error = new Error(
    "Access is restricted to authorized administrators",
  );
  error.statusCode = 403;
  return error;
};

// Admin emails always pass; everyone else only passes while the admin has
// public access turned on in Settings.
const assertAccessAllowed = async (admin, email) => {
  if (admin) {
    return;
  }

  const allowed = await isPublicAccessEnabled();

  if (!allowed) {
    logger.warn({ action: "ACCESS_RESTRICTED", email });
    throw restrictedAccessError();
  }
};

const generateAccessToken = (userId) => {
  return jwt.sign(
    {
      id: userId,
    },

    process.env.ACCESS_TOKEN_SECRET,

    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    },
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    {
      id: userId,
    },

    process.env.REFRESH_TOKEN_SECRET,

    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    },
  );
};

export const registerUser = async (email, password) => {
  const admin = isAdminEmail(email);

  await assertAccessAllowed(admin, email);

  const existingUser = await User.findOne({
    email,
  });

  if (existingUser) {
    logger.warn({ action: "REGISTER_FAILED", email, reason: "already_exists" });
    throw Object.assign(new Error("User already exists"), { statusCode: 409 });
  }

  const user = await User.create({
    email,
    password,
    role: admin ? "admin" : "user",
  });

  const accessToken = generateAccessToken(user._id);

  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;

  await user.save();

  logger.info({ action: "REGISTER_SUCCESS", email, userId: user._id, role: user.role });

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

// Same message, status and timing for every credential failure, so the
// login form can't be used to find out which emails have accounts (or
// which sign in with Google). Unknown accounts still pay for a bcrypt
// comparison against a throwaway hash.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);
const badCredentials = () =>
  Object.assign(new Error("Invalid email or password. If you signed up with Google or a passkey, use that instead."), { statusCode: 401 });

export const loginUser = async (email, password) => {
  const user = await User.findOne({
    email,
  }).select("+password");

  // isGoogleUser alone isn't enough to block this — a linked account has
  // both a password AND Google, and should be able to use either. Only
  // accounts that never had a password set can't log in this way.
  if (!user || !user.password) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    logger.warn({ action: "LOGIN_FAILED", email, reason: user ? "no_password_set" : "no_account" });
    throw badCredentials();
  }

  const isPasswordCorrect = await user.comparePassword(password);

  if (!isPasswordCorrect) {
    logger.warn({ action: "LOGIN_FAILED", email, reason: "bad_password" });
    throw badCredentials();
  }

  // Only reveal account state to someone who knows the password.
  if (!user.isActive) {
    logger.warn({ action: "LOGIN_FAILED", email, reason: "account_disabled" });
    throw Object.assign(new Error("Account disabled"), { statusCode: 403 });
  }

  const admin = isAdminEmail(user.email);

  await assertAccessAllowed(admin, user.email);

  user.role = admin ? "admin" : "user";

  const accessToken = generateAccessToken(user._id);

  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;

  user.lastLoginAt = new Date();

  await user.save();

  logger.info({ action: "LOGIN_SUCCESS", email, userId: user._id, role: user.role });

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

export const forgotPassword = async (email) => {
  const user = await User.findOne({
    email,
  }).select("+password");

  // Deliberately silent no-op (not an error) for: no account, no password
  // set on this account (Google-only, nothing to reset), or access
  // currently restricted. The controller always returns the same generic
  // response either way, so this endpoint can't be used to enumerate
  // which emails have accounts.
  if (!user || !user.password) {
    return;
  }

  const admin = isAdminEmail(user.email);

  if (!admin) {
    const allowed = await isPublicAccessEnabled();

    if (!allowed) {
      return;
    }
  }

  const resetToken = crypto.randomBytes(32).toString("hex");

  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  user.passwordResetToken = hashedToken;

  user.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  // password wasn't selected in the query above, so the schema's
  // pre("validate") hook would wrongly treat it as missing — skip
  // validation since we're only touching the reset-token fields here.
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

  await sendPasswordResetEmail(user.email, resetUrl);
};

export const resetPassword = async (token, password) => {
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    passwordResetToken: hashedToken,

    passwordResetExpires: {
      $gt: Date.now(),
    },
  }).select("+passwordResetToken +passwordResetExpires");

  if (!user) {
    throw Object.assign(new Error("Invalid or expired token"), { statusCode: 400 });
  }

  await assertAccessAllowed(isAdminEmail(user.email), user.email);

  user.password = password;

  user.refreshToken = "";

  user.passwordResetToken = null;

  user.passwordResetExpires = null;

  await user.save();

  // A reset means the old password may be known — end every device.
  await revokeAllSessions(user._id, "password_reset");

  return {
    message: "Password reset successful",
  };
};

export const refreshAccessToken = async (refreshToken) => {
  if (!refreshToken) {
    throw Object.assign(new Error("Refresh token missing"), { statusCode: 401 });
  }

  const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

  const user = await User.findById(decoded.id).select("+refreshToken");

  if (!user) {
    throw Object.assign(new Error("Invalid refresh token"), { statusCode: 401 });
  }
  if (!user.isActive) {
    throw Object.assign(new Error("Account disabled"), { statusCode: 403 });
  }

  if (user.refreshToken !== refreshToken) {
    throw Object.assign(new Error("Invalid refresh token"), { statusCode: 401 });
  }

  const newAccessToken = generateAccessToken(user._id);

  return {
    accessToken: newAccessToken,
  };
};

export const logoutUser = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    refreshToken: "",
  });
};

export const getAllUsers = async () => {
  return User.find({})
    .select("email role isGoogleUser isActive createdAt lastLoginAt")
    .sort({ createdAt: -1 })
    .lean();
};

export const deleteUser = async (userId, requestingAdminId) => {
  if (String(userId) === String(requestingAdminId)) {
    const error = new Error("You can't delete your own account");
    error.statusCode = 400;
    throw error;
  }

  const deletedUser = await User.findByIdAndDelete(userId);

  if (!deletedUser) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  await revokeAllSessions(userId, "account_deleted");
};
