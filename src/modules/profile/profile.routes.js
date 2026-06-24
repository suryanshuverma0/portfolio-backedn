import express from "express";

import {
  createProfileController,
  getProfileController,
  updateProfileController,
  getPublicProfileController,
} from "./profile.controller.js";

import protect from "../../middleware/auth.middleware.js";

import validate from "../../middleware/validate.middleware.js";

import {
  createProfileSchema,
  updateProfileSchema,
} from "./profile.validation.js";

const router = express.Router();

router.get("/public", getPublicProfileController);

router.post(
  "/",
  protect,
  validate(createProfileSchema),
  createProfileController,
);

router.get("/", protect, getProfileController);

router.put(
  "/",
  protect,
  validate(updateProfileSchema),
  updateProfileController,
);

export default router;
