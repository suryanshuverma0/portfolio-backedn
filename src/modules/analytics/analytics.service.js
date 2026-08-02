import PageView from "./analytics.model.js";
import Project from "../projects/project.model.js";
import Skill from "../skills/skills.model.js";
import Certificate from "../certificates/certificate.model.js";
import Experience from "../experience/experience.model.js";
import Service from "../services/service.model.js";
import Post from "../blog/blog.model.js";
import Comment from "../blog/comment.model.js";
import Message from "../contact/contact.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

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

const SEARCH_ENGINES = ["google.", "bing.", "duckduckgo.", "yahoo.", "baidu.", "yandex."];
const SOCIAL_SITES = [
  "facebook.",
  "twitter.",
  "x.com",
  "linkedin.",
  "instagram.",
  "reddit.",
  "t.co",
  "pinterest.",
];

const categorizeReferrer = (referrer) => {
  if (!referrer) {
    return { source: "Direct", hostname: null };
  }

  let hostname;

  try {
    hostname = new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return { source: "Direct", hostname: null };
  }

  if (SEARCH_ENGINES.some((s) => hostname.includes(s))) {
    return { source: "Search", hostname };
  }

  if (SOCIAL_SITES.some((s) => hostname.includes(s))) {
    return { source: "Social", hostname };
  }

  return { source: "Referral", hostname };
};

const toPercentBreakdown = (rows, total) =>
  rows.map((row) => ({
    label: row._id || "Unknown",
    count: row.count,
    percent: total > 0 ? Math.round((row.count / total) * 1000) / 10 : 0,
  }));

const percentChange = (current, previous) => {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 1000) / 10;
};

export const trackPageView = async ({
  path,
  referrer,
  visitorId,
  device,
  browser,
  os,
  country,
}) => {
  const pageView = await PageView.create({
    path,
    referrer,
    visitorId,
    device,
    browser,
    os,
    country,
  });

  logger.info({
    action: "TRACK_PAGE_VIEW",
    path,
    visitorId,
  });

  return pageView;
};

