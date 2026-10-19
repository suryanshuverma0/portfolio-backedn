import PageView from "./analytics.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { CARD_PATH, PORTFOLIO_SESSION } from "./journey.service.js";
import { categorizeReferrer } from "./analytics.service.js";
import { Notebook, Note, NoteVersion } from "../notes/notes.model.js";
import Card from "../card/card.model.js";
import { getStorageOverview } from "../storage/storage.service.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Dashboard "command centre": cross-module KPIs (visitors, NFC card, notes,
// storage) with sparklines and comparisons. Cached briefly; the live list
// is always fresh.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_WINDOW_MS = 2 * 60 * 1000;
const HEATMAP_WEEKS = 12;

const round1 = (n) => Math.round(n * 10) / 10;

const percentChange = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return round1(((current - previous) / previous) * 100);
};

const durationOf = (s) => Math.max(0, new Date(s.lastSeenAt) - new Date(s.startedAt));
const avg = (values) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : 0);
const isBounce = (s) => (s.pageViews || 0) <= 1 && durationOf(s) < 10000;

const dayKey = (timezone) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (date) => fmt.format(new Date(date));
};

const lastDays = (count, toKey, now) => {
  const days = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = toKey(now - i * DAY_MS);
    if (!days.includes(key)) days.push(key);
  }
  return days;
};

// Words in a plain-text note, computed in Mongo so large notes never leave it.
const WORDS_EXPR = {
  $size: {
    $filter: {
      input: { $split: [{ $trim: { input: { $ifNull: ["$text", ""] } } }, " "] },
      cond: { $gt: [{ $strLenCP: "$$this" }, 0] },
    },
  },
};

