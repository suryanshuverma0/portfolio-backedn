import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import { getSystemHealth } from "./system.service.js";

const router = express.Router();

router.get("/health", protectAdmin, async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await getSystemHealth() });
  } catch (error) {
    next(error);
  }
});

export default router;
