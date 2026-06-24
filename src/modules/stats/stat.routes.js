import express from "express";

import protect from "../../middleware/auth.middleware.js";
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
  protect,
  validate(createStatSchema),
  createStatController,
);

router.get(
  "/",
  protect,
  getStatsController,
);

router.put(
  "/:id",
  protect,
  validate(updateStatSchema),
  updateStatController,
);

router.delete(
  "/:id",
  protect,
  deleteStatController,
);

export default router;