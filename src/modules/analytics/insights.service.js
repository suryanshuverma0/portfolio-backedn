import PageView from "./analytics.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import { NOT_CARD_PATH, PORTFOLIO_SESSION } from "./journey.service.js";

// ---------------------------------------------------------------------------
// Deeper analytics for the admin Analytics page, built on the journey data
// (sessions + events) plus the PageView collection. Everything is bucketed
// in the admin's timezone so "per day" / "per hour" match their clock.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const CONVERSION_TYPES = ["form_submit", "download", "contact_link", "outbound_click"];

const round1 = (n) => Math.round(n * 10) / 10;

const percentChange = (current, previous) => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return round1(((current - previous) / previous) * 100);
};

const avg = (values) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

const durationOf = (s) => Math.max(0, new Date(s.lastSeenAt) - new Date(s.startedAt));

const dayFormatter = (timezone) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const hourFormatter = (timezone) =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" });

const KNOWN_HOSTS = {
  "github.com": "GitHub",
  "linkedin.com": "LinkedIn",
  "x.com": "X (Twitter)",
  "twitter.com": "X (Twitter)",
  "leetcode.com": "LeetCode",
  "medium.com": "Medium",
  "dev.to": "DEV",
  "youtube.com": "YouTube",
  "instagram.com": "Instagram",
  "facebook.com": "Facebook",
  "vercel.app": "Vercel app",
  "netlify.app": "Netlify app",
};

const hostLabel = (target) => {
  try {
    const host = new URL(target).hostname.replace(/^www\./, "");
    const known = Object.keys(KNOWN_HOSTS).find((h) => host === h || host.endsWith(`.${h}`));
    return { host, label: known ? KNOWN_HOSTS[known] : host };
  } catch {
    return null;
  }
};

const topCounts = (values, limit, total = values.length) => {
  const counts = new Map();
  values.filter(Boolean).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      percent: total > 0 ? round1((count / total) * 100) : 0,
    }));
};

// Per-path stats for a prefix (/projects/, /blog/): views, unique sessions,
// average visible time and how far down people scrolled.
const pageStats = async (prefix, since) => {
  const pathMatch = { $regex: `^${prefix.replace(/\//g, "\\/")}.+` };

  const [views, leaves, scrolls] = await Promise.all([
    VisitorEvent.aggregate([
      { $match: { type: "page_view", at: { $gte: since }, path: pathMatch } },
      { $group: { _id: "$path", views: { $sum: 1 }, sessions: { $addToSet: "$sessionId" } } },
      { $project: { views: 1, sessions: { $size: "$sessions" } } },
      { $sort: { views: -1 } },
      { $limit: 10 },
    ]),
    VisitorEvent.aggregate([
      { $match: { type: "page_leave", at: { $gte: since }, path: pathMatch } },
      { $group: { _id: "$path", avgTimeMs: { $avg: "$value" } } },
    ]),
    VisitorEvent.aggregate([
      { $match: { type: "scroll_depth", at: { $gte: since }, path: pathMatch } },
      { $group: { _id: { path: "$path", sessionId: "$sessionId" }, depth: { $max: "$value" } } },
      { $group: { _id: "$_id.path", avgScroll: { $avg: "$depth" } } },
    ]),
  ]);

  const leaveMap = new Map(leaves.map((r) => [r._id, r.avgTimeMs]));
  const scrollMap = new Map(scrolls.map((r) => [r._id, r.avgScroll]));

  return views.map((row) => ({
    path: row._id,
    slug: row._id.slice(prefix.length),
    views: row.views,
    sessions: row.sessions,
    avgTimeMs: Math.round(leaveMap.get(row._id) || 0),
    avgScroll: Math.round(scrollMap.get(row._id) || 0),
  }));
};

