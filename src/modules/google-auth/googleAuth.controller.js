import { googleLogin } from "./googleAuth.service.js";
import { recordLogin } from "../audit/audit.service.js";
import { startSession } from "../auth/session.service.js";
import { createChallenge } from "../auth/mfa.service.js";
import User from "../auth/auth.model.js";

/*
  Cookie options are duplicated from the password-auth controller on purpose,
  this module is kept fully self-contained rather than importing shared
  helpers from ../auth.
*/
const accessCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  maxAge: 15 * 60 * 1000,
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const googleLoginController = async (req, res, next) => {
  try {
    const { credential } = req.validatedData;

    let result;

    try {
      result = await googleLogin(credential);
    } catch (error) {
      recordLogin(req, { method: "google", success: false, reason: error.message });
      throw error;
    }

    const { user } = result;

    // Two-factor on: finish via POST /account/mfa/verify.
    const account = await User.findById(user.id || user._id).select("is2FAEnabled").lean();
    if (account?.is2FAEnabled) {
      const challenge = await createChallenge({ _id: user.id || user._id }, "google");
      return res.status(200).json({ success: true, message: "Enter your authentication code", data: { mfaRequired: true, challenge } });
    }

    recordLogin(req, { user, method: "google", success: true });

    const { accessToken, refreshToken } = await startSession(req, user, "google");

    res
      .status(200)
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .json({
        success: true,
        message: "Google login successful",
        data: user,
      });
  } catch (error) {
    next(error);
  }
};
