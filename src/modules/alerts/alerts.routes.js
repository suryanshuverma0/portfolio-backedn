import express from "express";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as service from "./alerts.service.js";

const router = express.Router();
router.use(protectAdmin);

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: (await fn(req)) ?? null });
  } catch (error) {
    next(error);
  }
};

const settingsSchema = z.object({
  longVisit: z
    .object({
      enabled: z.boolean().optional(),
      minutes: z.number().int().min(1).max(120).optional(),
      includeCard: z.boolean().optional(),
    })
    .optional(),
  email: z
    .object({
      enabled: z.boolean().optional(),
      to: z.union([z.string().trim().email().max(150), z.literal("")]).optional(),
    })
    .optional(),
  weeklyReport: z
    .object({
      enabled: z.boolean().optional(),
      timezone: z.string().max(60).refine((tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone").optional(),
    })
    .optional(),
  ignoreOwner: z.boolean().optional(),
});

const ownerDeviceSchema = z.object({ visitorId: z.string().min(1).max(100) });

router.get("/", handle((req) => service.listAlerts(Math.min(100, Number(req.query.limit) || 30))));
router.post("/read-all", handle(() => service.markAllRead()));
router.delete("/", handle(() => service.clearAlerts()));
router.post(
  "/:id/read",
  handle((req) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      const error = new Error("Invalid id");
      error.statusCode = 400;
      throw error;
    }
    return service.markRead(req.params.id);
  }),
);

router.get(
  "/settings",
  handle(async () => {
    const settings = await service.getAlertSettings({ fresh: true });
    return {
      ...settings,
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
      defaultEmail: (process.env.ADMIN_EMAILS || "").split(",")[0]?.trim() || "",
    };
  }),
);
router.put("/settings", validate(settingsSchema), handle((req) => service.updateAlertSettings(req.validatedData)));
router.post("/owner-device", validate(ownerDeviceSchema), handle((req) => service.registerOwnerDevice(req.validatedData.visitorId)));
router.post("/test", handle(() => service.sendTestAlert()));

export default router;
