import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import {
  registrationVerifySchema,
  linkRequestSchema,
  linkOptionsSchema,
  linkVerifySchema,
  signupOptionsSchema,
  signupVerifySchema,
  authenticationVerifySchema,
  renamePasskeySchema,
} from "./passkey.validation.js";
import {
  registrationOptionsController,
  registrationVerifyController,
  linkRequestController,
  linkOptionsController,
  linkVerifyController,
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

// Requesting a link is email-bombing-prone the same way forgot-password
// is, so it gets its own tight per-email limit. The options/verify steps
// only work with a valid single-use token already, so a looser shared
// limiter is enough there.
const passkeyLinkRequestLimiter = slidingWindowLimiter({
  prefix: "passkey-link-request",
  limit: 3,
  windowInSeconds: 3600,
  keyBy: emailKeyBy,
});

const passkeyLinkLimiter = slidingWindowLimiter({
  prefix: "passkey-link",
  limit: 20,
  windowInSeconds: 900,
});

// --- Registration (adding a passkey to the logged-in account) ---
router.post("/registration/options", protect, registrationOptionsController);
router.post(
  "/registration/verify",
  protect,
  validate(registrationVerifySchema),
  registrationVerifyController,
);

// --- Link (public — emails a one-time link that adds a passkey to an
// EXISTING account from a device with no session there) ---
router.post(
  "/link/request",
  passkeyLinkRequestLimiter,
  validate(linkRequestSchema),
  linkRequestController,
);
router.post(
  "/link/options",
  passkeyLinkLimiter,
  validate(linkOptionsSchema),
  linkOptionsController,
);
router.post(
  "/link/verify",
  passkeyLinkLimiter,
  validate(linkVerifySchema),
  linkVerifyController,
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
