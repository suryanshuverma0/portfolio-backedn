import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import { searchAdmin } from "./search.service.js";

const router = express.Router();

router.get("/", protectAdmin, async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await searchAdmin(req.query.q) });
  } catch (error) {
    next(error);
  }
});

export default router;
