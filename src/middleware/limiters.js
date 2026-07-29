
import {
  slidingWindowLimiter,
} from "./rateLimiter.middleware.js";

// Body is already parsed (express.json runs globally before any route
// matches) even though this middleware sits before validate() — so the
// raw email is readable here, just not yet zod-validated.
const emailKeyBy = (req) => {
  const email = req.body?.email;

  return typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
};

export const loginLimiter =
  slidingWindowLimiter({
    prefix: "login",
    limit: 5,
    windowInSeconds: 900,
  });

// Per-IP alone only stops one attacker hammering one account. This closes
// the distributed-brute-force gap: an attacker rotating across many IPs
// still can't exceed 5 attempts against any single email in 15 minutes —
// functionally the same protection an account-lockout field would give,
// without needing one.
export const loginByEmailLimiter =
  slidingWindowLimiter({
    prefix: "login-email",
    limit: 5,
    windowInSeconds: 900,
    keyBy: emailKeyBy,
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

// Same reasoning as loginByEmailLimiter — stops distributed email-bombing
// of a single target's inbox via password-reset requests.
export const forgotPasswordByEmailLimiter =
  slidingWindowLimiter({
    prefix: "forgot-password-email",
    limit: 3,
    windowInSeconds: 3600,
    keyBy: emailKeyBy,
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