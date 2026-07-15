import {
  trackPageView,
  getOverview,
  getDashboardSummary,
} from "./analytics.service.js";

export const trackController = async (req, res, next) => {
  try {
    await trackPageView(req.validatedData);

    res.status(201).json({
      success: true,
      message: "Page view tracked",
    });
  } catch (error) {
    next(error);
  }
};

export const getOverviewController = async (req, res, next) => {
  try {
    const range = Math.min(90, Math.max(1, Number(req.query.range) || 30));

    const overview = await getOverview(range);

    res.status(200).json({
      success: true,
      data: overview,
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboardSummaryController = async (req, res, next) => {
  try {
    const summary = await getDashboardSummary();

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    next(error);
  }
};
