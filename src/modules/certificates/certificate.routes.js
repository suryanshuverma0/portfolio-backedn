import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
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
  protectAdmin,
  validate(createCertificateSchema),
  createCertificateController,
);

router.get("/", protectAdmin, getCertificatesController);

router.put(
  "/:id",
  protectAdmin,
  validate(updateCertificateSchema),
  updateCertificateController,
);

router.delete("/:id", protectAdmin, deleteCertificateController);

export default router;
