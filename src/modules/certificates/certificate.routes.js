import express from "express";

import protect from "../../middleware/auth.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createCertificateController,
  getCertificatesController,
  getPublicCertificatesController,
  updateCertificateController,
  deleteCertificateController,
} from "./certificate.controller.js";

import {
  createCertificateSchema,
  updateCertificateSchema,
} from "./certificate.validation.js";

const router = express.Router();

router.get("/public", getPublicCertificatesController);

router.post(
  "/",
  protect,
  validate(createCertificateSchema),
  createCertificateController,
);

router.get("/", protect, getCertificatesController);

router.put(
  "/:id",
  protect,
  validate(updateCertificateSchema),
  updateCertificateController,
);

router.delete("/:id", protect, deleteCertificateController);

export default router;
