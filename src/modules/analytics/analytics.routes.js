import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { trackLimiter } from "../../middleware/limiters.js";

import {
  trackController,
  getOverviewController,
  getDashboardSummaryController,
  getRecentActivityController,
} from "./analytics.controller.js";

import { trackSchema } from "./analytics.validation.js";

const router = express.Router();

router.post("/track", trackLimiter, validate(trackSchema), trackController);

router.get("/overview", protectAdmin, getOverviewController);

router.get("/dashboard", protectAdmin, getDashboardSummaryController);

router.get("/recent-activity", protectAdmin, getRecentActivityController);

export default router;
