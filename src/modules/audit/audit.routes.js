import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import { listAuditLogs } from "./audit.service.js";

const router = express.Router();
router.use(protectAdmin);

const clampInt = (value, min, max, fallback) => Math.min(max, Math.max(min, Number.parseInt(value, 10) || fallback));

const listController = (kind) => async (req, res, next) => {
  try {
    const data = await listAuditLogs({
      kind,
      page: clampInt(req.query.page, 1, 100000, 1),
      limit: clampInt(req.query.limit, 1, 100, 30),
      resource: typeof req.query.resource === "string" ? req.query.resource.slice(0, 60) : undefined,
      failedOnly: req.query.failed === "true",
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

router.get("/logins", listController("login"));
router.get("/actions", listController("action"));

export default router;
