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

export const getStats = async (
  userId,
) => {
  return await Stat.find({
    user: userId,
  }).sort({ order: 1 });
};

export const getPublicStats =
  async () => {
    return await Stat.find({
      isVisible: true,
    }).sort({ order: 1 });
  };

export const updateStat = async (
  statId,
  userId,
  updateData,
) => {
  const stat =
    await Stat.findOneAndUpdate(
      {
        _id: statId,
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

  if (!stat) {
    throw new Error("Stat not found");
  }

  return stat;
};

export const deleteStat = async (
  statId,
  userId,
) => {
  const stat =
    await Stat.findOneAndDelete({
      _id: statId,
      user: userId,
    });

  if (!stat) {
    throw new Error("Stat not found");
  }

  return stat;
};