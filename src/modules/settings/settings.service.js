import Settings from "./settings.model.js";

// Settings is a single shared document, same as Profile — not scoped per
// admin account. `user` is kept as a "created by" reference only.
export const createSettings = async (userId, settingsData) => {
  const existingSettings = await Settings.findOne({});

  if (existingSettings) {
    throw new Error("Settings already exist");
  }

  const settings = await Settings.create({
    user: userId,
    ...settingsData,
  });

  return settings;
};

export const getSettings = async () => {
  const settings = await Settings.findOne({});

  if (!settings) {
    throw new Error("Settings not found");
  }

  return settings;
};

export const updateSettings = async (updateData) => {
  const settings = await Settings.findOneAndUpdate(
    {},
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
