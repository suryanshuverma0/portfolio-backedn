import express from "express";

import protect from "../../middleware/auth.middleware.js";

import upload from "../../middleware/upload.middleware.js";

import {
  uploadImageController,
  uploadImagesController,
} from "./upload.controller.js";

const router = express.Router();

router.post(
  "/image",
  protect,
  upload.single("image"),
  uploadImageController
);

router.post(
  "/images",
  protect,
  upload.array("images", 10),
  uploadImagesController
);

export default router;