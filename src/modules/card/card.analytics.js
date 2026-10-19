import { VisitorSession, VisitorEvent } from "../analytics/journey.model.js";
import { getOrSetCache } from "../../utils/cache.js";
import { CARD_PATH } from "../analytics/journey.service.js";

// ---------------------------------------------------------------------------
// Card analytics — built on the same journey tracking as the portfolio,
// scoped to sessions that opened /card. The card page tags its links with
// ?src=nfc / ?src=qr, which the tracker stores as utm.source (medium "card").
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const SOURCES = {
  nfc: "NFC tap",
  qr: "QR scan",
  link: "Shared link",
};

const CONTACT_ACTIONS = ["Save contact", "Call", "WhatsApp", "Email"];

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : 0);

export const sourceOf = (session) => {
  const src = (session?.utm?.source || "").toLowerCase();
  if (SOURCES[src]) return src;
  if (src) return "link";
  return session?.referrer ? "link" : "direct";
};

export const SOURCE_LABELS = { ...SOURCES, direct: "Direct / typed" };

const dayFormatter = (timezone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });

export const getCardAnalytics = async (rangeDays, timezone) =>
  getOrSetCache(`card:analytics:v1:${rangeDays}:${timezone}`, 120, async () => {
    const now = Date.now();
    const since = new Date(now - rangeDays * DAY_MS);
    const previousSince = new Date(since.getTime() - rangeDays * DAY_MS);

    const [currentIds, previousIds] = await Promise.all([
      VisitorEvent.distinct("sessionId", { type: "page_view", path: CARD_PATH, at: { $gte: since } }),
      VisitorEvent.distinct("sessionId", {
        type: "page_view",
        path: CARD_PATH,
        at: { $gte: previousSince, $lt: since },
      }),
    ]);

    const [sessions, previousSessionCount, events] = await Promise.all([
      VisitorSession.find({ sessionId: { $in: currentIds }, isBot: { $ne: true } })
        .select(
          "sessionId visitorId ip location device browser os startedAt lastSeenAt utm referrer portfolioPageViews",
        )
        .lean(),
      VisitorSession.countDocuments({ sessionId: { $in: previousIds }, isBot: { $ne: true } }),
      VisitorEvent.find({
        sessionId: { $in: currentIds },
        path: CARD_PATH,
        at: { $gte: since },
        type: { $in: ["page_view", "page_leave", "click", "outbound_click", "contact_link", "download"] },
      })
        .select("sessionId type label target value at")
        .lean(),
    ]);

    const sessionIds = new Set(sessions.map((s) => s.sessionId));
    const cardEvents = events.filter((e) => sessionIds.has(e.sessionId));

    const taps = cardEvents.filter((e) => e.type === "page_view");
    const actions = cardEvents.filter((e) => !["page_view", "page_leave"].includes(e.type) && e.label);
    const actionsBySession = new Map();
    actions.forEach((e) => {
      if (!actionsBySession.has(e.sessionId)) actionsBySession.set(e.sessionId, []);
      actionsBySession.get(e.sessionId).push(e);
    });

    const sessionsWith = (labels) =>
      sessions.filter((s) => (actionsBySession.get(s.sessionId) || []).some((e) => labels.includes(e.label))).length;

    const total = sessions.length;
    const saved = sessionsWith(["Save contact"]);
    const contacted = sessionsWith(["Call", "WhatsApp", "Email"]);
    const visitedPortfolio = sessions.filter((s) => (s.portfolioPageViews || 0) > 0).length;

    const leaves = cardEvents.filter((e) => e.type === "page_leave" && e.value > 0);
    const avgTimeMs = leaves.length ? leaves.reduce((t, e) => t + e.value, 0) / leaves.length : 0;

    // ---- per-visitor repeat taps ----
    const visitorSessionCounts = new Map();
    sessions.forEach((s) => visitorSessionCounts.set(s.visitorId, (visitorSessionCounts.get(s.visitorId) || 0) + 1));

    // ---- daily taps by source ----
    const toDay = dayFormatter(timezone);
    const days = [];
    for (let i = rangeDays - 1; i >= 0; i -= 1) {
      const key = toDay.format(new Date(now - i * DAY_MS));
      if (!days.includes(key)) days.push(key);
    }
    const daily = new Map(days.map((d) => [d, { date: d, nfc: 0, qr: 0, link: 0, direct: 0 }]));
    sessions.forEach((s) => {
      const row = daily.get(toDay.format(new Date(s.startedAt)));
      if (row) row[sourceOf(s)] += 1;
    });

    // ---- breakdowns ----
    const countBy = (keyFn) => {
      const map = new Map();
      sessions.forEach((s) => {
        const key = keyFn(s);
        if (key) map.set(key, (map.get(key) || 0) + 1);
      });
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };

    const actionCounts = new Map();
    actions.forEach((e) => {
      const entry = actionCounts.get(e.label) || { label: e.label, type: e.type, count: 0, sessions: new Set() };
      entry.count += 1;
      entry.sessions.add(e.sessionId);
      actionCounts.set(e.label, entry);
    });

    return {
      timezone,
      totals: {
        taps: taps.length,
        sessions: total,
        uniqueVisitors: visitorSessionCounts.size,
        repeatVisitors: [...visitorSessionCounts.values()].filter((n) => n > 1).length,
        previousSessions: previousSessionCount,
        changePercent:
          previousSessionCount === 0
            ? total > 0
              ? 100
              : 0
            : round1(((total - previousSessionCount) / previousSessionCount) * 100),
        avgTimeMs: Math.round(avgTimeMs),
      },
      conversion: {
        saved,
        savedPercent: pct(saved, total),
        contacted,
        contactedPercent: pct(contacted, total),
        visitedPortfolio,
        visitedPortfolioPercent: pct(visitedPortfolio, total),
      },
      daily: [...daily.values()],
      sources: countBy(sourceOf).map(([source, count]) => ({
        source,
        label: SOURCE_LABELS[source] || source,
        count,
        percent: pct(count, total),
      })),
      actions: [...actionCounts.values()]
        .map((a) => ({
          label: a.label,
          type: a.type,
          count: a.count,
          sessions: a.sessions.size,
          isContact: CONTACT_ACTIONS.includes(a.label),
        }))
        .sort((a, b) => b.count - a.count),
      locations: countBy((s) =>
        s.location?.country ? `${s.location.city || ""}|${s.location.country}` : null,
      )
        .slice(0, 8)
        .map(([key, count]) => {
          const [city, country] = key.split("|");
          return { city: city || null, country, count };
        }),
      devices: countBy((s) => s.device).map(([device, count]) => ({ device, count, percent: pct(count, total) })),
      recent: sessions
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
        .slice(0, 25)
        .map((s) => ({
          sessionId: s.sessionId,
          startedAt: s.startedAt,
          durationMs: Math.max(0, new Date(s.lastSeenAt) - new Date(s.startedAt)),
          source: sourceOf(s),
          ip: s.ip,
          location: s.location,
          device: s.device,
          browser: s.browser,
          os: s.os,
          visitedPortfolio: (s.portfolioPageViews || 0) > 0,
          tapCount: visitorSessionCounts.get(s.visitorId) || 1,
          actions: [...new Set((actionsBySession.get(s.sessionId) || []).map((e) => e.label))],
        })),
    };
  });