const computeInsights = async (timezone) => {
  const now = Date.now();
  const toKey = dayKey(timezone);
  const todayKey = toKey(now);
  const yesterdayKey = toKey(now - DAY_MS);
  const since30 = new Date(now - 30 * DAY_MS);
  const since14 = new Date(now - 14 * DAY_MS);
  const since7 = new Date(now - 7 * DAY_MS);
  const heatmapSince = new Date(now - HEATMAP_WEEKS * 7 * DAY_MS);

  const [
    sessions30,
    visitorsByDayRows,
    cardOpenIds,
    cardSaveRows,
    cardDoc,
    notebookCount,
    noteStats,
    noteEditDays,
    versionDays,
    recentNotes,
  ] = await Promise.all([
    VisitorSession.find({ startedAt: { $gte: since30 }, isBot: { $ne: true }, ...PORTFOLIO_SESSION })
      .select("startedAt lastSeenAt pageViews referrer utm device location activeTimeMs")
      .lean(),

    PageView.aggregate([
      { $match: { createdAt: { $gte: since30 } } },
      { $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, v: "$visitorId" } } },
      { $group: { _id: "$_id.day", visitors: { $sum: 1 } } },
    ]),

    VisitorEvent.aggregate([
      { $match: { type: "page_view", path: CARD_PATH, at: { $gte: since14 } } },
      { $group: { _id: "$sessionId", at: { $min: "$at" } } },
    ]),

    VisitorEvent.aggregate([
      { $match: { path: CARD_PATH, label: "Save contact", at: { $gte: since14 } } },
      { $group: { _id: "$sessionId", at: { $min: "$at" } } },
    ]),

    Card.findOne({}).select("isEnabled updatedAt").lean(),

    Notebook.countDocuments({ deletedAt: null }),

    Note.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          typed: { $sum: { $cond: [{ $eq: ["$kind", "typed"] }, 1, 0] } },
          handwritten: { $sum: { $cond: [{ $eq: ["$kind", "handwritten"] }, 1, 0] } },
          pinned: { $sum: { $cond: ["$isPinned", 1, 0] } },
          words: { $sum: WORDS_EXPR },
          inkItems: { $sum: { $size: { $ifNull: ["$ink.elements", []] } } },
          editedThisWeek: { $sum: { $cond: [{ $gte: ["$updatedAt", since7] }, 1, 0] } },
        },
      },
    ]),

    // Writing activity: days a note was edited (last update) …
    Note.aggregate([
      { $match: { deletedAt: null, updatedAt: { $gte: heatmapSince } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt", timezone } }, count: { $sum: 1 } } },
    ]),
    // … plus each 10-minute version checkpoint (earlier editing sessions).
    NoteVersion.aggregate([
      { $match: { createdAt: { $gte: heatmapSince } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone } }, count: { $sum: 1 } } },
    ]),

    Note.find({ deletedAt: null }).sort({ updatedAt: -1 }).limit(5).select("title kind notebook updatedAt").populate("notebook", "title icon").lean(),
  ]);

  /* ---------- visitors ---------- */

  const byDay = new Map();
  sessions30.forEach((s) => {
    const key = toKey(s.startedAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  });

  const visitorsMap = new Map(visitorsByDayRows.map((r) => [r._id, r.visitors]));
  const days30 = lastDays(30, toKey, now);
  const daily = days30.map((date) => {
    const list = byDay.get(date) || [];
    return {
      date,
      sessions: list.length,
      visitors: visitorsMap.get(date) || 0,
      avgDurationMs: Math.round(avg(list.map(durationOf))),
      bounceRate: list.length ? round1((list.filter(isBounce).length / list.length) * 100) : null,
    };
  });

  const last7 = sessions30.filter((s) => new Date(s.startedAt) >= since7);
  const prev7 = sessions30.filter((s) => new Date(s.startedAt) >= since14 && new Date(s.startedAt) < since7);

  const avgDuration7 = avg(last7.map(durationOf));
  const avgDurationPrev = avg(prev7.map(durationOf));
  const bounce7 = last7.length ? (last7.filter(isBounce).length / last7.length) * 100 : 0;
  const bouncePrev = prev7.length ? (prev7.filter(isBounce).length / prev7.length) * 100 : 0;

  const sourceCounts = new Map();
  last7.forEach((s) => {
    const source = s.utm?.medium === "card" ? "Card" : categorizeReferrer(s.referrer).source;
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  });

  const countBy = (list, keyFn) => {
    const map = new Map();
    list.forEach((item) => {
      const key = keyFn(item);
      if (key) map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };

  /* ---------- card ---------- */

  const days14 = lastDays(14, toKey, now);
  const cardDaily = new Map(days14.map((d) => [d, { date: d, opens: 0, saves: 0 }]));
  cardOpenIds.forEach((r) => cardDaily.get(toKey(r.at)) && (cardDaily.get(toKey(r.at)).opens += 1));
  cardSaveRows.forEach((r) => cardDaily.get(toKey(r.at)) && (cardDaily.get(toKey(r.at)).saves += 1));
  const cardSeries = [...cardDaily.values()];
  const cardOpens7 = cardSeries.slice(-7).reduce((t, d) => t + d.opens, 0);
  const cardOpensPrev = cardSeries.slice(0, 7).reduce((t, d) => t + d.opens, 0);
  const cardSaves7 = cardSeries.slice(-7).reduce((t, d) => t + d.saves, 0);

  /* ---------- notes heatmap & streak ---------- */

  const activity = new Map();
  [...noteEditDays, ...versionDays].forEach((r) => activity.set(r._id, (activity.get(r._id) || 0) + r.count));
  const heatmap = lastDays(HEATMAP_WEEKS * 7, toKey, now).map((date) => ({ date, count: activity.get(date) || 0 }));

  let streak = 0;
  for (let i = heatmap.length - 1; i >= 0; i -= 1) {
    if (heatmap[i].count > 0) streak += 1;
    else if (i === heatmap.length - 1) continue; // today not written yet doesn't break it
    else break;
  }

  const n = noteStats[0] || { total: 0, typed: 0, handwritten: 0, pinned: 0, words: 0, inkItems: 0, editedThisWeek: 0 };

  /* ---------- storage (best-effort) ---------- */

  let storage = null;
  try {
    const overview = await getStorageOverview();
    storage = {
      percent: overview.quota.percent,
      usedBytes: overview.quota.usedBytes,
      limitBytes: overview.quota.limitBytes,
      notesBytes: overview.collections
        .filter((c) => ["Note", "NoteVersion", "Notebook", "NoteTopic"].includes(c.model))
        .reduce((t, c) => t + c.totalSize, 0),
    };
  } catch (error) {
    logger.warn({ action: "DASHBOARD_STORAGE_FAILED", error: error.message });
  }

  const todayCount = (byDay.get(todayKey) || []).length;
  const yesterdayCount = (byDay.get(yesterdayKey) || []).length;

  return {
    timezone,
    visitors: {
      sessionsToday: todayCount,
      sessionsYesterday: yesterdayCount,
      sessionsTodayChange: percentChange(todayCount, yesterdayCount),
      sessions7d: last7.length,
      sessions7dChange: percentChange(last7.length, prev7.length),
      avgDurationMs: Math.round(avgDuration7),
      avgDurationChange: percentChange(avgDuration7, avgDurationPrev),
      bounceRate: round1(bounce7),
      // Positive = bounce went down (an improvement).
      bounceRateDelta: round1(bouncePrev - bounce7),
      daily,
      sources: ["Direct", "Search", "Social", "Referral", "Card"]
        .map((label) => ({ label, count: sourceCounts.get(label) || 0 }))
        .filter((s) => s.count > 0)
        .map((s) => ({ ...s, percent: round1((s.count / Math.max(1, last7.length)) * 100) })),
      devices: countBy(last7, (s) => s.device).map(([device, count]) => ({
        device,
        count,
        percent: round1((count / Math.max(1, last7.length)) * 100),
      })),
      countries: countBy(last7, (s) => s.location?.country)
        .slice(0, 5)
        .map(([country, count]) => ({ country, count })),
    },
    card: {
      isEnabled: cardDoc ? cardDoc.isEnabled !== false : true,
      opens7d: cardOpens7,
      opensChange: percentChange(cardOpens7, cardOpensPrev),
      saves7d: cardSaves7,
      saveRate: cardOpens7 ? round1((cardSaves7 / cardOpens7) * 100) : 0,
      daily: cardSeries,
    },
    notes: {
      notebooks: notebookCount,
      total: n.total,
      typed: n.typed,
      handwritten: n.handwritten,
      pinned: n.pinned,
      words: n.words,
      inkItems: n.inkItems,
      editedThisWeek: n.editedThisWeek,
      streak,
      heatmap,
      recent: recentNotes.map((note) => ({
        _id: note._id,
        title: note.title,
        kind: note.kind,
        updatedAt: note.updatedAt,
        notebook: note.notebook ? `${note.notebook.icon} ${note.notebook.title}` : "",
      })),
    },
    storage,
  };
};

export const getDashboardInsights = async (timezone) => {
  const [insights, live] = await Promise.all([
    getOrSetCache(`analytics:dashboard-insights:v1:${timezone}`, 120, () => computeInsights(timezone)),

    // Always fresh: who's on the site right now.
    VisitorSession.find({
      lastSeenAt: { $gte: new Date(Date.now() - LIVE_WINDOW_MS) },
      isBot: { $ne: true },
    })
      .sort({ lastSeenAt: -1 })
      .limit(6)
      .select("sessionId location device browser exitPage startedAt lastSeenAt cardViews portfolioPageViews")
      .lean(),
  ]);

  return {
    ...insights,
    live: live.map((s) => ({
      sessionId: s.sessionId,
      location: s.location,
      device: s.device,
      browser: s.browser,
      page: s.exitPage,
      isCard: (s.cardViews || 0) > 0 && !(s.portfolioPageViews > 0),
      durationMs: durationOf(s),
    })),
  };
};
