import {
  uploadImage,
  uploadImages,
} from "./upload.service.js";

import logger from "../../utils/logger.js";
import { isRealImage, safeFolder } from "../../middleware/upload.middleware.js";

export const uploadImageController = async (
  req,
  res,
  next
) => {
  try {
    logger.info(
      {
        filename: req.file?.originalname,
        mimetype: req.file?.mimetype,
        size: req.file?.size,
      },
      "Upload request received"
    );

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image uploaded",
      });
    }

    if (!isRealImage(req.file.buffer)) {
      return res.status(400).json({ success: false, message: "That file isn't a real image" });
    }

    const folder = safeFolder(req.body.folder);

    const image = await uploadImage(
      req.file.buffer,
      folder
    );

    res.status(200).json({
      success: true,
      data: image,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Image upload failed"
    );

    next(error);
  }
};

export const uploadImagesController = async (
  req,
  res,
  next
) => {
  try {
    logger.info(
      {
        filesCount: req.files?.length,
      },
      "Multiple image upload request"
    );

    if (
      !req.files ||
      req.files.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "No images uploaded",
      });
    }

    if (req.files.some((file) => !isRealImage(file.buffer))) {
      return res.status(400).json({ success: false, message: "One of those files isn't a real image" });
    }

    const folder = safeFolder(req.body.folder);

    const images = await uploadImages(
      req.files,
      folder
    );

    res.status(200).json({
      success: true,
      data: images,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Multiple image upload failed"
    );

    next(error);
  }
};