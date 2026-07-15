
import {
  slidingWindowLimiter,
} from "./rateLimiter.middleware.js";

export const loginLimiter =
  slidingWindowLimiter({
    prefix: "login",
    limit: 5,
    windowInSeconds: 900,
  });

export const registerLimiter =
  slidingWindowLimiter({
    prefix: "register",
    limit: 10,
    windowInSeconds: 3600,
  });

export const forgotPasswordLimiter =
  slidingWindowLimiter({
    prefix: "forgot-password",
    limit: 3,
    windowInSeconds: 3600,
  });

export const refreshTokenLimiter =
  slidingWindowLimiter({
    prefix: "refresh-token",
    limit: 30,
    windowInSeconds: 60,
  });

export const trackLimiter =
  slidingWindowLimiter({
    prefix: "analytics-track",
    limit: 60,
    windowInSeconds: 60,
  });