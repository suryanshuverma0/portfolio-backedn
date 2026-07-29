import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import {
  createMessageController,
  getMessagesController,
  markMessageReadController,
  deleteMessageController,
} from "./contact.controller.js";

import { createMessageSchema } from "./contact.validation.js";

const router = express.Router();

// Defined locally rather than in ../../middleware/limiters.js so this
// module doesn't require touching shared limiter config.
const messageLimiter = slidingWindowLimiter({
  prefix: "contact-message",
  limit: 5,
  windowInSeconds: 600,
});

router.post(
  "/",
  messageLimiter,
  validate(createMessageSchema),
  createMessageController,
);

router.get("/", protectAdmin, getMessagesController);

router.put("/:id/read", protectAdmin, markMessageReadController);

router.delete("/:id", protectAdmin, deleteMessageController);

export default router;
