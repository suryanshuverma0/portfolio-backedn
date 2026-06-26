import {
  createSkill,
  getSkills,
  getPublicSkills,
  updateSkill,
  deleteSkill,
} from "./skills.service.js";

export const createSkillController = async (req, res, next) => {
  try {
    const skill = await createSkill(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Skill created successfully",
      data: skill,
    });
  } catch (error) {
    next(error);
  }
};

export const getSkillsController = async (req, res, next) => {
  try {
    const skills = await getSkills(req.user._id);

    res.status(200).json({
      success: true,
      data: skills,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicSkillsController = async (req, res, next) => {
  try {
    const skills = await getPublicSkills();

    res.status(200).json({
      success: true,
      data: skills,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSkillController = async (req, res, next) => {
  try {
    const skill = await updateSkill(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Skill updated successfully",
      data: skill,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSkillController = async (req, res, next) => {
  try {
    await deleteSkill(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Skill deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
