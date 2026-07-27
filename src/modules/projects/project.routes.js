import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
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
  protectAdmin,
  validate(createProjectSchema),
  createProjectController,
);

router.get("/", protectAdmin, getProjectsController);

router.put(
  "/:id",
  protectAdmin,
  validate(updateProjectSchema),
  updateProjectController,
);

router.delete("/:id", protectAdmin, deleteProjectController);

export default router;
