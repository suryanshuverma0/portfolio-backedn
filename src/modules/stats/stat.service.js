import Stat from "./stat.model.js";

export const createStat = async (
  userId,
  statData,
) => {
  const stat = await Stat.create({
    user: userId,
    ...statData,
  });

  return stat;
};

// Shared site content — not scoped per admin account.
export const getStats = async () => {
  return await Stat.find({}).sort({ order: 1 });
};

export const getPublicStats =
  async () => {
    return await Stat.find({
      isVisible: true,
    }).sort({ order: 1 });
  };

export const updateStat = async (
  statId,
  updateData,
) => {
  const stat =
    await Stat.findOneAndUpdate(
      {
        _id: statId,
      },
      {
        $set: updateData,
      },
      {
        new: true,
        runValidators: true,
      },
    );

  if (!stat) {
    throw new Error("Stat not found");
  }

  return stat;
};

export const deleteStat = async (
  statId,
) => {
  const stat =
    await Stat.findOneAndDelete({
      _id: statId,
    });

  if (!stat) {
    throw new Error("Stat not found");
  }

  return stat;
};