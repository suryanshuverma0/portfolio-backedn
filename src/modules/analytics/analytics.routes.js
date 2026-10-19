import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { trackLimiter, collectLimiter } from "../../middleware/limiters.js";

import {
  trackController,
  getOverviewController,
  getDashboardSummaryController,
  getRecentActivityController,
} from "./analytics.controller.js";

import {
  parseBeaconBody,
  collectController,
  listSessionsController,
  getSessionDetailController,
  deleteSessionController,
  getLiveSessionsController,
  getJourneyInsightsController,
  getAdvancedInsightsController,
  getDashboardInsightsController,
} from "./journey.controller.js";

import { trackSchema } from "./analytics.validation.js";
import { collectSchema } from "./journey.validation.js";

const router = express.Router();

// Legacy single page-view endpoint — kept so cached older frontend bundles
// keep working. The current tracker uses /collect.
router.post("/track", trackLimiter, validate(trackSchema), trackController);

router.post(
  "/collect",
  collectLimiter,
  parseBeaconBody,
  validate(collectSchema),
  collectController,
);

router.get("/overview", protectAdmin, getOverviewController);

router.get("/dashboard", protectAdmin, getDashboardSummaryController);

router.get("/dashboard/insights", protectAdmin, getDashboardInsightsController);

router.get("/recent-activity", protectAdmin, getRecentActivityController);

router.get("/journey", protectAdmin, getJourneyInsightsController);

router.get("/insights", protectAdmin, getAdvancedInsightsController);

router.get("/sessions/live", protectAdmin, getLiveSessionsController);

router.get("/sessions", protectAdmin, listSessionsController);

router.get("/sessions/:sessionId", protectAdmin, getSessionDetailController);

router.delete("/sessions/:sessionId", protectAdmin, deleteSessionController);

export default router;
