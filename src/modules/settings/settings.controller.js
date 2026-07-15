import {
  createSettings,
  getSettings,
  updateSettings,
  getPublicSettings,
} from "./settings.service.js";

export const createSettingsController = async (req, res, next) => {
  try {
    const settings = await createSettings(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Settings created successfully",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

export const getSettingsController = async (req, res, next) => {
  try {
    const settings = await getSettings(req.user._id);

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicSettingsController = async (req, res, next) => {
  try {
    const settings = await getPublicSettings();

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSettingsController = async (req, res, next) => {
  try {
    const settings = await updateSettings(req.user._id, req.validatedData);

    res.status(200).json({
      success: true,
      message: "Settings updated successfully",
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};
