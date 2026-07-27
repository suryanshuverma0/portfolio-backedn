import express from "express";

import validate from "../../middleware/validate.middleware.js";
import protect from "../../middleware/auth.middleware.js";
import requirePasswordAuthEnabled from "../../middleware/passwordAuthGate.middleware.js";

import {
  registerLimiter,
  loginLimiter,
  forgotPasswordLimiter,
  refreshTokenLimiter,
} from "../../middleware/limiters.js";

import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./auth.validation.js";

import {
  registerController,
  loginController,
  forgotPasswordController,
  resetPasswordController,
  logoutController,
  getMeController,
  refreshTokenController,
} from "./auth.controller.js";

const router = express.Router();

router.post(
  "/register",
  registerLimiter,
  requirePasswordAuthEnabled,
  validate(registerSchema),
  registerController,
);

router.post(
  "/login",
  loginLimiter,
  requirePasswordAuthEnabled,
  validate(loginSchema),
  loginController,
);

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  requirePasswordAuthEnabled,
  validate(forgotPasswordSchema),
  forgotPasswordController,
);

router.post(
  "/reset-password/:token",
  forgotPasswordLimiter,
  requirePasswordAuthEnabled,
  validate(resetPasswordSchema),
  resetPasswordController,
);

router.post("/refresh-token", refreshTokenLimiter, refreshTokenController);

router.post("/logout", protect, logoutController);

router.get("/me", protect, getMeController);

export default router;
