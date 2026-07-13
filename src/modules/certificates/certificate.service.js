import Certificate from "./certificate.model.js";
import { deleteImage } from "../upload/upload.service.js";
import logger from "../../utils/logger.js";

export const createCertificate = async (userId, certificateData) => {
  const certificate = await Certificate.create({
    user: userId,
    ...certificateData,
  });

  logger.info({
    action: "CREATE_CERTIFICATE",
    userId,
    certificateId: certificate._id,
  });

  return certificate;
};

export const getCertificates = async (userId) => {
  return await Certificate.find({
    user: userId,
  }).sort({ order: 1 });
};

export const getPublicCertificates = async () => {
  return await Certificate.find({
    isVisible: true,
  }).sort({ order: 1 });
};

export const updateCertificate = async (certificateId, userId, updateData) => {
  const existingCertificate = await Certificate.findOne({
    _id: certificateId,
    user: userId,
  });

  if (!existingCertificate) {
    logger.warn({
      action: "UPDATE_CERTIFICATE",
      userId,
      certificateId,
      message: "Certificate not found",
    });

    throw new Error("Certificate not found");
  }

  if (
    updateData.image?.publicId &&
    updateData.image.publicId !== existingCertificate.image?.publicId
  ) {
    await deleteImage(existingCertificate.image.publicId);
  }

  const certificate = await Certificate.findByIdAndUpdate(
    certificateId,
    {
      $set: updateData,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  logger.info({
    action: "UPDATE_CERTIFICATE",
    userId,
    certificateId,
  });

  return certificate;
};

export const deleteCertificate = async (certificateId, userId) => {
  const certificate = await Certificate.findOneAndDelete({
    _id: certificateId,
    user: userId,
  });

  if (!certificate) {
    logger.warn({
      action: "DELETE_CERTIFICATE",
      userId,
      certificateId,
      message: "Certificate not found",
    });

    throw new Error("Certificate not found");
  }

  if (certificate.image?.publicId) {
    await deleteImage(certificate.image.publicId);
  }

  logger.info({
    action: "DELETE_CERTIFICATE",
    userId,
    certificateId,
  });

  return certificate;
};
