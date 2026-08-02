import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import {
  registrationVerifySchema,
  authenticationVerifySchema,
  renamePasskeySchema,
} from "./passkey.validation.js";
import {
  registrationOptionsController,
  registrationVerifyController,
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

// --- Registration (adding a passkey to the logged-in account) ---
router.post("/registration/options", protect, registrationOptionsController);
router.post(
  "/registration/verify",
  protect,
  validate(registrationVerifySchema),
  registrationVerifyController,
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
