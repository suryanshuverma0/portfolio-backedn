import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { trackLimiter } from "../../middleware/limiters.js";

import {
  trackController,
  getOverviewController,
  getDashboardSummaryController,
} from "./analytics.controller.js";

import { trackSchema } from "./analytics.validation.js";

const router = express.Router();

router.post("/track", trackLimiter, validate(trackSchema), trackController);

router.get("/overview", protect, getOverviewController);

router.get("/dashboard", protect, getDashboardSummaryController);

export default router;
