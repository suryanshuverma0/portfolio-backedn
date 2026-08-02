import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import {
  registrationVerifySchema,
  signupOptionsSchema,
  signupVerifySchema,
  authenticationVerifySchema,
  renamePasskeySchema,
} from "./passkey.validation.js";
import {
  registrationOptionsController,
  registrationVerifyController,
  signupOptionsController,
  signupVerifyController,
  authenticationOptionsController,
  authenticationVerifyController,
  listPasskeysController,
  renamePasskeyController,
  deletePasskeyController,
} from "./passkey.controller.js";

const router = express.Router();

/*
  Defined locally instead of in ../../middleware/limiters.js so this module
  doesn't require touching shared limiter config (same pattern as
  ../google-auth). These two routes are public/unauthenticated, so they're
  the only ones that need brute-force protection here — registration and
  management routes already require a valid session via `protect`.
*/
const passkeyAuthLimiter = slidingWindowLimiter({
  prefix: "passkey-auth",
  limit: 20,
  windowInSeconds: 900,
});

// Duplicated from ../../middleware/limiters.js's private emailKeyBy (not
// exported) rather than imported, for the same self-containment reason.
const emailKeyBy = (req) => {
  const email = req.body?.email;

  return typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
};

const passkeySignupLimiter = slidingWindowLimiter({
  prefix: "passkey-signup",
  limit: 10,
  windowInSeconds: 3600,
});

const passkeySignupByEmailLimiter = slidingWindowLimiter({
  prefix: "passkey-signup-email",
  limit: 5,
  windowInSeconds: 3600,
  keyBy: emailKeyBy,
});

// --- Registration (adding a passkey to the logged-in account) ---
router.post("/registration/options", protect, registrationOptionsController);
router.post(
  "/registration/verify",
  protect,
  validate(registrationVerifySchema),
  registrationVerifyController,
);

// --- Signup (public — creates a new account bound to a first passkey;
// same admin allowlist / publicAccessEnabled gate as password & Google
// signup, enforced inside getSignupOptions/verifySignup) ---
router.post(
  "/signup/options",
  passkeySignupLimiter,
  passkeySignupByEmailLimiter,
  validate(signupOptionsSchema),
  signupOptionsController,
);
router.post(
  "/signup/verify",
  passkeySignupLimiter,
  passkeySignupByEmailLimiter,
  validate(signupVerifySchema),
  signupVerifyController,
);

// --- Authentication (logging in with a passkey) ---
router.post("/authentication/options", passkeyAuthLimiter, authenticationOptionsController);
router.post(
  "/authentication/verify",
  passkeyAuthLimiter,
  validate(authenticationVerifySchema),
  authenticationVerifyController,
);

// --- Management (list / rename / delete own passkeys) ---
router.get("/", protect, listPasskeysController);
router.patch(
  "/:id",
  protect,
  validate(renamePasskeySchema),
  renamePasskeyController,
);
router.delete("/:id", protect, deletePasskeyController);

export default router;
