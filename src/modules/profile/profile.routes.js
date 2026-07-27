import express from "express";

import {
  createProfileController,
  getProfileController,
  updateProfileController,
  getPublicProfileController,
} from "./profile.controller.js";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";

import validate from "../../middleware/validate.middleware.js";

import {
  createProfileSchema,
  updateProfileSchema,
} from "./profile.validation.js";

const router = express.Router();

router.get("/public", getPublicProfileController);

router.post(
  "/",
  protectAdmin,
  validate(createProfileSchema),
  createProfileController,
);

router.get("/", protectAdmin, getProfileController);

router.put(
  "/",
  protectAdmin,
  validate(updateProfileSchema),
  updateProfileController,
);

export default router;
