import Profile from "./profile.model.js";

// Profile is a single shared document (a single-owner portfolio, possibly
// edited by more than one trusted admin) — not scoped per-account.
// `user` is kept on the record as a "created by" reference only.
export const createProfile = async (userId, profileData) => {
  const existingProfile = await Profile.findOne({});

  if (existingProfile) {
    throw new Error("Profile already exists");
  }

  const profile = await Profile.create({
    user: userId,

    ...profileData,
  });

  return profile;
};

export const getProfile = async () => {
  const profile = await Profile.findOne({}).populate("user", "email role");

  if (!profile) {
    throw new Error("Profile not found");
  }

  return profile;
};

export const updateProfile = async (updateData) => {
  const profile = await Profile.findOneAndUpdate(
    {},

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
