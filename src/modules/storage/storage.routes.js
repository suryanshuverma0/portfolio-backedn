import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import { getStorageOverviewController } from "./storage.controller.js";

const router = express.Router();

router.get("/", protectAdmin, getStorageOverviewController);

export default router;
