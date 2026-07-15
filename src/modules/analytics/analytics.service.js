import PageView from "./analytics.model.js";
import Project from "../projects/project.model.js";
import Skill from "../skills/skills.model.js";
import Certificate from "../certificates/certificate.model.js";
import Experience from "../experience/experience.model.js";
import Service from "../services/service.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const formatDate = (date) => date.toISOString().slice(0, 10);

const buildViewsByDay = (rows, rangeDays) => {
  const counts = new Map(rows.map((row) => [row._id, row.count]));
  const today = startOfDay(new Date());

  const days = [];

  for (let i = rangeDays - 1; i >= 0; i -= 1) {
    const date = new Date(today.getTime() - i * DAY_MS);
    const key = formatDate(date);

    days.push({ date: key, count: counts.get(key) || 0 });
  }

  return days;
};

export const trackPageView = async ({ path, referrer, visitorId }) => {
  const pageView = await PageView.create({ path, referrer, visitorId });

  logger.info({
    action: "TRACK_PAGE_VIEW",
    path,
    visitorId,
  });

  return pageView;
};

export const getOverview = async (rangeDays) => {
  return getOrSetCache(`analytics:overview:${rangeDays}`, 300, async () => {
    const since = new Date(startOfDay(new Date()).getTime() - (rangeDays - 1) * DAY_MS);

    const [totalViews, visitorIds, viewsByDayRows, topPagesRows] = await Promise.all([
      PageView.countDocuments({ createdAt: { $gte: since } }),

      PageView.distinct("visitorId", { createdAt: { $gte: since } }),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$path", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
    ]);

    return {
      totalViews,
      uniqueVisitors: visitorIds.length,
      viewsByDay: buildViewsByDay(viewsByDayRows, rangeDays),
      topPages: topPagesRows.map((row) => ({ path: row._id, count: row.count })),
    };
  });
};

export const getDashboardSummary = async () => {
  return getOrSetCache("analytics:dashboard", 300, async () => {
    const todayStart = startOfDay(new Date());

    const [
      projects,
      skills,
      certificates,
      experience,
      services,
      viewsToday,
      overview,
    ] = await Promise.all([
      Project.countDocuments({}),
      Skill.countDocuments({}),
      Certificate.countDocuments({}),
      Experience.countDocuments({}),
      Service.countDocuments({}),
      PageView.countDocuments({ createdAt: { $gte: todayStart } }),
      getOverview(30),
    ]);

    return {
      projects,
      skills,
      certificates,
      experience,
      services,
      viewsToday,
      totalViews: overview.totalViews,
      uniqueVisitors: overview.uniqueVisitors,
    };
  });
};
