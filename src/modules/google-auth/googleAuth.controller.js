import { googleLogin } from "./googleAuth.service.js";

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

    const { user, accessToken, refreshToken } = await googleLogin(credential);

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
