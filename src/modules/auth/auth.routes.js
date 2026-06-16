import express from "express";

import validate from "../../middleware/validate.middleware.js";
import protect from "../../middleware/auth.middleware.js";

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
  validate(registerSchema),
  registerController
);

router.post(
  "/login",
  loginLimiter,
  validate(loginSchema),
  loginController
);

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validate(forgotPasswordSchema),
  forgotPasswordController
);

router.post(
  "/reset-password/:token",
  forgotPasswordLimiter,
  validate(resetPasswordSchema),
  resetPasswordController
);

router.post(
  "/refresh-token",
  refreshTokenLimiter,
  refreshTokenController
);

router.post(
  "/logout",
  protect,
  logoutController
);

router.get(
  "/me",
  protect,
  getMeController
);

export default router;