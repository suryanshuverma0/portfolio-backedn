import {
  createExperience,
  getExperiences,
  getPublicExperiences,
  updateExperience,
  deleteExperience,
} from "./experience.service.js";

export const createExperienceController = async (req, res, next) => {
  try {
    const experience = await createExperience(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Experience created successfully",
      data: experience,
    });
  } catch (error) {
    next(error);
  }
};

export const getExperiencesController = async (req, res, next) => {
  try {
    const experiences = await getExperiences(req.user._id);

    res.status(200).json({
      success: true,
      data: experiences,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicExperiencesController = async (req, res, next) => {
  try {
    const experiences = await getPublicExperiences();

    res.status(200).json({
      success: true,
      data: experiences,
    });
  } catch (error) {
    next(error);
  }
};

export const updateExperienceController = async (req, res, next) => {
  try {
    const experience = await updateExperience(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Experience updated successfully",
      data: experience,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteExperienceController = async (req, res, next) => {
  try {
    await deleteExperience(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Experience deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
