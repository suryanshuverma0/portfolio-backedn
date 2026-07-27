import Experience from "./experience.model.js";
import logger from "../../utils/logger.js";

export const createExperience = async (
  userId,
  experienceData,
) => {
  const experience =
    await Experience.create({
      user: userId,
      ...experienceData,
    });

  logger.info({
    action: "CREATE_EXPERIENCE",
    userId,
    experienceId: experience._id,
  });

  return experience;
};

// Shared site content — not scoped per admin account.
export const getExperiences = async () => {
  return await Experience.find({}).sort({ order: 1 });
};

export const getPublicExperiences =
  async () => {
    return await Experience.find({
      isVisible: true,
    }).sort({ order: 1 });
  };

export const updateExperience = async (
  experienceId,
  updateData,
) => {
  const experience =
    await Experience.findOneAndUpdate(
      {
        _id: experienceId,
      },
      {
        $set: updateData,
      },
      {
        new: true,
        runValidators: true,
      },
    );

  if (!experience) {
    logger.warn({
      action: "UPDATE_EXPERIENCE",
      experienceId,
      message: "Experience not found",
    });

    throw new Error(
      "Experience not found",
    );
  }

  logger.info({
    action: "UPDATE_EXPERIENCE",
    experienceId,
  });

  return experience;
};

export const deleteExperience = async (
  experienceId,
) => {
  const experience =
    await Experience.findOneAndDelete({
      _id: experienceId,
    });

  if (!experience) {
    logger.warn({
      action: "DELETE_EXPERIENCE",
      experienceId,
      message: "Experience not found",
    });

    throw new Error(
      "Experience not found",
    );
  }

  logger.info({
    action: "DELETE_EXPERIENCE",
    experienceId,
  });

  return experience;
};