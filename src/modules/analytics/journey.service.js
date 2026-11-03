import PageView from "./analytics.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";
import { checkLongVisit, notifyCompanyVisit, getAlertSettings } from "../alerts/alerts.service.js";
import { lookupIp, mergeLocation } from "./geo.service.js";
import { classifyOrg, cleanOrg, NOTABLE_TYPES } from "./network.classify.js";

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
  network: 1,
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

// Upgrades a new session's location (and adds ISP/ASN) from the online
// lookup. Runs after the tracker has been answered.
const enrichSessionGeo = async (sessionId, ip, location) => {
  const online = await lookupIp(ip);

  if (!online) return;

  const set = { location: mergeLocation(location, online.location) };
  const org = cleanOrg(online.network?.org);
  const type = classifyOrg(org);

  if (org || online.network?.asn) set.network = compact({ ...online.network, org: org || undefined, type: type || undefined });

  const session = await VisitorSession.findOneAndUpdate({ sessionId }, { $set: set }, { returnDocument: "after" }).lean();

  if (session && org && NOTABLE_TYPES.includes(type)) await notifyCompanyVisit(session, { org, type });
};

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

  let isNewSession = false;

  try {
    isNewSession = (await upsertSession({ sessionId }, update)).upsertedCount > 0;
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

  // Fire-and-forget: alerting must never slow down or fail the tracker.
  if (isNewSession && !network.isBot) {
    enrichSessionGeo(sessionId, network.ip, network.location).catch((error) =>
      logger.warn({ action: "GEO_ENRICH_FAILED", sessionId, error: error.message }),
    );
  }

  if (!network.isBot) {
    checkLongVisit(sessionId).catch((error) => logger.warn({ action: "LONG_VISIT_ALERT_FAILED", error: error.message }));
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
      { "location.regionName": pattern },
      { "network.org": pattern },
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

// ---------------------------------------------------------------------------
// Audience — who visits and what they use, plus how engaged each device /
// browser group is. One $facet pass over the range's sessions.
// ---------------------------------------------------------------------------

const topBy = (field, limit) => [
  { $group: { _id: { $ifNull: [field, null] }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: limit },
];

const engagementBy = (field) => [
  {
    $group: {
      _id: { $ifNull: [field, null] },
      sessions: { $sum: 1 },
      avgDurationMs: { $avg: durationExpr },
      avgActiveTimeMs: { $avg: "$activeTimeMs" },
      avgPageViews: { $avg: "$pageViews" },
      avgScrollDepth: { $avg: "$maxScrollDepth" },
      bounces: { $sum: { $cond: [bounceExpr, 1, 0] } },
    },
  },
  { $sort: { sessions: -1 } },
  { $limit: 6 },
];

const hasValue = (field) => ({ $cond: [{ $gt: [field, null] }, 1, 0] });

const referrerHost = (referrer) => {
  if (!referrer) return "Direct";

  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer.slice(0, 60);
  }
};

const toRows = (rows) => rows.map((row) => ({ label: row._id ?? null, count: row.count }));

const toEngagement = (rows) =>
  rows.map((row) => ({
    label: row._id ?? null,
    sessions: row.sessions,
    avgDurationMs: Math.round(row.avgDurationMs || 0),
    avgActiveTimeMs: Math.round(row.avgActiveTimeMs || 0),
    avgPageViews: Math.round((row.avgPageViews || 0) * 10) / 10,
    avgScrollDepth: Math.round(row.avgScrollDepth || 0),
    bounceRate: row.sessions ? Math.round((row.bounces / row.sessions) * 1000) / 10 : 0,
  }));

export const getAudienceInsights = async (rangeDays) => {
  return getOrSetCache(`analytics:audience:${rangeDays}`, 120, async () => {
    const since = new Date(Date.now() - rangeDays * DAY_MS);

    const [facets] = await VisitorSession.aggregate([
      { $match: { startedAt: { $gte: since }, isBot: { $ne: true }, ...PORTFOLIO_SESSION } },
      {
        $facet: {
          coverage: [
            {
              $group: {
                _id: null,
                sessions: { $sum: 1 },
                withCountry: { $sum: hasValue("$location.country") },
                withCity: { $sum: hasValue("$location.city") },
                withNetwork: { $sum: hasValue("$network.org") },
                touch: { $sum: { $cond: [{ $eq: ["$touch", true] }, 1, 0] } },
                activeTimeMs: { $sum: "$activeTimeMs" },
                durationMs: { $sum: durationExpr },
              },
            },
          ],
          loyalty: [
            { $group: { _id: "$visitorId", sessions: { $sum: 1 } } },
            { $group: { _id: { $gt: ["$sessions", 1] }, count: { $sum: 1 } } },
          ],
          countries: topBy("$location.country", 12),
          countryMap: topBy("$location.country", 250),
          regions: [
            { $match: { "location.city": { $nin: [null, ""] } } },
            {
              $group: {
                _id: {
                  city: "$location.city",
                  region: { $ifNull: ["$location.regionName", "$location.region"] },
                  country: "$location.country",
                },
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          devices: topBy("$device", 3),
          browsers: topBy("$browser", 8),
          os: topBy("$os", 8),
          screens: topBy("$screen", 8),
          languages: topBy("$language", 8),
          connections: topBy("$connection", 5),
          themes: topBy("$colorScheme", 3),
          networks: topBy("$network.org", 8),
          referrers: topBy("$referrer", 60),
          deviceEngagement: engagementBy("$device"),
          browserEngagement: engagementBy("$browser"),
        },
      },
    ]);

    const coverage = facets.coverage[0] || {
      sessions: 0,
      withCountry: 0,
      withCity: 0,
      withNetwork: 0,
      touch: 0,
      activeTimeMs: 0,
      durationMs: 0,
    };

    // Raw referrer URLs → hostnames, merged.
    const sources = new Map();
    facets.referrers.forEach((row) => {
      const host = referrerHost(row._id);
      sources.set(host, (sources.get(host) || 0) + row.count);
    });

    const loyalty = Object.fromEntries(facets.loyalty.map((row) => [row._id ? "returning" : "new", row.count]));

    return {
      coverage: {
        sessions: coverage.sessions,
        withCountry: coverage.withCountry,
        withCity: coverage.withCity,
        withNetwork: coverage.withNetwork,
        touchSessions: coverage.touch,
        // Share of time on site the tab was actually visible and in use.
        engagementRatio: coverage.durationMs
          ? Math.min(100, Math.round((coverage.activeTimeMs / coverage.durationMs) * 100))
          : 0,
      },
      visitors: { new: loyalty.new || 0, returning: loyalty.returning || 0 },
      countries: toRows(facets.countries),
      countryMap: toRows(facets.countryMap),
      cities: facets.regions.map((row) => ({ ...row._id, count: row.count })),
      devices: toRows(facets.devices),
      browsers: toRows(facets.browsers),
      os: toRows(facets.os),
      screens: toRows(facets.screens),
      languages: toRows(facets.languages),
      connections: toRows(facets.connections),
      themes: toRows(facets.themes),
      networks: toRows(facets.networks),
      sources: [...sources.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      deviceEngagement: toEngagement(facets.deviceEngagement),
      browserEngagement: toEngagement(facets.browserEngagement),
    };
  });
};

// ---------------------------------------------------------------------------
// Companies — organisations whose network visitors came from (ISP lookup).
// Home/mobile ISPs and cloud hosts are left out unless asked for.
// ---------------------------------------------------------------------------

export const getCompanies = async ({ rangeDays, includeAll = false }) => {
  const since = new Date(Date.now() - rangeDays * DAY_MS);

  const rows = await VisitorSession.aggregate([
    {
      $match: {
        startedAt: { $gte: since },
        isBot: { $ne: true },
        ...PORTFOLIO_SESSION,
        "network.org": { $nin: [null, ""] },
      },
    },
    { $sort: { lastSeenAt: -1 } },
    {
      $group: {
        _id: "$network.org",
        sessions: { $sum: 1 },
        visitors: { $addToSet: "$visitorId" },
        pageViews: { $sum: "$pageViews" },
        activeTimeMs: { $sum: "$activeTimeMs" },
        maxScrollDepth: { $max: "$maxScrollDepth" },
        firstSeenAt: { $min: "$startedAt" },
        lastSeenAt: { $max: "$lastSeenAt" },
        latestSessionId: { $first: "$sessionId" },
        asn: { $first: "$network.asn" },
        type: { $first: "$network.type" },
        places: { $addToSet: { city: "$location.city", country: "$location.country" } },
        sources: { $addToSet: { $ifNull: ["$utm.source", "$referrer"] } },
      },
    },
    { $sort: { lastSeenAt: -1 } },
    { $limit: 300 },
  ]);

  const companies = rows
    .map((row) => ({
      org: row._id,
      type: row.type || classifyOrg(row._id),
      asn: row.asn,
      sessions: row.sessions,
      visitors: row.visitors.length,
      pageViews: row.pageViews,
      activeTimeMs: row.activeTimeMs,
      maxScrollDepth: row.maxScrollDepth,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      latestSessionId: row.latestSessionId,
      places: row.places.filter((p) => p.country).slice(0, 5),
      sources: row.sources.filter(Boolean).slice(0, 5),
    }))
    .filter((row) => includeAll || NOTABLE_TYPES.includes(row.type));

  return { companies, rangeDays };
};

// ---------------------------------------------------------------------------
// Owner data — removes everything already recorded from the admin's own
// devices / IPs (future visits are dropped at /collect).
// ---------------------------------------------------------------------------

export const purgeOwnerData = async () => {
  const settings = await getAlertSettings({ fresh: true });
  const visitorIds = settings.ownerVisitorIds || [];
  const ips = settings.ownerIps || [];

  if (!visitorIds.length && !ips.length) return { sessions: 0, events: 0, pageViews: 0 };

  const sessions = await VisitorSession.find({ $or: [{ visitorId: { $in: visitorIds } }, { ip: { $in: ips } }] })
    .select("sessionId visitorId")
    .lean();
  const sessionIds = sessions.map((s) => s.sessionId);
  const allVisitorIds = [...new Set([...visitorIds, ...sessions.map((s) => s.visitorId)])];

  const [sessionResult, eventResult, pageViewResult] = await Promise.all([
    VisitorSession.deleteMany({ sessionId: { $in: sessionIds } }),
    VisitorEvent.deleteMany({ sessionId: { $in: sessionIds } }),
    PageView.deleteMany({ visitorId: { $in: allVisitorIds } }),
  ]);

  logger.info({ action: "OWNER_DATA_PURGED", sessions: sessionResult.deletedCount });

  return {
    sessions: sessionResult.deletedCount,
    events: eventResult.deletedCount,
    pageViews: pageViewResult.deletedCount,
  };
};

// ---------------------------------------------------------------------------
// CSV export — streamed straight from a cursor so large ranges don't sit in
// memory.
// ---------------------------------------------------------------------------

const EXPORT_LIMIT = 100000;

// Quotes every cell and neutralises spreadsheet formulas (=, +, -, @).
const csvCell = (value) => {
  if (value === undefined || value === null) return "";

  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  return `"${text.replace(/"/g, '""')}"`;
};

const EXPORTS = {
  sessions: {
    columns: [
      ["started_at", (s) => s.startedAt],
      ["last_seen_at", (s) => s.lastSeenAt],
      ["duration_sec", (s) => Math.round((new Date(s.lastSeenAt) - new Date(s.startedAt)) / 1000)],
      ["engaged_sec", (s) => Math.round((s.activeTimeMs || 0) / 1000)],
      ["session_id", (s) => s.sessionId],
      ["visitor_id", (s) => s.visitorId],
      ["ip", (s) => s.ip],
      ["country", (s) => s.location?.country],
      ["region", (s) => s.location?.regionName || s.location?.region],
      ["city", (s) => s.location?.city],
      ["network", (s) => s.network?.org],
      ["network_type", (s) => s.network?.type],
      ["device", (s) => s.device],
      ["device_model", (s) => [s.deviceVendor, s.deviceModel].filter(Boolean).join(" ")],
      ["browser", (s) => [s.browser, s.browserVersion].filter(Boolean).join(" ")],
      ["os", (s) => [s.os, s.osVersion].filter(Boolean).join(" ")],
      ["screen", (s) => s.screen],
      ["language", (s) => s.language],
      ["timezone", (s) => s.timezone],
      ["referrer", (s) => s.referrer],
      ["utm_source", (s) => s.utm?.source],
      ["utm_medium", (s) => s.utm?.medium],
      ["utm_campaign", (s) => s.utm?.campaign],
      ["entry_page", (s) => s.entryPage],
      ["exit_page", (s) => s.exitPage],
      ["page_views", (s) => s.pageViews],
      ["events", (s) => s.eventCount],
      ["max_scroll_pct", (s) => s.maxScrollDepth],
      ["is_bot", (s) => Boolean(s.isBot)],
    ],
    cursor: (since, includeBots) =>
      VisitorSession.find({
        startedAt: { $gte: since },
        ...(includeBots ? {} : { isBot: { $ne: true } }),
        ...PORTFOLIO_SESSION,
      })
        .sort({ startedAt: -1 })
        .limit(EXPORT_LIMIT)
        .lean()
        .cursor(),
  },
  events: {
    columns: [
      ["at", (e) => e.at],
      ["session_id", (e) => e.sessionId],
      ["visitor_id", (e) => e.visitorId],
      ["type", (e) => e.type],
      ["path", (e) => e.path],
      ["section", (e) => e.section],
      ["label", (e) => e.label],
      ["target", (e) => e.target],
      ["value", (e) => e.value],
      ["title", (e) => e.title],
    ],
    cursor: (since) =>
      VisitorEvent.find({ at: { $gte: since } }).sort({ at: -1 }).limit(EXPORT_LIMIT).lean().cursor(),
  },
};

export const EXPORT_TYPES = Object.keys(EXPORTS);

export const streamCsvExport = async ({ type, rangeDays, includeBots = false }, write) => {
  const { columns, cursor } = EXPORTS[type];
  const since = new Date(Date.now() - rangeDays * DAY_MS);

  // BOM so Excel opens the file as UTF-8 (city names, page titles).
  await write(`\uFEFF${columns.map(([name]) => name).join(",")}\n`);

  for await (const row of cursor(since, includeBots)) {
    await write(`${columns.map(([, get]) => csvCell(get(row))).join(",")}\n`);
  }
};
