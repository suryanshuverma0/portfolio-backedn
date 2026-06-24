import {
  createStat,
  getStats,
  getPublicStats,
  updateStat,
  deleteStat,
} from "./stat.service.js";

export const createStatController = async (req, res, next) => {
  try {
    const stat = await createStat(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Stat created successfully",
      data: stat,
    });
  } catch (error) {
    next(error);
  }
};

export const getStatsController = async (req, res, next) => {
  try {
    const stats = await getStats(req.user._id);

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicStatsController = async (req, res, next) => {
  try {
    const stats = await getPublicStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const updateStatController = async (req, res, next) => {
  try {
    const stat = await updateStat(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Stat updated successfully",
      data: stat,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteStatController = async (req, res, next) => {
  try {
    await deleteStat(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Stat deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
