import express from "express";

import validate from "../../middleware/validate.middleware.js";
import protect from "../../middleware/auth.middleware.js";
import protectAdmin from "../../middleware/protectAdmin.middleware.js";

import {
  registerLimiter,
  loginLimiter,
  loginByEmailLimiter,
  forgotPasswordLimiter,
  forgotPasswordByEmailLimiter,
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
  listSessionsController,
  revokeSessionController,
  revokeOtherSessionsController,
  getAllUsersController,
  deleteUserController,
} from "./auth.controller.js";
import { blockGuard } from "../blocklist/blocklist.service.js";

const router = express.Router();

router.post(
  "/register",
  blockGuard(),
  registerLimiter,
  validate(registerSchema),
  registerController,
);

router.post(
  "/login",
  blockGuard(),
  loginLimiter,
  loginByEmailLimiter,
  validate(loginSchema),
  loginController,
);

router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  forgotPasswordByEmailLimiter,
  validate(forgotPasswordSchema),
  forgotPasswordController,
);

router.post(
  "/reset-password/:token",
  forgotPasswordLimiter,
  validate(resetPasswordSchema),
  resetPasswordController,
);

router.post("/refresh-token", refreshTokenLimiter, refreshTokenController);

router.post("/logout", protect, logoutController);

router.get("/sessions", protect, listSessionsController);
router.post("/sessions/revoke-others", protect, revokeOtherSessionsController);
router.delete("/sessions/:id", protect, revokeSessionController);

router.get("/me", protect, getMeController);

router.get("/users", protectAdmin, getAllUsersController);

router.delete("/users/:id", protectAdmin, deleteUserController);

export default router;
