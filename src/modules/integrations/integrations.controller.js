import {
  getGitHubStats,
  getLeetCodeStats,
  getIntegrationsStatus,
} from "./integrations.service.js";

export const getGitHubStatsController = async (req, res, next) => {
  try {
    const stats = await getGitHubStats();

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

export const getLeetCodeStatsController = async (req, res, next) => {
  try {
    const stats = await getLeetCodeStats();

    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

// Combined endpoint so the public homepage can load both with one request
// — each source fails independently (never blocks the other) since this
// calls the same Promise.allSettled-based service function.
export const getIntegrationsStatusController = async (req, res, next) => {
  try {
    const status = await getIntegrationsStatus();

    res.status(200).json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
};
