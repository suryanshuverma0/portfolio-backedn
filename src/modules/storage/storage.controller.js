import { getStorageOverview } from "./storage.service.js";

export const getStorageOverviewController = async (req, res, next) => {
  try {
    const data = await getStorageOverview({ refresh: req.query.refresh === "true" });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
