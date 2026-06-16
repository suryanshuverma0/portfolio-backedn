import crypto from "crypto";
import jwt from "jsonwebtoken";

import User from "./auth.model.js";

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
  const existingUser = await User.findOne({
    email,
  });

  if (existingUser) {
    throw new Error("User already exists");
  }

  const user = await User.create({
    email,
    password,
  });

  const accessToken = generateAccessToken(user._id);

  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;

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

export const loginUser = async (email, password) => {
  const user = await User.findOne({
    email,
  }).select("+password");

  if (!user) {
    throw new Error("Invalid credentials");
  }

  const isPasswordCorrect = await user.comparePassword(password);

  if (!isPasswordCorrect) {
    throw new Error("Invalid credentials");
  }

  const accessToken = generateAccessToken(user._id);

  const refreshToken = generateRefreshToken(user._id);

  user.refreshToken = refreshToken;

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

export const forgotPassword = async (email) => {
  const user = await User.findOne({
    email,
  });

  if (!user) {
    throw new Error("User not found");
  }

  const resetToken = crypto.randomBytes(32).toString("hex");

  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  user.passwordResetToken = hashedToken;

  user.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  await user.save();

  return resetToken;
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
    throw new Error("Invalid or expired token");
  }

  user.password = password;
 
  user.passwordResetToken = null;

  user.passwordResetExpires = null;

  await user.save();

  return {
    message: "Password reset successful",
  };
};

export const refreshAccessToken =
  async (refreshToken) => {
    if (!refreshToken) {
      throw new Error(
        "Refresh token missing",
      );
    }

    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_TOKEN_SECRET,
    );

    const user =
      await User.findById(decoded.id);

    if (!user) {
      throw new Error(
        "User not found",
      );
    }

    if (
      user.refreshToken !==
      refreshToken
    ) {
      throw new Error(
        "Invalid refresh token",
      );
    }

    const newAccessToken =
      generateAccessToken(user._id);

    return {
      accessToken:
        newAccessToken,
    };
  };

export const logoutUser = async (
  userId,
) => {
  await User.findByIdAndUpdate(
    userId,
    {
      refreshToken: "",
    },
  );
};
