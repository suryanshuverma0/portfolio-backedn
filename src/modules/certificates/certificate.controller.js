import {
  createCertificate,
  getCertificates,
  getPublicCertificates,
  updateCertificate,
  deleteCertificate,
} from "./certificate.service.js";

export const createCertificateController = async (req, res, next) => {
  try {
    const certificate = await createCertificate(
      req.user._id,
      req.validatedData,
    );

    res.status(201).json({
      success: true,
      message: "Certificate created successfully",
      data: certificate,
    });
  } catch (error) {
    next(error);
  }
};

export const getCertificatesController = async (req, res, next) => {
  try {
    const certificates = await getCertificates(req.user._id);

    res.status(200).json({
      success: true,
      data: certificates,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicCertificatesController = async (req, res, next) => {
  try {
    const certificates = await getPublicCertificates();

    res.status(200).json({
      success: true,
      data: certificates,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCertificateController = async (req, res, next) => {
  try {
    const certificate = await updateCertificate(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Certificate updated successfully",
      data: certificate,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCertificateController = async (req, res, next) => {
  try {
    await deleteCertificate(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Certificate deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
