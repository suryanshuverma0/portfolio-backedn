import Settings from "./settings.model.js";

export const createSettings = async (userId, settingsData) => {
  const existingSettings = await Settings.findOne({ user: userId });

  if (existingSettings) {
    throw new Error("Settings already exist");
  }

  const settings = await Settings.create({
    user: userId,
    ...settingsData,
  });

  return settings;
};

export const getSettings = async (userId) => {
  const settings = await Settings.findOne({ user: userId });

  if (!settings) {
    throw new Error("Settings not found");
  }

  return settings;
};

export const updateSettings = async (userId, updateData) => {
  const settings = await Settings.findOneAndUpdate(
    { user: userId },
    { $set: updateData },
    { new: true, runValidators: true },
  );

  if (!settings) {
    throw new Error("Settings not found");
  }

  return settings;
};

export const getPublicSettings = async () => {
  const settings = await Settings.findOne({});

  if (!settings) {
    throw new Error("Settings not found");
  }

  return settings;
};