export const getAdvancedInsights = async (rangeDays, timezone) => {
  return getOrSetCache(`analytics:insights:v1:${rangeDays}:${timezone}`, 300, async () => {
    const now = Date.now();
    const since = new Date(now - rangeDays * DAY_MS);
    const previousSince = new Date(since.getTime() - rangeDays * DAY_MS);
    const toDay = dayFormatter(timezone);
    const toHour = hourFormatter(timezone);

    const sessionMatch = { startedAt: { $gte: since }, isBot: { $ne: true }, ...PORTFOLIO_SESSION };

    const [
      sessions,
      viewsByDayRows,
      visitorsByDayRows,
      conversionRows,
      projectsSeenIds,
      interactedIds,
      contactedIds,
      outboundRows,
      timeOnPageRows,
      topProjects,
      topPosts,
    ] = await Promise.all([
      VisitorSession.find(sessionMatch)
        .select("visitorId sessionId startedAt lastSeenAt activeTimeMs maxScrollDepth pageViews device os screen language")
        .lean(),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } },
            count: { $sum: 1 },
          },
        },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } },
              visitorId: "$visitorId",
            },
          },
        },
        { $group: { _id: "$_id.day", count: { $sum: 1 } } },
      ]),

      VisitorEvent.aggregate([
        { $match: { type: { $in: CONVERSION_TYPES }, at: { $gte: previousSince }, path: NOT_CARD_PATH } },
        {
          $group: {
            _id: { type: "$type", current: { $gte: ["$at", since] } },
            count: { $sum: 1 },
          },
        },
      ]),

      VisitorEvent.distinct("sessionId", {
        at: { $gte: since },
        $or: [
          { type: "section_view", section: "projects" },
          { type: "page_view", path: { $regex: "^\\/projects\\/" } },
        ],
      }),

      VisitorEvent.distinct("sessionId", {
        at: { $gte: since },
        type: { $in: ["click", ...CONVERSION_TYPES] },
        path: NOT_CARD_PATH,
      }),

      VisitorEvent.distinct("sessionId", {
        at: { $gte: since },
        type: { $in: ["form_submit", "contact_link"] },
        path: NOT_CARD_PATH,
      }),

      VisitorEvent.aggregate([
        { $match: { type: "outbound_click", at: { $gte: since }, target: { $nin: [null, ""] }, path: NOT_CARD_PATH } },
        { $group: { _id: "$target", count: { $sum: 1 } } },
      ]),

      VisitorEvent.aggregate([
        { $match: { type: "page_leave", at: { $gte: since }, value: { $gt: 0 }, path: NOT_CARD_PATH } },
        { $group: { _id: "$path", avgTimeMs: { $avg: "$value" }, views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 8 },
      ]),

      pageStats("/projects/", since),
      pageStats("/blog/", since),
    ]);

    // ---- first-ever session per visitor → new vs returning ----
    const visitorIds = [...new Set(sessions.map((s) => s.visitorId))];
    const firstSeenRows = visitorIds.length
      ? await VisitorSession.aggregate([
          { $match: { visitorId: { $in: visitorIds } } },
          { $group: { _id: "$visitorId", first: { $min: "$startedAt" } } },
        ])
      : [];
    const firstSeen = new Map(firstSeenRows.map((r) => [r._id, new Date(r.first).getTime()]));
    const isNewSession = (s) => firstSeen.get(s.visitorId) === new Date(s.startedAt).getTime();

    // ---- daily series ----
    const days = [];
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
      const key = toDay.format(new Date(now - i * DAY_MS));
      if (!days.includes(key)) days.push(key);
    }

    const viewsMap = new Map(viewsByDayRows.map((r) => [r._id, r.count]));
    const visitorsMap = new Map(visitorsByDayRows.map((r) => [r._id, r.count]));
    const sessionsByDay = new Map(days.map((d) => [d, []]));

    sessions.forEach((s) => {
      sessionsByDay.get(toDay.format(new Date(s.startedAt)))?.push(s);
    });

    const daily = days.map((date) => {
      const list = sessionsByDay.get(date) || [];
      const newCount = list.filter(isNewSession).length;

      return {
        date,
        views: viewsMap.get(date) || 0,
        visitors: visitorsMap.get(date) || 0,
        sessions: list.length,
        newSessions: newCount,
        returningSessions: list.length - newCount,
        avgDurationMs: Math.round(avg(list.map(durationOf))),
        avgActiveMs: Math.round(avg(list.map((s) => s.activeTimeMs || 0))),
      };
    });

    // ---- traffic by hour of day ----
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, sessions: 0 }));
    sessions.forEach((s) => {
      const hour = Number(toHour.format(new Date(s.startedAt))) % 24;
      hourly[hour].sessions += 1;
    });

    // ---- journey stages (share of sessions reaching each) ----
    const sessionIds = new Set(sessions.map((s) => s.sessionId));
    const inRange = (ids) => ids.filter((id) => sessionIds.has(id)).length;
    const total = sessions.length;
    const stage = (label, count, hint) => ({
      label,
      hint,
      count,
      percent: total > 0 ? round1((count / total) * 100) : 0,
    });

    const stages = [
      stage("Landed", total, "Every session"),
      stage("Stayed 30s+", sessions.filter((s) => durationOf(s) >= 30000).length, "Didn't bounce straight away"),
      stage("Scrolled halfway", sessions.filter((s) => (s.maxScrollDepth || 0) >= 50).length, "Reached 50% of a page"),
      stage("Saw projects", inRange(projectsSeenIds), "Projects section or a project page"),
      stage("Interacted", inRange(interactedIds), "Clicked a link, button or download"),
      stage("Got in touch", inRange(contactedIds), "Contact form or email/phone link"),
    ];

    // ---- conversions vs previous period ----
    const conversionCount = (type, current) =>
      conversionRows.find((r) => r._id.type === type && r._id.current === current)?.count || 0;

    const conversions = CONVERSION_TYPES.map((type) => {
      const current = conversionCount(type, true);
      const previous = conversionCount(type, false);
      return { type, current, previous, changePercent: percentChange(current, previous) };
    });

    // ---- outbound destinations by site ----
    const hostTotals = new Map();
    outboundRows.forEach((row) => {
      const parsed = hostLabel(row._id);
      if (!parsed) return;
      const entry = hostTotals.get(parsed.label) || { label: parsed.label, host: parsed.host, count: 0 };
      entry.count += row.count;
      hostTotals.set(parsed.label, entry);
    });

    // ---- engagement by device (one row per device, no dual axis) ----
    const deviceEngagement = ["desktop", "mobile", "tablet"]
      .map((device) => {
        const list = sessions.filter((s) => s.device === device);
        return {
          device,
          sessions: list.length,
          avgDurationMs: Math.round(avg(list.map(durationOf))),
          avgScroll: Math.round(avg(list.map((s) => s.maxScrollDepth || 0))),
          avgPages: round1(avg(list.map((s) => s.pageViews || 0))),
          bounceRate:
            list.length > 0
              ? round1(
                  (list.filter((s) => (s.pageViews || 0) <= 1 && durationOf(s) < 10000).length /
                    list.length) *
                    100,
                )
              : 0,
        };
      })
      .filter((row) => row.sessions > 0);

    return {
      timezone,
      daily,
      hourly,
      stages,
      conversions,
      outboundDestinations: [...hostTotals.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      timeOnPage: timeOnPageRows.map((r) => ({
        path: r._id,
        views: r.views,
        avgTimeMs: Math.round(r.avgTimeMs || 0),
      })),
      topProjects,
      topPosts,
      deviceEngagement,
      operatingSystems: topCounts(sessions.map((s) => s.os), 6),
      screens: topCounts(sessions.map((s) => s.screen), 6),
      languages: topCounts(sessions.map((s) => s.language?.split("-")[0]?.toLowerCase()), 6),
    };
  });
};
