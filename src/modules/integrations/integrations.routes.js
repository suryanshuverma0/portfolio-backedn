import express from "express";

import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import {
  getGitHubStatsController,
  getLeetCodeStatsController,
  getIntegrationsStatusController,
} from "./integrations.controller.js";

const router = express.Router();

// Defined locally rather than in ../../middleware/limiters.js so this
// module doesn't require touching shared limiter config. Generous limit —
// results are cached for an hour server-side, this just guards against
// blatant abuse of a public, unauthenticated endpoint.
const integrationsLimiter = slidingWindowLimiter({
  prefix: "integrations",
  limit: 60,
  windowInSeconds: 600,
});

router.get("/github", integrationsLimiter, getGitHubStatsController);

router.get("/leetcode", integrationsLimiter, getLeetCodeStatsController);

router.get("/status", integrationsLimiter, getIntegrationsStatusController);

export default router;
