import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  getPublicCardController,
  downloadVCardController,
  getAdminCardController,
  updateCardController,
  getCardAnalyticsController,
} from "./card.controller.js";
import { updateCardSchema } from "./card.validation.js";

const router = express.Router();

router.get("/", getPublicCardController);

router.get("/vcard", downloadVCardController);

router.get("/admin", protectAdmin, getAdminCardController);

router.put("/admin", protectAdmin, validate(updateCardSchema), updateCardController);

router.get("/analytics", protectAdmin, getCardAnalyticsController);

export default router;
