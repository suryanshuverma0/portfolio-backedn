import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createStatController,
  getStatsController,
  getPublicStatsController,
  updateStatController,
  deleteStatController,
} from "./stat.controller.js";

import {
  createStatSchema,
  updateStatSchema,
} from "./stat.validation.js";

const router = express.Router();

router.get(
  "/public",
  getPublicStatsController,
);

router.post(
  "/",
  protectAdmin,
  validate(createStatSchema),
  createStatController,
);

router.get(
  "/",
  protectAdmin,
  getStatsController,
);

router.put(
  "/:id",
  protectAdmin,
  validate(updateStatSchema),
  updateStatController,
);

router.delete(
  "/:id",
  protectAdmin,
  deleteStatController,
);

export default router;