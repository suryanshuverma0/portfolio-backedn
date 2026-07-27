import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
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
  protectAdmin,
  validate(createSettingsSchema),
  createSettingsController,
);

router.get("/", protectAdmin, getSettingsController);

router.put(
  "/",
  protectAdmin,
  validate(updateSettingsSchema),
  updateSettingsController,
);

export default router;
