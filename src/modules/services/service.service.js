import Service from "./service.model.js";
import logger from "../../utils/logger.js";

export const createService = async (
  userId,
  serviceData,
) => {
  const service = await Service.create({
    user: userId,
    ...serviceData,
  });

  logger.info({
    action: "CREATE_SERVICE",
    userId,
    serviceId: service._id,
  });

  return service;
};

export const getServices = async (
  userId,
) => {
  return await Service.find({
    user: userId,
  }).sort({ order: 1 });
};

export const getPublicServices =
  async () => {
    return await Service.find({
      isVisible: true,
    }).sort({ order: 1 });
  };

export const updateService = async (
  serviceId,
  userId,
  updateData,
) => {
  const service =
    await Service.findOneAndUpdate(
      {
        _id: serviceId,
        user: userId,
      },
      {
        $set: updateData,
      },
      {
        new: true,
        runValidators: true,
      },
    );

  if (!service) {
    logger.warn({
      action: "UPDATE_SERVICE",
      userId,
      serviceId,
      message: "Service not found",
    });

    throw new Error("Service not found");
  }

  logger.info({
    action: "UPDATE_SERVICE",
    userId,
    serviceId,
  });

  return service;
};

export const deleteService = async (
  serviceId,
  userId,
) => {
  const service =
    await Service.findOneAndDelete({
      _id: serviceId,
      user: userId,
    });

  if (!service) {
    logger.warn({
      action: "DELETE_SERVICE",
      userId,
      serviceId,
      message: "Service not found",
    });

    throw new Error("Service not found");
  }

  logger.info({
    action: "DELETE_SERVICE",
    userId,
    serviceId,
  });

  return service;
};