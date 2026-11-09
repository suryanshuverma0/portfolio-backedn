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
  reorderProjectsSchema,
  githubImportSchema,
} from "./project.validation.js";
import { reorderProjects } from "./project.service.js";
import { listRepos, draftFromRepo } from "./project.github.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

const router = express.Router();

const githubLimiter = slidingWindowLimiter({ prefix: "projects-github", limit: 40, windowInSeconds: 10 * 60, countsAsOffense: false });
const send = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

router.get("/public", getPublicProjectsController);

router.get("/public/:slug", getPublicProjectController);

router.post(
  "/",
  protectAdmin,
  validate(createProjectSchema),
  createProjectController,
);

router.get("/", protectAdmin, getProjectsController);

router.get(
  "/github/repos",
  protectAdmin,
  githubLimiter,
  send((req) => listRepos(typeof req.query.user === "string" ? req.query.user.trim() : undefined)),
);

router.post(
  "/github/import",
  protectAdmin,
  githubLimiter,
  validate(githubImportSchema),
  send((req) => draftFromRepo(req.validatedData.repo)),
);

router.put(
  "/reorder",
  protectAdmin,
  validate(reorderProjectsSchema),
  send((req) => reorderProjects(req.validatedData.ids)),
);

router.put(
  "/:id",
  protectAdmin,
  validate(updateProjectSchema),
  updateProjectController,
);

router.delete("/:id", protectAdmin, deleteProjectController);

export default router;
