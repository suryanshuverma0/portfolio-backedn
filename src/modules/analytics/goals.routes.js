import express from "express";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { GOAL_STEP_TYPES } from "./goals.model.js";
import { listGoalsWithStats, createGoal, updateGoal, deleteGoal } from "./goals.service.js";
import { isValidTimezone } from "./journey.service.js";

const router = express.Router();
router.use(protectAdmin);

const goalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  steps: z
    .array(
      z.object({
        type: z.enum(GOAL_STEP_TYPES),
        match: z.string().trim().max(200).optional().default(""),
        label: z.string().trim().max(80).optional().default(""),
      }),
    )
    .min(1)
    .max(8),
});

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(id);

const handle = (fn) => async (req, res, next) => {
  try {
    if (req.params.id && !isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const data = await fn(req);

    if (data === null) return res.status(404).json({ success: false, message: "Goal not found" });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

router.get(
  "/",
  handle((req) =>
    listGoalsWithStats({
      rangeDays: Math.min(3650, Math.max(1, Number.parseInt(req.query.range, 10) || 30)),
      timezone: typeof req.query.tz === "string" && isValidTimezone(req.query.tz) ? req.query.tz : "UTC",
    }),
  ),
);
router.post("/", validate(goalSchema), handle((req) => createGoal(req.validatedData)));
router.put("/:id", validate(goalSchema), handle((req) => updateGoal(req.params.id, req.validatedData)));
router.delete("/:id", handle((req) => deleteGoal(req.params.id)));

export default router;
