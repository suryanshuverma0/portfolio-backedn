import jwt from "jsonwebtoken";

import User from "../auth/auth.model.js";
import googleClient from "../../utils/googleClient.js";
import { isAdminEmail } from "../../utils/adminEmails.js";

/*
  Token generation is intentionally re-implemented here (instead of importing
  from ../auth/auth.service.js) so this module has zero dependency on the
  password-auth module and can evolve independently.
*/
const generateAccessToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
  });
};

const generateRefreshToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
  });
};

export const googleLogin = async (credential) => {
  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    payload = ticket.getPayload();
  } catch {
    throw new Error("Invalid Google credential");
  }

  if (!payload) {
    throw new Error("Invalid Google credential");
  }

  const { sub: googleId, email, email_verified: emailVerified } = payload;

  if (!email || !emailVerified) {
    throw new Error("Google account email is not verified");
  }

  const normalizedEmail = email.toLowerCase();

  let user = await User.findOne({ googleId });

  if (!user) {
    user = await User.findOne({ email: normalizedEmail });

    if (user) {
      // Existing password account with the same (Google-verified) email.
      // Link the Google identity to it so the user can sign in either way.
      user.googleId = googleId;
      user.isGoogleUser = true;
    } else {
      user = new User({
        email: normalizedEmail,
        googleId,
        isGoogleUser: true,
      });
    }
  }

  if (!user.isActive) {
    throw new Error("Account disabled");
  }

  // Only emails on the ADMIN_EMAILS allowlist get admin access; everyone
  // else authenticates successfully but is left as a plain "user" (no
  // dashboard access). Re-checked on every login so the allowlist can be
  // grown later without needing manual DB edits.
  user.role = isAdminEmail(normalizedEmail) ? "admin" : "user";

  const accessToken = generateAccessToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;
  user.lastLoginAt = new Date();

  await user.save();

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
