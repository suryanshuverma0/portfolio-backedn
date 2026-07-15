import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createSettingsController,
  getSettingsController,
  getPublicSettingsController,
  updateSettingsController,
} from "./settings.controller.js";

import {
  createSettingsSchema,
  updateSettingsSchema,
} from "./settings.validation.js";

const router = express.Router();

router.get("/public", getPublicSettingsController);

router.post(
  "/",
  protect,
  validate(createSettingsSchema),
  createSettingsController,
);

router.get("/", protect, getSettingsController);

router.put(
  "/",
  protect,
  validate(updateSettingsSchema),
  updateSettingsController,
);

export default router;
