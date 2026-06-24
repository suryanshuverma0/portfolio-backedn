import {
  createEducation,
  getEducations,
  getPublicEducations,
  updateEducation,
  deleteEducation,
} from "./education.service.js";

export const createEducationController = async (req, res, next) => {
  try {
    const education = await createEducation(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Education created successfully",
      data: education,
    });
  } catch (error) {
    next(error);
  }
};

export const getEducationsController = async (req, res, next) => {
  try {
    const educations = await getEducations(req.user._id);

    res.status(200).json({
      success: true,
      data: educations,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicEducationsController = async (req, res, next) => {
  try {
    const educations = await getPublicEducations();

    res.status(200).json({
      success: true,
      data: educations,
    });
  } catch (error) {
    next(error);
  }
};

export const updateEducationController = async (req, res, next) => {
  try {
    const education = await updateEducation(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Education updated successfully",
      data: education,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteEducationController = async (req, res, next) => {
  try {
    await deleteEducation(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Education deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
