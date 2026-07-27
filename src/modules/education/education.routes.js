import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
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
  protectAdmin,
  validate(createEducationSchema),
  createEducationController,
);

router.get("/", protectAdmin, getEducationsController);

router.put(
  "/:id",
  protectAdmin,
  validate(updateEducationSchema),
  updateEducationController,
);

router.delete("/:id", protectAdmin, deleteEducationController);

export default router;
