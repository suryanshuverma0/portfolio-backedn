import express from "express";
import protectAdmin from "../../middleware/protectAdmin.middleware.js";
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
  protectAdmin,
  validate(createExperienceSchema),
  createExperienceController,
);

router.get("/", protectAdmin, getExperiencesController);

router.put(
  "/:id",
  protectAdmin,
  validate(updateExperienceSchema),
  updateExperienceController,
);

router.delete("/:id", protectAdmin, deleteExperienceController);

export default router;
