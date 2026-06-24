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

export const getExperiences = async (
  userId,
) => {
  return await Experience.find({
    user: userId,
  }).sort({ order: 1 });
};

export const getPublicExperiences =
  async () => {
    return await Experience.find({
      isVisible: true,
    }).sort({ order: 1 });
  };

export const updateExperience = async (
  experienceId,
  userId,
  updateData,
) => {
  const experience =
    await Experience.findOneAndUpdate(
      {
        _id: experienceId,
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

  if (!experience) {
    logger.warn({
      action: "UPDATE_EXPERIENCE",
      userId,
      experienceId,
      message: "Experience not found",
    });

    throw new Error(
      "Experience not found",
    );
  }

  logger.info({
    action: "UPDATE_EXPERIENCE",
    userId,
    experienceId,
  });

  return experience;
};

export const deleteExperience = async (
  experienceId,
  userId,
) => {
  const experience =
    await Experience.findOneAndDelete({
      _id: experienceId,
      user: userId,
    });

  if (!experience) {
    logger.warn({
      action: "DELETE_EXPERIENCE",
      userId,
      experienceId,
      message: "Experience not found",
    });

    throw new Error(
      "Experience not found",
    );
  }

  logger.info({
    action: "DELETE_EXPERIENCE",
    userId,
    experienceId,
  });

  return experience;
};