import Skill from "./skills.model.js";
import logger from "../../utils/logger.js";

export const createSkill = async (userId, skillData) => {
  const skill = await Skill.create({
    user: userId,
    ...skillData,
  });

  logger.info({
    action: "CREATE_SKILL",
    userId,
    skillId: skill._id,
  });

  return skill;
};

// Shared site content — not scoped per admin account.
export const getSkills = async () => {
  return await Skill.find({}).sort({ order: 1 });
};

export const getPublicSkills = async () => {
  return await Skill.find({
    isVisible: true,
  }).sort({ order: 1 });
};

export const updateSkill = async (skillId, updateData) => {
  const skill = await Skill.findOneAndUpdate(
    {
      _id: skillId,
    },
    {
      $set: updateData,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!skill) {
    logger.warn({
      action: "UPDATE_SKILL",
      skillId,
      message: "Skill not found",
    });

    throw new Error("Skill not found");
  }

  logger.info({
    action: "UPDATE_SKILL",
    skillId,
  });

  return skill;
};

export const deleteSkill = async (skillId) => {
  const skill = await Skill.findOneAndDelete({
    _id: skillId,
  });

  if (!skill) {
    logger.warn({
      action: "DELETE_SKILL",
      skillId,
      message: "Skill not found",
    });

    throw new Error("Skill not found");
  }

  logger.info({
    action: "DELETE_SKILL",
    skillId,
  });

  return skill;
};
