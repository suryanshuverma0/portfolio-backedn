import PageView from "./analytics.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const LIVE_WINDOW_MS = 2 * MINUTE_MS;
const MAX_EVENTS_PER_SESSION_DETAIL = 2000;

const INTERACTION_TYPES = ["click", "outbound_click", "download", "contact_link", "form_submit"];

// /card (the NFC business card) has its own analytics page, so portfolio
// analytics leave it out: card events are filtered by path, and sessions
// that only ever opened the card have portfolioPageViews 0. Sessions from
// before the field existed have no value and are kept.
export const CARD_PATH = /^\/card(\/|$)/;
export const NOT_CARD_PATH = { $not: CARD_PATH };
export const PORTFOLIO_SESSION = { portfolioPageViews: { $ne: 0 } };

const durationExpr = { $subtract: ["$lastSeenAt", "$startedAt"] };

// A bounce = landed on one page and left within 10 seconds.
const bounceExpr = {
  $and: [{ $lte: ["$pageViews", 1] }, { $lt: [durationExpr, 10 * 1000] }],
};

const SESSION_SUMMARY_FIELDS = {
  sessionId: 1,
  visitorId: 1,
  ip: 1,
  location: 1,
  device: 1,
  deviceVendor: 1,
  deviceModel: 1,
  browser: 1,
  browserVersion: 1,
  os: 1,
  osVersion: 1,
  isBot: 1,
  screen: 1,
  language: 1,
  timezone: 1,
  referrer: 1,
  utm: 1,
  startedAt: 1,
  lastSeenAt: 1,
  entryPage: 1,
  exitPage: 1,
  pageViews: 1,
  eventCount: 1,
  activeTimeMs: 1,
  maxScrollDepth: 1,
};

const withDuration = (session) => ({
  ...session,
  durationMs: Math.max(0, new Date(session.lastSeenAt) - new Date(session.startedAt)),
});

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isValidTimezone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

// Drops undefined keys (recursively for plain objects) so $setOnInsert
// never writes explicit nulls/empties for data we simply didn't have.
const compact = (obj) =>
  Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
          ? compact(value)
          : value,
      ]),
  );

const upsertSession = (filter, update) =>
  VisitorSession.updateOne(filter, update, { upsert: true });

export const collectEvents = async ({ sessionId, visitorId, sentAt, context = {}, events }, network) => {
  const now = Date.now();

  // Client clocks can be off by minutes/hours — shift every event by the
  // difference between the client's send time and our receive time, then
  // clamp into a sane window.
  const skew = now - sentAt;
  const toDate = (ts) => new Date(Math.min(now, Math.max(now - DAY_MS, ts + skew)));

  const timed = events
    .map((event) => ({ ...event, at: toDate(event.ts) }))
    .sort((a, b) => a.at - b.at);

  const persisted = timed.filter((event) => event.type !== "heartbeat");
  const pageViews = persisted.filter((event) => event.type === "page_view");
  const portfolioPageViews = pageViews.filter((event) => !CARD_PATH.test(event.path || ""));
  const withPath = timed.filter((event) => event.path);

  const activeTimeMs = timed
    .filter((event) => event.type === "heartbeat")
    .reduce((sum, event) => sum + Math.min(event.value || 0, 5 * MINUTE_MS), 0);

  const maxScrollDepth = Math.min(
    100,
    Math.max(0, ...timed.filter((e) => e.type === "scroll_depth").map((e) => e.value || 0)),
  );

  const update = {
    $setOnInsert: compact({
      sessionId,
      visitorId,
      ...network,
      ...context,
    }),
    // $min/$max rather than $setOnInsert so batches arriving out of order
    // (beacon vs. fetch) still produce the right session bounds.
    $min: { startedAt: timed[0].at },
    $max: { lastSeenAt: timed[timed.length - 1].at, maxScrollDepth },
    $inc: {
      pageViews: pageViews.length,
      portfolioPageViews: portfolioPageViews.length,
      cardViews: pageViews.length - portfolioPageViews.length,
      eventCount: persisted.length,
      activeTimeMs: Math.round(activeTimeMs),
    },
  };

  try {
    await upsertSession({ sessionId }, update);
  } catch (error) {
    // Two batches of a brand-new session racing each other: the loser hits
    // the unique index, but the document exists now, so retrying updates it.
    if (error.code !== 11000) throw error;

    await upsertSession({ sessionId }, update);
  }

  // Entry/exit page follow event time, not arrival order — only overwrite
  // when this batch has an earlier first / later last event.
  if (withPath.length) {
    const first = pageViews[0] || withPath[0];
    const last = withPath[withPath.length - 1];

    await Promise.all([
      VisitorSession.updateOne(
        { sessionId, $or: [{ entryAt: { $exists: false } }, { entryAt: { $gt: first.at } }] },
        { $set: { entryPage: first.path, entryAt: first.at } },
      ),
      VisitorSession.updateOne(
        { sessionId, $or: [{ exitAt: { $exists: false } }, { exitAt: { $lte: last.at } }] },
        { $set: { exitPage: last.path, exitAt: last.at } },
      ),
    ]);
  }

  if (persisted.length) {
    await VisitorEvent.insertMany(
      persisted.map(({ ts, ...event }) => ({ ...event, sessionId, visitorId })),
      { ordered: false },
    );
  }

  // Keep the legacy PageView collection fed so the existing Analytics
  // overview and dashboard numbers stay accurate.
  if (portfolioPageViews.length && !network.isBot) {
    await PageView.insertMany(
      portfolioPageViews.map((event) => ({
        path: event.path,
        referrer: context.referrer,
        visitorId,
        device: network.device,
        browser: network.browser,
        os: network.os,
        country: network.location?.country,
        createdAt: event.at,
        updatedAt: event.at,
      })),
      { ordered: false },
    );
  }

  logger.debug({ action: "COLLECT_EVENTS", sessionId, count: events.length });
};

