import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
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

router.post("/", protectAdmin, validate(createSkillSchema), createSkillController);

router.get("/", protectAdmin, getSkillsController);

router.put("/:id", protectAdmin, validate(updateSkillSchema), updateSkillController);

router.delete("/:id", protectAdmin, deleteSkillController);

export default router;
