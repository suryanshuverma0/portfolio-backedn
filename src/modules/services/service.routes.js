import express from "express";

import protect from "../../middleware/auth.middleware.js";
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
  protect,
  validate(createServiceSchema),
  createServiceController,
);

router.get("/", protect, getServicesController);

router.put(
  "/:id",
  protect,
  validate(updateServiceSchema),
  updateServiceController,
);

router.delete("/:id", protect, deleteServiceController);

export default router;
