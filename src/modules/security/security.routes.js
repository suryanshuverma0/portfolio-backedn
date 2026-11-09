import express from "express";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { getSecuritySettings, updateSecuritySettings } from "./security.service.js";
import { getSecurityScore } from "./security.score.js";

const router = express.Router();
router.use(protectAdmin);

const settingsSchema = z.object({
  autoBan: z
    .object({
      enabled: z.boolean().optional(),
      loginFailures: z.number().int().min(3).max(100).optional(),
      spamHits: z.number().int().min(1).max(50).optional(),
      rateLimitHits: z.number().int().min(5).max(500).optional(),
      windowMinutes: z.number().int().min(5).max(1440).optional(),
      banHours: z.number().int().min(1).max(720).optional(),
      notify: z.boolean().optional(),
    })
    .optional(),
  spamTrap: z
    .object({
      enabled: z.boolean().optional(),
      minSeconds: z.number().int().min(1).max(30).optional(),
    })
    .optional(),
});

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

router.get("/score", handle((req) => getSecurityScore(req.user, req.sessionId)));
router.get("/settings", handle(() => getSecuritySettings({ fresh: true })));
router.put("/settings", validate(settingsSchema), handle((req) => updateSecuritySettings(req.validatedData)));

export default router;