const getCachedOverview = async (rangeDays) => {
  return getOrSetCache(`analytics:overview:${rangeDays}`, 300, async () => {
    const since = new Date(startOfDay(new Date()).getTime() - (rangeDays - 1) * DAY_MS);
    const previousSince = new Date(since.getTime() - rangeDays * DAY_MS);

    const [
      totalViews,
      visitorIds,
      returningVisitorIds,
      viewsByDayRows,
      topPagesRows,
      referrerRows,
      deviceRows,
      browserRows,
      countryRows,
      previousFacet,
    ] = await Promise.all([
      PageView.countDocuments({ createdAt: { $gte: since } }),

      PageView.distinct("visitorId", { createdAt: { $gte: since } }),

      // Visitors seen at any point BEFORE this range — used to split the
      // range's visitors into new vs. returning.
      PageView.distinct("visitorId", { createdAt: { $lt: since } }),

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

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$referrer", count: { $sum: 1 } } },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$device", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$browser", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since }, country: { $nin: [null, ""] } } },
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: previousSince, $lt: since } } },
        {
          $facet: {
            totalViews: [{ $count: "count" }],
            uniqueVisitors: [{ $group: { _id: "$visitorId" } }, { $count: "count" }],
          },
        },
      ]),
    ]);

    // --- referrers: category totals (Direct/Search/Social/Referral) + top named hostnames ---
    const categoryTotals = new Map();
    const hostnameTotals = new Map();

    for (const row of referrerRows) {
      const { source, hostname } = categorizeReferrer(row._id);

      categoryTotals.set(source, (categoryTotals.get(source) || 0) + row.count);

      if (source !== "Direct" && hostname) {
        hostnameTotals.set(hostname, (hostnameTotals.get(hostname) || 0) + row.count);
      }
    }

    const totalReferrerViews = referrerRows.reduce((sum, row) => sum + row.count, 0);

    const referrerSources = [...categoryTotals.entries()]
      .map(([label, count]) => ({
        label,
        count,
        percent:
          totalReferrerViews > 0 ? Math.round((count / totalReferrerViews) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const topReferrers = [...hostnameTotals.entries()]
      .map(([hostname, count]) => ({ hostname, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // --- device / browser / country breakdowns ---
    const deviceTotal = deviceRows.reduce((sum, row) => sum + row.count, 0);
    const deviceBreakdown = toPercentBreakdown(deviceRows, deviceTotal);

    const browserTotal = browserRows.reduce((sum, row) => sum + row.count, 0);
    const otherBrowsersCount = browserRows.slice(4).reduce((sum, row) => sum + row.count, 0);
    const browserBreakdown = toPercentBreakdown(browserRows.slice(0, 4), browserTotal);

    if (otherBrowsersCount > 0) {
      browserBreakdown.push({
        label: "Other",
        count: otherBrowsersCount,
        percent: browserTotal > 0 ? Math.round((otherBrowsersCount / browserTotal) * 1000) / 10 : 0,
      });
    }

    const topCountries = countryRows.slice(0, 6).map((row) => ({
      country: row._id,
      count: row.count,
    }));

    // --- new vs returning ---
    const returningSet = new Set(returningVisitorIds);
    const newVisitors = visitorIds.filter((id) => !returningSet.has(id)).length;
    const returningVisitors = visitorIds.length - newVisitors;

    // --- trend vs. the immediately preceding period of the same length ---
    const previousTotalViews = previousFacet[0]?.totalViews[0]?.count || 0;
    const previousUniqueVisitors = previousFacet[0]?.uniqueVisitors[0]?.count || 0;

    return {
      totalViews,
      uniqueVisitors: visitorIds.length,
      viewsByDay: buildViewsByDay(viewsByDayRows, rangeDays),
      topPages: topPagesRows.map((row) => ({ path: row._id, count: row.count })),
      topReferrers,
      referrerSources,
      deviceBreakdown,
      browserBreakdown,
      topCountries,
      newVsReturning: {
        new: newVisitors,
        returning: returningVisitors,
      },
      trend: {
        viewsChangePercent: percentChange(totalViews, previousTotalViews),
        visitorsChangePercent: percentChange(visitorIds.length, previousUniqueVisitors),
      },
    };
  });
};

export const getOverview = async (rangeDays) => {
  const [overview, activeVisitorIds] = await Promise.all([
    getCachedOverview(rangeDays),

    // Deliberately not cached, same reasoning as getDashboardSummary.
    PageView.distinct("visitorId", {
      createdAt: { $gte: new Date(Date.now() - 5 * MINUTE_MS) },
    }),
  ]);

  return {
    ...overview,
    activeNow: activeVisitorIds.length,
  };
};

export const getDashboardSummary = async () => {
  const [summary, activeVisitorIds] = await Promise.all([
    // v2: bumped the cache key so this can never return a stale pre-v2
    // cached blob (missing posts/unreadMessages/pendingComments/viewsByDay)
    // left over from before those fields existed — same key + old shape
    // would otherwise silently serve zeros for up to 5 minutes post-deploy.
    getOrSetCache("analytics:dashboard:v2", 300, async () => {
      const todayStart = startOfDay(new Date());

      const [
        projects,
        skills,
        certificates,
        experience,
        services,
        posts,
        unreadMessages,
        pendingComments,
        viewsToday,
        overview,
      ] = await Promise.all([
        Project.countDocuments({}),
        Skill.countDocuments({}),
        Certificate.countDocuments({}),
        Experience.countDocuments({}),
        Service.countDocuments({}),
        Post.countDocuments({}),
        Message.countDocuments({ isRead: false }),
        Comment.countDocuments({ isApproved: false }),
        PageView.countDocuments({ createdAt: { $gte: todayStart } }),
        getCachedOverview(30),
      ]);

      return {
        projects,
        skills,
        certificates,
        experience,
        services,
        posts,
        unreadMessages,
        pendingComments,
        viewsToday,
        totalViews: overview.totalViews,
        uniqueVisitors: overview.uniqueVisitors,
        trend: overview.trend,
        viewsByDay: overview.viewsByDay,
      };
    }),

    // Deliberately not cached — this is meant to feel live, and it's a
    // single cheap indexed query.
    PageView.distinct("visitorId", {
      createdAt: { $gte: new Date(Date.now() - 5 * MINUTE_MS) },
    }),
  ]);

  return {
    ...summary,
    activeNow: activeVisitorIds.length,
  };
};

// ---------------------------------------------------------------------------
// Recent Activity — a merged, most-recent-first feed built from each
// content module's own `createdAt` rather than a dedicated audit-log
// collection. Cheap (one small indexed query per module) and always
// consistent with the real data, at the cost of only covering
// create-time events, not every edit.
// ---------------------------------------------------------------------------

const ACTIVITY_SOURCE_LIMIT = 8;

export const getRecentActivity = async (limit = 12) => {
  return getOrSetCache(`analytics:recent-activity:${limit}`, 120, async () => {
    const [projects, certificates, posts, comments, messages] = await Promise.all([
      Project.find({})
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_SOURCE_LIMIT)
        .select("title createdAt")
        .lean(),

      Certificate.find({})
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_SOURCE_LIMIT)
        .select("title createdAt")
        .lean(),

      Post.find({})
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_SOURCE_LIMIT)
        .select("title isVisible createdAt")
        .lean(),

      Comment.find({})
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_SOURCE_LIMIT)
        .select("name content isApproved createdAt post")
        .populate("post", "title")
        .lean(),

      Message.find({})
        .sort({ createdAt: -1 })
        .limit(ACTIVITY_SOURCE_LIMIT)
        .select("name subject isRead createdAt")
        .lean(),
    ]);

    const items = [
      ...projects.map((p) => ({
        type: "project",
        id: String(p._id),
        title: p.title,
        detail: "New project published",
        createdAt: p.createdAt,
        link: "/dashboard/projects",
      })),

      ...certificates.map((c) => ({
        type: "certificate",
        id: String(c._id),
        title: c.title,
        detail: "New certificate added",
        createdAt: c.createdAt,
        link: "/dashboard/certificates",
      })),

      ...posts.map((p) => ({
        type: "blog",
        id: String(p._id),
        title: p.title,
        detail: p.isVisible ? "Post published" : "Draft saved",
        createdAt: p.createdAt,
        link: "/dashboard/blog",
      })),

      ...comments.map((c) => ({
        type: "comment",
        id: String(c._id),
        title: c.post?.title || "a post",
        detail: c.isApproved
          ? `${c.name} commented`
          : `${c.name} awaiting approval`,
        createdAt: c.createdAt,
        link: "/dashboard/blog/comments",
      })),

      ...messages.map((m) => ({
        type: "message",
        id: String(m._id),
        title: m.subject || `Message from ${m.name}`,
        detail: m.isRead ? "Message received" : "New unread message",
        createdAt: m.createdAt,
        link: "/dashboard/messages",
      })),
    ];

    return items
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  });
};
