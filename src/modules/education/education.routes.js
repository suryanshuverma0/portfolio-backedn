import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createEducationController,
  getEducationsController,
  getPublicEducationsController,
  updateEducationController,
  deleteEducationController,
} from "./education.controller.js";

import {
  createEducationSchema,
  updateEducationSchema,
} from "./education.validation.js";

const router = express.Router();

router.get("/public", getPublicEducationsController);

router.post(
  "/",
  protect,
  validate(createEducationSchema),
  createEducationController,
);

router.get("/", protect, getEducationsController);

router.put(
  "/:id",
  protect,
  validate(updateEducationSchema),
  updateEducationController,
);

router.delete("/:id", protect, deleteEducationController);

export default router;
