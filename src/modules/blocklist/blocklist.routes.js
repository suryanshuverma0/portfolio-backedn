import express from "express";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { getClientIp } from "../analytics/analytics.utils.js";
import { listBlocked, addBlocked, removeBlocked } from "./blocklist.service.js";

const router = express.Router();
router.use(protectAdmin);

const blockSchema = z.object({
  value: z.string().trim().min(2).max(64),
  reason: z.string().trim().max(200).optional(),
});

const handle = (fn) => async (req, res, next) => {
  try {
    if (req.params.id && !/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const data = await fn(req);

    if (data === null) return res.status(404).json({ success: false, message: "Entry not found" });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

router.get("/", handle(async (req) => ({ entries: await listBlocked(), yourIp: getClientIp(req) })));
router.post("/", validate(blockSchema), handle((req) => addBlocked(req.validatedData, getClientIp(req))));
router.delete("/:id", handle((req) => removeBlocked(req.params.id)));

export default router;
