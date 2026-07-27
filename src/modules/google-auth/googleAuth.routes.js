import express from "express";

import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import { googleLoginSchema } from "./googleAuth.validation.js";
import { googleLoginController } from "./googleAuth.controller.js";

const router = express.Router();

/*
  Defined locally instead of in ../../middleware/limiters.js so this module
  doesn't require touching shared limiter config.
*/
const googleLoginLimiter = slidingWindowLimiter({
  prefix: "google-login",
  limit: 10,
  windowInSeconds: 900,
});

router.post(
  "/login",
  googleLoginLimiter,
  validate(googleLoginSchema),
  googleLoginController,
);

export default router;
