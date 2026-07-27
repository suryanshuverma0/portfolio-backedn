import Education from "./education.model.js";

export const createEducation = async (userId, educationData) => {
  const education = await Education.create({
    user: userId,
    ...educationData,
  });

  return education;
};

// Shared site content — not scoped per admin account. Any admin can list,
// edit, or delete any item.
export const getEducations = async () => {
  return await Education.find({}).sort({ order: 1 });
};

export const getPublicEducations = async () => {
  return await Education.find({
    isVisible: true,
  }).sort({ order: 1 });
};

export const updateEducation = async (educationId, updateData) => {
  const education = await Education.findOneAndUpdate(
    {
      _id: educationId,
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

export const deleteEducation = async (educationId) => {
  const education = await Education.findOneAndDelete({
    _id: educationId,
  });

  if (!education) {
    throw new Error("Education not found");
  }

  return education;
};
