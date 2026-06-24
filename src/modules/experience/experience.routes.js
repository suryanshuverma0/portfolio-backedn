import express from "express";
import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createExperienceController,
  getExperiencesController,
  getPublicExperiencesController,
  updateExperienceController,
  deleteExperienceController,
} from "./experience.controller.js";

import {
  createExperienceSchema,
  updateExperienceSchema,
} from "./experience.validation.js";

const router = express.Router();

router.get("/public", getPublicExperiencesController);

router.post(
  "/",
  protect,
  validate(createExperienceSchema),
  createExperienceController,
);

router.get("/", protect, getExperiencesController);

router.put(
  "/:id",
  protect,
  validate(updateExperienceSchema),
  updateExperienceController,
);

router.delete("/:id", protect, deleteExperienceController);

export default router;
