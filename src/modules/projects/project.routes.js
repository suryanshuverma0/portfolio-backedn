import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createProjectController,
  getProjectsController,
  getPublicProjectsController,
  getPublicProjectController,
  updateProjectController,
  deleteProjectController,
} from "./project.controller.js";

import {
  createProjectSchema,
  updateProjectSchema,
} from "./project.validation.js";

const router = express.Router();

router.get("/public", getPublicProjectsController);

router.get("/public/:slug", getPublicProjectController);

router.post(
  "/",
  protect,
  validate(createProjectSchema),
  createProjectController,
);

router.get("/", protect, getProjectsController);

router.put(
  "/:id",
  protect,
  validate(updateProjectSchema),
  updateProjectController,
);

router.delete("/:id", protect, deleteProjectController);

export default router;
