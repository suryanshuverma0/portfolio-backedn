import Profile from "./profile.model.js";

export const createProfile = async (userId, profileData) => {
  const existingProfile = await Profile.findOne({
    user: userId,
  });

  if (existingProfile) {
    throw new Error("Profile already exists");
  }

  const profile = await Profile.create({
    user: userId,

    ...profileData,
  });

  return profile;
};

export const getProfile = async (userId) => {
  const profile = await Profile.findOne({
    user: userId,
  }).populate("user", "email role");

  if (!profile) {
    throw new Error("Profile not found");
  }

  return profile;
};

export const updateProfile = async (userId, updateData) => {
  const profile = await Profile.findOneAndUpdate(
    {
      user: userId,
    },

    {
      $set: updateData,
    },

    {
      new: true,
      runValidators: true,
    },
  ).populate("user", "email role");

  if (!profile) {
    throw new Error("Profile not found");
  }

  return profile;
};

export const getPublicProfile = async () => {
  const profile = await Profile.findOne({
    isVisible: true,
  });

  if (!profile) {
    throw new Error("Profile not found");
  }

  return profile;
};
