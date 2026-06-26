import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createSkillController,
  getSkillsController,
  getPublicSkillsController,
  updateSkillController,
  deleteSkillController,
} from "./skills.controller.js";

import { createSkillSchema, updateSkillSchema } from "./skills.validation.js";

const router = express.Router();

router.get("/public", getPublicSkillsController);

router.post("/", protect, validate(createSkillSchema), createSkillController);

router.get("/", protect, getSkillsController);

router.put("/:id", protect, validate(updateSkillSchema), updateSkillController);

router.delete("/:id", protect, deleteSkillController);

export default router;
