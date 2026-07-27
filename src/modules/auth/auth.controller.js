import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  refreshAccessToken,
  logoutUser,
  getAllUsers,
  deleteUser,
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

        sameSite: "none",

        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", data.refreshToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "none",

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

        sameSite: "none",

        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", data.refreshToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "none",

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

    await forgotPassword(email);

    // Always the same response whether or not an account exists for this
    // email — forgotPassword() silently no-ops for unknown/ineligible
    // accounts so this endpoint can't be used to enumerate users.
    res.status(200).json({
      success: true,

      message:
        "If an account exists for that email, a reset link has been sent.",
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

export const getAllUsersController = async (req, res, next) => {
  try {
    const users = await getAllUsers();

    res.status(200).json({
      success: true,

      data: users,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteUserController = async (req, res, next) => {
  try {
    const { id } = req.params;

    await deleteUser(id, req.user._id);

    res.status(200).json({
      success: true,

      message: "User deleted",
    });
  } catch (error) {
    next(error);
  }
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

        sameSite: "none",

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
