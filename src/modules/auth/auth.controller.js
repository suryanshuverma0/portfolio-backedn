import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  refreshAccessToken,
  logoutUser,
} from "./auth.service.js";
import jwt from "jsonwebtoken";
export const registerController = async (req, res, next) => {
  try {
    const { email, password } = req.validatedData;

    const data = await registerUser(email, password);

    res
      .status(201)
      .cookie("accessToken", data.accessToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "strict",

        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", data.refreshToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "strict",

        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        success: true,

        message: "User registered successfully",

        data: data.user,
      });
  } catch (error) {
    next(error);
  }
};

export const loginController = async (req, res, next) => {
  try {
    const { email, password } = req.validatedData;

    const data = await loginUser(email, password);

    res
      .status(200)
      .cookie("accessToken", data.accessToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "strict",

        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", data.refreshToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "strict",

        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        success: true,

        message: "Login successful",

        data: data.user,
      });
  } catch (error) {
    next(error);
  }
};

export const forgotPasswordController = async (req, res, next) => {
  try {
    const { email } = req.validatedData;

    const resetToken = await forgotPassword(email);

    res.status(200).json({
      success: true,

      message: "Password reset token generated",

      resetToken,
    });
  } catch (error) {
    next(error);
  }
};

export const resetPasswordController = async (req, res, next) => {
  try {
    const { token } = req.params;

    const { password } = req.validatedData;

    const data = await resetPassword(token, password);

    res.status(200).json({
      success: true,

      message: data.message,
    });
  } catch (error) {
    next(error);
  }
};

export const logoutController = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      const decoded = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET,
      );

      await logoutUser(decoded.id);
    }

    res
      .clearCookie("accessToken")
      .clearCookie("refreshToken")
      .status(200)
      .json({
        success: true,

        message: "Logout successful",
      });
  } catch (error) {
    next(error);
  }
};

export const getMeController = async (req, res) => {
  res.status(200).json({
    success: true,

    user: req.user,
  });
};

export const refreshTokenController = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    const data = await refreshAccessToken(refreshToken);

    res
      .status(200)
      .cookie("accessToken", data.accessToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "strict",

        maxAge: 15 * 60 * 1000,
      })
      .json({
        success: true,

        message: "Access token refreshed",
      });
  } catch (error) {
    next(error);
  }
};
