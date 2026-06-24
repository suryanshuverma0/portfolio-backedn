import Education from "./education.model.js";

export const createEducation = async (userId, educationData) => {
  const education = await Education.create({
    user: userId,
    ...educationData,
  });

  return education;
};

export const getEducations = async (userId) => {
  return await Education.find({
    user: userId,
  }).sort({ order: 1 });
};

export const getPublicEducations = async () => {
  return await Education.find({
    isVisible: true,
  }).sort({ order: 1 });
};

export const updateEducation = async (educationId, userId, updateData) => {
  const education = await Education.findOneAndUpdate(
    {
      _id: educationId,
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

  if (!education) {
    throw new Error("Education not found");
  }

  return education;
};

export const deleteEducation = async (educationId, userId) => {
  const education = await Education.findOneAndDelete({
    _id: educationId,
    user: userId,
  });

  if (!education) {
    throw new Error("Education not found");
  }

  return education;
};
