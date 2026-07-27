import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";

import upload from "../../middleware/upload.middleware.js";

import {
  uploadImageController,
  uploadImagesController,
} from "./upload.controller.js";

const router = express.Router();

router.post(
  "/image",
  protectAdmin,
  upload.single("image"),
  uploadImageController
);

router.post(
  "/images",
  protectAdmin,
  upload.array("images", 10),
  uploadImagesController
);

export default router;