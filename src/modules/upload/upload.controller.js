import {
  uploadImage,
  uploadImages,
} from "./upload.service.js";

import logger from "../../utils/logger.js";

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

    const folder =
      req.body.folder || "misc";

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

    const folder =
      req.body.folder || "misc";

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