import express from "express";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as push from "./push.service.js";

const router = express.Router();
router.use(protectAdmin);

const subscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Push endpoint must be https"),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
  }),
  label: z.string().max(80).optional(),
});

const endpointSchema = z.object({ endpoint: z.string().url().max(1000) });

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

router.get("/public-key", handle(() => push.getPublicKey()));
router.get("/", handle((req) => push.listSubscriptions(req.user._id)));
router.post(
  "/subscribe",
  validate(subscriptionSchema),
  handle((req) => push.subscribe(req.user._id, { ...req.validatedData, userAgent: req.get("user-agent") })),
);
router.post("/unsubscribe", validate(endpointSchema), handle(async (req) => (await push.unsubscribe(req.validatedData.endpoint)).deletedCount > 0));
router.delete(
  "/:id",
  handle(async (req) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      const error = new Error("Invalid id");
      error.statusCode = 400;
      throw error;
    }
    return (await push.removeSubscription(req.user._id, req.params.id)).deletedCount > 0;
  }),
);
router.post(
  "/test",
  handle(() =>
    push.sendPushToAll({
      title: "Notifications are on 🎉",
      body: "This device will get alerts from your portfolio admin.",
      url: "/dashboard",
      tag: "test",
    }),
  ),
);

export default router;