// ---------------------------------------------------------------------------
// Admin queries
// ---------------------------------------------------------------------------

export const listSessions = async ({
  page = 1,
  limit = 25,
  rangeDays = 30,
  search,
  device,
  country,
  includeBots = false,
}) => {
  const filter = {
    startedAt: { $gte: new Date(Date.now() - rangeDays * DAY_MS) },
  };

  if (!includeBots) filter.isBot = { $ne: true };
  Object.assign(filter, PORTFOLIO_SESSION);
  if (device) filter.device = device;
  if (country) filter["location.country"] = country.toUpperCase();

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");

    filter.$or = [
      { ip: pattern },
      { "location.city": pattern },
      { "location.region": pattern },
      { visitorId: pattern },
      { sessionId: pattern },
      { referrer: pattern },
      { "utm.source": pattern },
      { "utm.campaign": pattern },
      { entryPage: pattern },
    ];
  }

  const [sessions, total] = await Promise.all([
    VisitorSession.find(filter)
      .sort({ lastSeenAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select(SESSION_SUMMARY_FIELDS)
      .lean(),
    VisitorSession.countDocuments(filter),
  ]);

  // How many sessions each visitor on this page has had overall — lets the
  // table flag returning visitors.
  const visitorIds = [...new Set(sessions.map((s) => s.visitorId))];
  const visitCounts = visitorIds.length
    ? await VisitorSession.aggregate([
        { $match: { visitorId: { $in: visitorIds } } },
        { $group: { _id: "$visitorId", count: { $sum: 1 } } },
      ])
    : [];
  const visitCountMap = new Map(visitCounts.map((row) => [row._id, row.count]));

  return {
    sessions: sessions.map((session) => ({
      ...withDuration(session),
      visitCount: visitCountMap.get(session.visitorId) || 1,
      isLive: Date.now() - new Date(session.lastSeenAt) < LIVE_WINDOW_MS,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getSessionDetail = async (sessionId) => {
  const session = await VisitorSession.findOne({ sessionId }).lean();

  if (!session) return null;

  const [events, history, visitCount] = await Promise.all([
    VisitorEvent.find({ sessionId })
      .sort({ at: 1 })
      .limit(MAX_EVENTS_PER_SESSION_DETAIL)
      .select("-__v")
      .lean(),
    VisitorSession.find({ visitorId: session.visitorId })
      .sort({ startedAt: -1 })
      .limit(25)
      .select(SESSION_SUMMARY_FIELDS)
      .lean(),
    VisitorSession.countDocuments({ visitorId: session.visitorId }),
  ]);

  return {
    session: {
      ...withDuration(session),
      isLive: Date.now() - new Date(session.lastSeenAt) < LIVE_WINDOW_MS,
    },
    events,
    visitor: {
      visitorId: session.visitorId,
      visitCount,
      firstSeenAt: history[history.length - 1]?.startedAt,
      sessions: history.map(withDuration),
    },
  };
};

export const deleteSession = async (sessionId) => {
  const { deletedCount } = await VisitorSession.deleteOne({ sessionId });

  if (deletedCount) {
    await VisitorEvent.deleteMany({ sessionId });
  }

  return deletedCount > 0;
};

export const getLiveSessions = async () => {
  const sessions = await VisitorSession.find({
    lastSeenAt: { $gte: new Date(Date.now() - LIVE_WINDOW_MS) },
    isBot: { $ne: true },
    ...PORTFOLIO_SESSION,
  })
    .sort({ lastSeenAt: -1 })
    .limit(50)
    .select(SESSION_SUMMARY_FIELDS)
    .lean();

  if (!sessions.length) return [];

  const lastEvents = await VisitorEvent.aggregate([
    { $match: { sessionId: { $in: sessions.map((s) => s.sessionId) } } },
    { $sort: { at: -1 } },
    {
      $group: {
        _id: "$sessionId",
        type: { $first: "$type" },
        label: { $first: "$label" },
        section: { $first: "$section" },
        path: { $first: "$path" },
        at: { $first: "$at" },
      },
    },
  ]);
  const lastEventMap = new Map(lastEvents.map((row) => [row._id, row]));

  return sessions.map((session) => ({
    ...withDuration(session),
    lastEvent: lastEventMap.get(session.sessionId) || null,
  }));
};

const DURATION_BUCKETS = [
  { label: "< 10s", max: 10 * 1000 },
  { label: "10–30s", max: 30 * 1000 },
  { label: "30s–1m", max: MINUTE_MS },
  { label: "1–3m", max: 3 * MINUTE_MS },
  { label: "3–10m", max: 10 * MINUTE_MS },
  { label: "10m+", max: Infinity },
];

export const getJourneyInsights = async (rangeDays, timezone) => {
  return getOrSetCache(`analytics:journey:${rangeDays}:${timezone}`, 120, async () => {
    const since = new Date(Date.now() - rangeDays * DAY_MS);
    const sessionMatch = { startedAt: { $gte: since }, isBot: { $ne: true }, ...PORTFOLIO_SESSION };

    const [
      totalsRows,
      sectionRows,
      clickRows,
      heatmapRows,
      cityRows,
      entryRows,
      exitRows,
      campaignRows,
      durationRows,
    ] = await Promise.all([
      VisitorSession.aggregate([
        { $match: sessionMatch },
        {
          $group: {
            _id: null,
            sessions: { $sum: 1 },
            visitors: { $addToSet: "$visitorId" },
            avgDurationMs: { $avg: durationExpr },
            avgActiveTimeMs: { $avg: "$activeTimeMs" },
            avgPageViews: { $avg: "$pageViews" },
            avgScrollDepth: { $avg: "$maxScrollDepth" },
            bounces: { $sum: { $cond: [bounceExpr, 1, 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            sessions: 1,
            visitors: { $size: "$visitors" },
            avgDurationMs: 1,
            avgActiveTimeMs: 1,
            avgPageViews: 1,
            avgScrollDepth: 1,
            bounces: 1,
          },
        },
      ]),

      VisitorEvent.aggregate([
        { $match: { type: "section_view", at: { $gte: since }, path: NOT_CARD_PATH } },
        {
          $group: {
            _id: "$section",
            views: { $sum: 1 },
            sessions: { $addToSet: "$sessionId" },
            avgDwellMs: { $avg: "$value" },
            totalDwellMs: { $sum: "$value" },
          },
        },
        {
          $project: {
            views: 1,
            sessions: { $size: "$sessions" },
            avgDwellMs: 1,
            totalDwellMs: 1,
          },
        },
      ]),

      VisitorEvent.aggregate([
        { $match: { type: { $in: INTERACTION_TYPES }, at: { $gte: since }, path: NOT_CARD_PATH } },
        {
          $group: {
            _id: { type: "$type", label: "$label", target: "$target" },
            count: { $sum: 1 },
            sessions: { $addToSet: "$sessionId" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 15 },
        { $project: { count: 1, sessions: { $size: "$sessions" } } },
      ]),

      VisitorSession.aggregate([
        { $match: sessionMatch },
        {
          $group: {
            _id: {
              day: { $dayOfWeek: { date: "$startedAt", timezone } },
              hour: { $hour: { date: "$startedAt", timezone } },
            },
            count: { $sum: 1 },
          },
        },
      ]),

      VisitorSession.aggregate([
        { $match: { ...sessionMatch, "location.city": { $nin: [null, ""] } } },
        {
          $group: {
            _id: { city: "$location.city", country: "$location.country" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),

      VisitorSession.aggregate([
        { $match: sessionMatch },
        { $group: { _id: "$entryPage", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),

      VisitorSession.aggregate([
        { $match: sessionMatch },
        { $group: { _id: "$exitPage", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
      ]),

      VisitorSession.aggregate([
        { $match: { ...sessionMatch, "utm.source": { $nin: [null, ""] } } },
        {
          $group: {
            _id: { source: "$utm.source", medium: "$utm.medium", campaign: "$utm.campaign" },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),

      VisitorSession.aggregate([
        { $match: sessionMatch },
        { $project: { durationMs: durationExpr } },
        {
          $bucket: {
            groupBy: "$durationMs",
            boundaries: [0, ...DURATION_BUCKETS.slice(0, -1).map((b) => b.max), Number.MAX_SAFE_INTEGER],
            default: "other",
            output: { count: { $sum: 1 } },
          },
        },
      ]),
    ]);

    const totals = totalsRows[0] || {
      sessions: 0,
      visitors: 0,
      avgDurationMs: 0,
      avgActiveTimeMs: 0,
      avgPageViews: 0,
      avgScrollDepth: 0,
      bounces: 0,
    };

    const durationCounts = new Map(durationRows.map((row) => [row._id, row.count]));
    const bucketStarts = [0, ...DURATION_BUCKETS.slice(0, -1).map((b) => b.max)];

    return {
      totals: {
        ...totals,
        avgDurationMs: Math.round(totals.avgDurationMs || 0),
        avgActiveTimeMs: Math.round(totals.avgActiveTimeMs || 0),
        avgPageViews: Math.round((totals.avgPageViews || 0) * 10) / 10,
        avgScrollDepth: Math.round(totals.avgScrollDepth || 0),
        bounceRate:
          totals.sessions > 0 ? Math.round((totals.bounces / totals.sessions) * 1000) / 10 : 0,
      },
      sections: sectionRows
        .filter((row) => row._id)
        .map((row) => ({
          section: row._id,
          views: row.views,
          sessions: row.sessions,
          reachPercent:
            totals.sessions > 0 ? Math.min(100, Math.round((row.sessions / totals.sessions) * 1000) / 10) : 0,
          avgDwellMs: Math.round(row.avgDwellMs || 0),
          totalDwellMs: Math.round(row.totalDwellMs || 0),
        })),
      topInteractions: clickRows.map((row) => ({
        type: row._id.type,
        label: row._id.label || row._id.target || "Unlabelled",
        target: row._id.target,
        count: row.count,
        sessions: row.sessions,
      })),
      heatmap: heatmapRows.map((row) => ({
        // Mongo's $dayOfWeek is 1 (Sun) … 7 (Sat); normalise to 0–6.
        day: row._id.day - 1,
        hour: row._id.hour,
        count: row.count,
      })),
      topCities: cityRows.map((row) => ({
        city: row._id.city,
        country: row._id.country,
        count: row.count,
      })),
      entryPages: entryRows.map((row) => ({ path: row._id || "Unknown", count: row.count })),
      exitPages: exitRows.map((row) => ({ path: row._id || "Unknown", count: row.count })),
      campaigns: campaignRows.map((row) => ({ ...row._id, count: row.count })),
      durationDistribution: DURATION_BUCKETS.map((bucket, index) => ({
        label: bucket.label,
        count: durationCounts.get(bucketStarts[index]) || 0,
      })),
      timezone,
    };
  });
};
