import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";

import {
  createServiceController,
  getServicesController,
  getPublicServicesController,
  updateServiceController,
  deleteServiceController,
} from "./service.controller.js";

import {
  createServiceSchema,
  updateServiceSchema,
} from "./service.validation.js";

const router = express.Router();

router.get("/public", getPublicServicesController);

router.post(
  "/",
  protectAdmin,
  validate(createServiceSchema),
  createServiceController,
);

router.get("/", protectAdmin, getServicesController);

router.put(
  "/:id",
  protectAdmin,
  validate(updateServiceSchema),
  updateServiceController,
);

router.delete("/:id", protectAdmin, deleteServiceController);

export default router;
