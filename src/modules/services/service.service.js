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

// Shared site content — not scoped per admin account.
export const getServices = async () => {
  return await Service.find({}).sort({ order: 1 });
};

export const getPublicServices =
  async () => {
    return await Service.find({
      isVisible: true,
    }).sort({ order: 1 });
  };

export const updateService = async (
  serviceId,
  updateData,
) => {
  const service =
    await Service.findOneAndUpdate(
      {
        _id: serviceId,
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
      serviceId,
      message: "Service not found",
    });

    throw new Error("Service not found");
  }

  logger.info({
    action: "UPDATE_SERVICE",
    serviceId,
  });

  return service;
};

export const deleteService = async (
  serviceId,
) => {
  const service =
    await Service.findOneAndDelete({
      _id: serviceId,
    });

  if (!service) {
    logger.warn({
      action: "DELETE_SERVICE",
      serviceId,
      message: "Service not found",
    });

    throw new Error("Service not found");
  }

  logger.info({
    action: "DELETE_SERVICE",
    serviceId,
  });

  return service;
};