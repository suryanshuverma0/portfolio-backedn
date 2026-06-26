import {
  createService,
  getServices,
  getPublicServices,
  updateService,
  deleteService,
} from "./service.service.js";

export const createServiceController = async (req, res, next) => {
  try {
    const service = await createService(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Service created successfully",
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

export const getServicesController = async (req, res, next) => {
  try {
    const services = await getServices(req.user._id);

    res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicServicesController = async (req, res, next) => {
  try {
    const services = await getPublicServices();

    res.status(200).json({
      success: true,
      data: services,
    });
  } catch (error) {
    next(error);
  }
};

export const updateServiceController = async (req, res, next) => {
  try {
    const service = await updateService(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Service updated successfully",
      data: service,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteServiceController = async (req, res, next) => {
  try {
    await deleteService(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Service deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
