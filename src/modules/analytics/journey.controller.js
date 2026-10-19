import {
  collectEvents,
  listSessions,
  getSessionDetail,
  deleteSession,
  getLiveSessions,
  getJourneyInsights,
  isValidTimezone,
} from "./journey.service.js";
import { getVisitorNetworkMeta } from "./analytics.utils.js";

const DEVICES = ["desktop", "mobile", "tablet"];

const clampInt = (value, min, max, fallback) =>
  Math.min(max, Math.max(min, Number.parseInt(value, 10) || fallback));

// navigator.sendBeacon can only send CORS-safelisted content types without a
// preflight, so the tracker posts JSON as text/plain. Parse it here, before
// validate() runs.
export const parseBeaconBody = (req, res, next) => {
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ success: false, message: "Invalid JSON body" });
    }
  }

  next();
};

export const collectController = async (req, res, next) => {
  try {
    await collectEvents(req.validatedData, getVisitorNetworkMeta(req));

    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

export const listSessionsController = async (req, res, next) => {
  try {
    const device = DEVICES.includes(req.query.device) ? req.query.device : undefined;
    const country =
      typeof req.query.country === "string" && /^[a-z]{2}$/i.test(req.query.country)
        ? req.query.country
        : undefined;
    const search =
      typeof req.query.search === "string" && req.query.search.trim()
        ? req.query.search.trim().slice(0, 100)
        : undefined;

    const data = await listSessions({
      page: clampInt(req.query.page, 1, 100000, 1),
      limit: clampInt(req.query.limit, 1, 100, 25),
      rangeDays: clampInt(req.query.range, 1, 3650, 30),
      search,
      device,
      country,
      includeBots: req.query.bots === "true",
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getSessionDetailController = async (req, res, next) => {
  try {
    const data = await getSessionDetail(String(req.params.sessionId).slice(0, 100));

    if (!data) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const deleteSessionController = async (req, res, next) => {
  try {
    const deleted = await deleteSession(String(req.params.sessionId).slice(0, 100));

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Session not found" });
    }

    res.status(200).json({ success: true, message: "Session deleted" });
  } catch (error) {
    next(error);
  }
};

export const getLiveSessionsController = async (req, res, next) => {
  try {
    const data = await getLiveSessions();

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getJourneyInsightsController = async (req, res, next) => {
  try {
    const timezone =
      typeof req.query.tz === "string" && isValidTimezone(req.query.tz) ? req.query.tz : "UTC";

    const data = await getJourneyInsights(clampInt(req.query.range, 1, 3650, 30), timezone);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
