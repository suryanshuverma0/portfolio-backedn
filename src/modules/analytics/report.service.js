import PageView from "./analytics.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { CARD_PATH, NOT_CARD_PATH, PORTFOLIO_SESSION } from "./journey.service.js";
import { categorizeReferrer } from "./analytics.service.js";
import Post from "../blog/blog.model.js";
import Comment from "../blog/comment.model.js";
import Message from "../contact/contact.model.js";
import { Note, NoteVersion } from "../notes/notes.model.js";
import { BackupConfig } from "../backups/backups.model.js";
import { AlertSettings } from "../alerts/alerts.model.js";
import { sendAdminEmail } from "../alerts/alerts.service.js";
import { getStorageOverview } from "../storage/storage.service.js";
import { getOrSetCache } from "../../utils/cache.js";
import logger from "../../utils/logger.js";
import { frontendUrl } from "../../utils/frontendUrl.js";

// ---------------------------------------------------------------------------
// Executive report: one period (week / month / quarter) against the one
// before it, with an overall health score, plain-English highlights and a
// list of things that need attention. Also emailed weekly when enabled.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const PERIODS = { week: 7, month: 30, quarter: 90 };
const PERIOD_LABEL = { week: "week", month: "30 days", quarter: "quarter" };

const round1 = (n) => Math.round(n * 10) / 10;
const change = (cur, prev) => (!prev ? (cur > 0 ? null : 0) : round1(((cur - prev) / prev) * 100));
const avg = (list) => (list.length ? list.reduce((t, v) => t + v, 0) / list.length : 0);
const durationOf = (s) => Math.max(0, new Date(s.lastSeenAt) - new Date(s.startedAt));
const isBounce = (s) => (s.pageViews || 0) <= 1 && durationOf(s) < 10000;

const REGION = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (c) => {
  try {
    return REGION.of(c);
  } catch {
    return c;
  }
};
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

const windowStats = async (from, to) => {
  const range = { $gte: from, $lt: to };
  const [views, sessions, events, messages, comments, postsPublished, notesCreated, notesEdited, writingSessions, cardOpens, cardSaves] =
    await Promise.all([
      PageView.find({ createdAt: range }).select("path visitorId createdAt").lean(),
      VisitorSession.find({ startedAt: range, isBot: { $ne: true }, ...PORTFOLIO_SESSION })
        .select("visitorId startedAt lastSeenAt pageViews maxScrollDepth referrer utm location device")
        .lean(),
      VisitorEvent.aggregate([
        { $match: { at: range, path: NOT_CARD_PATH, type: { $in: ["form_submit", "download", "outbound_click", "contact_link"] } } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
      ]),
      Message.countDocuments({ createdAt: range }),
      Comment.countDocuments({ createdAt: range }),
      Post.find({ publishedAt: range, isVisible: true }).select("title slug").lean(),
      Note.countDocuments({ createdAt: range, deletedAt: null }),
      Note.countDocuments({ updatedAt: range, deletedAt: null }),
      NoteVersion.countDocuments({ createdAt: range }),
      VisitorEvent.distinct("sessionId", { at: range, type: "page_view", path: CARD_PATH }),
      VisitorEvent.distinct("sessionId", { at: range, path: CARD_PATH, label: "Save contact" }),
    ]);

  const eventCount = (type) => events.find((e) => e._id === type)?.count || 0;
  const durations = sessions.map(durationOf);

  return {
    views,
    sessions,
    metrics: {
      views: views.length,
      visitors: new Set(views.map((v) => v.visitorId)).size,
      sessions: sessions.length,
      avgDurationMs: Math.round(avg(durations)),
      bounceRate: sessions.length ? round1((sessions.filter(isBounce).length / sessions.length) * 100) : 0,
      pagesPerSession: round1(avg(sessions.map((s) => s.pageViews || 0))),
      avgScroll: Math.round(avg(sessions.map((s) => s.maxScrollDepth || 0))),
      contactForms: eventCount("form_submit"),
      contactLinks: eventCount("contact_link"),
      downloads: eventCount("download"),
      outboundClicks: eventCount("outbound_click"),
      messages,
      comments,
      postsPublished: postsPublished.length,
      notesCreated,
      notesEdited,
      writingSessions,
      cardOpens: cardOpens.length,
      cardSaves: cardSaves.length,
    },
    postsPublished,
  };
};

const healthScore = (cur, prev, attention) => {
  // Four equally weighted pillars, 0–25 each.
  const growth = cur.views === 0 ? 0 : !prev.views ? 25 : Math.max(0, Math.min(25, 12.5 + ((cur.views - prev.views) / prev.views) * 25));
  const engagement = Math.min(25, (cur.avgDurationMs / 120000) * 12.5 + (100 - cur.bounceRate) / 8);
  const content = Math.min(25, cur.postsPublished * 8 + cur.notesEdited * 1.5 + (cur.comments ? 5 : 0));
  const responsiveness = Math.max(0, 25 - attention.unreadMessages * 4 - attention.pendingComments * 2 - (attention.backupProblem ? 8 : 0));
  const parts = { growth, engagement, content, responsiveness };
  const score = Math.round(Object.values(parts).reduce((t, v) => t + v, 0));
  return {
    score,
    grade: score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Needs attention",
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)])),
  };
};

const computeReport = async (period, tz) => {
  const days = PERIODS[period];
  const now = new Date();
  const since = new Date(now - days * DAY_MS);
  const prevSince = new Date(since - days * DAY_MS);

  const [cur, prev, unreadMessages, pendingComments, drafts, backup, lastPost, storage] = await Promise.all([
    windowStats(since, now),
    windowStats(prevSince, since),
    Message.countDocuments({ isRead: false }),
    Comment.countDocuments({ isApproved: false }),
    Post.countDocuments({ isVisible: false }),
    BackupConfig.findOne({}).lean(),
    Post.findOne({ isVisible: true }).sort({ publishedAt: -1 }).select("title publishedAt").lean(),
    getStorageOverview().catch(() => null),
  ]);

  const c = cur.metrics;
  const p = prev.metrics;
  const metric = (key) => ({ value: c[key], previous: p[key], change: change(c[key], p[key]) });

  /* ---------- breakdowns ---------- */

  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const daily = new Map();
  for (let i = days - 1; i >= 0; i -= 1) daily.set(dayFmt.format(new Date(now - i * DAY_MS)), { views: 0, visitors: new Set() });
  cur.views.forEach((v) => {
    const row = daily.get(dayFmt.format(v.createdAt));
    if (row) {
      row.views += 1;
      row.visitors.add(v.visitorId);
    }
  });
  const series = [...daily.entries()].map(([date, r]) => ({ date, views: r.views, visitors: r.visitors.size }));
  const bestDay = series.reduce((best, d) => (d.views > (best?.views ?? -1) ? d : best), null);

  const countBy = (list, fn) => {
    const m = new Map();
    list.forEach((x) => {
      const k = fn(x);
      if (k) m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const topPages = countBy(cur.views, (v) => v.path).slice(0, 6).map(([path, views]) => ({ path, views }));
  const topPosts = countBy(cur.views.filter((v) => /^\/blog\/[^/]+$/.test(v.path)), (v) => v.path).slice(0, 5);
  const postTitles = new Map(
    (await Post.find({ slug: { $in: topPosts.map(([path]) => decodeURIComponent(path.slice(6))) } }).select("slug title").lean()).map((x) => [x.slug, x.title]),
  );
  const sources = countBy(cur.sessions, (s) => (s.utm?.medium === "card" ? "Card" : categorizeReferrer(s.referrer).source)).map(([label, count]) => ({
    label,
    count,
    percent: round1((count / Math.max(1, c.sessions)) * 100),
  }));
  const countries = countBy(cur.sessions, (s) => s.location?.country).slice(0, 5).map(([code, count]) => ({ code, name: countryName(code), count }));
  const devices = countBy(cur.sessions, (s) => s.device).map(([device, count]) => ({ device, count, percent: round1((count / Math.max(1, c.sessions)) * 100) }));

  /* ---------- attention ---------- */

  const backupStale =
    backup && backup.schedule !== "off" && backup.lastRun?.at && Date.now() - new Date(backup.lastRun.at) > (backup.schedule === "daily" ? 2 : 8) * DAY_MS;
  const backupProblem = Boolean(backup && (backup.lastRun?.status === "failed" || backupStale || backup.schedule === "off"));
  const daysSincePost = lastPost?.publishedAt ? Math.floor((Date.now() - new Date(lastPost.publishedAt)) / DAY_MS) : null;

  const actions = [
    unreadMessages && { level: "high", text: `${unreadMessages} unread message${unreadMessages === 1 ? "" : "s"} waiting for a reply`, link: "/dashboard/messages" },
    pendingComments && { level: "medium", text: `${pendingComments} comment${pendingComments === 1 ? "" : "s"} awaiting approval`, link: "/dashboard/blog/comments" },
    backupProblem && {
      level: "high",
      text: backup?.schedule === "off" ? "Automatic notes backups are turned off" : backup?.lastRun?.status === "failed" ? "The last notes backup failed" : "Notes haven't been backed up recently",
      link: "/dashboard/automations",
    },
    storage?.quota?.percent >= 70 && { level: storage.quota.percent >= 90 ? "high" : "medium", text: `Database is ${storage.quota.percent}% full`, link: "/dashboard/storage" },
    drafts && { level: "low", text: `${drafts} blog draft${drafts === 1 ? "" : "s"} not yet published`, link: "/dashboard/blog" },
    daysSincePost !== null && daysSincePost > 30 && { level: "low", text: `No new blog post in ${daysSincePost} days`, link: "/dashboard/blog/new" },
  ].filter(Boolean);

  /* ---------- highlights (plain English) ---------- */

  const label = PERIOD_LABEL[period];
  const highlights = [];
  const trend = change(c.views, p.views);
  if (c.views) {
    highlights.push(
      trend === null
        ? `${plural(c.views, "page view")} from ${plural(c.visitors, "visitor")} this ${label} — your first tracked activity.`
        : `Page views ${trend >= 0 ? "up" : "down"} ${Math.abs(trend)}% vs the previous ${label} (${c.views} vs ${p.views}).`,
    );
  } else highlights.push(`No visits recorded this ${label}.`);
  if (sources[0]) highlights.push(`${sources[0].label === "Card" ? "Your NFC card" : sources[0].label} was the top traffic source (${sources[0].percent}% of sessions).`);
  if (topPosts[0]) highlights.push(`Most-read post: “${postTitles.get(decodeURIComponent(topPosts[0][0].slice(6))) || topPosts[0][0]}” with ${plural(topPosts[0][1], "view")}.`);
  if (bestDay?.views) {
    const [y, m, d] = bestDay.date.split("-").map(Number);
    highlights.push(`Busiest day: ${new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })} (${plural(bestDay.views, "view")}).`);
  }
  if (countries.length) highlights.push(`Visitors came from ${plural(countBy(cur.sessions, (s) => s.location?.country).length, "country", "countries")}, led by ${countries[0].name}.`);
  if (c.avgDurationMs) highlights.push(`Average visit lasted ${fmtDuration(c.avgDurationMs)}, with a ${c.bounceRate}% bounce rate.`);
  const conversions = c.contactForms + c.contactLinks + c.messages;
  if (conversions) highlights.push(`${plural(conversions, "person", "people")} reached out (forms, email/phone links or messages).`);
  if (c.cardOpens) highlights.push(`Your NFC card was opened ${plural(c.cardOpens, "time")}; ${c.cardSaves} saved your contact.`);
  if (cur.postsPublished.length) highlights.push(`You published ${cur.postsPublished.length} post${cur.postsPublished.length === 1 ? "" : "s"}: ${cur.postsPublished.map((x) => `“${x.title}”`).join(", ")}.`);
  if (c.notesEdited) highlights.push(`You worked on ${c.notesEdited} note${c.notesEdited === 1 ? "" : "s"} (${c.notesCreated} new).`);

  return {
    period,
    label,
    timezone: tz,
    from: since,
    to: now,
    generatedAt: new Date(),
    health: healthScore(c, p, { unreadMessages, pendingComments, backupProblem }),
    kpis: {
      views: metric("views"),
      visitors: metric("visitors"),
      sessions: metric("sessions"),
      avgDurationMs: metric("avgDurationMs"),
      bounceRate: metric("bounceRate"),
      pagesPerSession: metric("pagesPerSession"),
      avgScroll: metric("avgScroll"),
      contactForms: metric("contactForms"),
      contactLinks: metric("contactLinks"),
      downloads: metric("downloads"),
      outboundClicks: metric("outboundClicks"),
      messages: metric("messages"),
      comments: metric("comments"),
      postsPublished: metric("postsPublished"),
      cardOpens: metric("cardOpens"),
      cardSaves: metric("cardSaves"),
      notesCreated: metric("notesCreated"),
      notesEdited: metric("notesEdited"),
      writingSessions: metric("writingSessions"),
    },
    series,
    funnel: [
      { label: "Visits", value: c.sessions },
      { label: "Engaged (30s+)", value: cur.sessions.filter((s) => durationOf(s) >= 30000).length },
      { label: "Explored (2+ pages)", value: cur.sessions.filter((s) => (s.pageViews || 0) >= 2).length },
      { label: "Reached out", value: conversions },
    ],
    highlights,
    actions,
    topPages,
    topPosts: topPosts.map(([path, views]) => ({ path, title: postTitles.get(decodeURIComponent(path.slice(6))) || path, views })),
    sources,
    countries,
    devices,
    storage: storage ? { percent: storage.quota.percent } : null,
    backup: backup ? { schedule: backup.schedule, lastRun: backup.lastRun } : null,
  };
};

export const getExecutiveReport = (period, tz) =>
  getOrSetCache(`analytics:report:v1:${period}:${tz}`, 300, () => computeReport(period, tz));

/* ---------- email ---------- */

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const reportEmailHtml = (r) => {
  const fmtChange = (ch) => (ch === null ? "new" : `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch)}%`);
  const tile = (title, m, fmt = (v) => v) => `
    <td style="padding:12px;border:1px solid #eee;border-radius:10px;width:33%">
      <div style="color:#6b7280;font-size:12px">${esc(title)}</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(fmt(m.value))}</div>
      <div style="font-size:12px;color:${m.change === null || m.change >= 0 ? "#059669" : "#dc2626"}">${fmtChange(m.change)}</div>
    </td>`;
  const link = `${frontendUrl()}/dashboard/report?period=${r.period}`;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
    <p style="color:#6b7280;margin:0">Portfolio report · last ${esc(r.label)}</p>
    <h2 style="margin:4px 0 16px">Health score ${r.health.score}/100 — ${esc(r.health.grade)}</h2>
    <table style="width:100%;border-collapse:separate;border-spacing:8px"><tr>
      ${tile("Page views", r.kpis.views)}${tile("Visitors", r.kpis.visitors)}${tile("Avg. visit", r.kpis.avgDurationMs, fmtDuration)}
    </tr><tr>
      ${tile("Messages", r.kpis.messages)}${tile("Card opens", r.kpis.cardOpens)}${tile("Comments", r.kpis.comments)}
    </tr></table>
    <h3 style="margin:20px 0 8px">Highlights</h3>
    <ul style="padding-left:18px;line-height:1.6;color:#333">${r.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
    ${
      r.actions.length
        ? `<h3 style="margin:20px 0 8px">Needs your attention</h3><ul style="padding-left:18px;line-height:1.6;color:#333">${r.actions.map((a) => `<li>${esc(a.text)}</li>`).join("")}</ul>`
        : `<p style="color:#059669">Nothing needs your attention. 🎉</p>`
    }
    <p style="margin:24px 0"><a href="${esc(link)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none">Open the full report</a></p>
  </div>`;
};

export const emailReport = async (period, tz) => {
  const report = await computeReport(period, tz);
  await sendAdminEmail({ subject: `📊 Portfolio report — ${report.health.score}/100 (${report.health.grade})`, html: reportEmailHtml(report) });
  return { sent: true };
};

/* ---------- weekly schedule (Mondays, 08:00 in the admin's timezone) ---------- */

let reportTimer = null;

const sendWeeklyIfDue = async () => {
  try {
    const settings = await AlertSettings.findOne({}).lean();
    const weekly = settings?.weeklyReport;
    if (!weekly?.enabled) return;
    const tz = weekly.timezone || "UTC";
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date()).map((p) => [p.type, p.value]),
    );
    if (parts.weekday !== "Mon" || Number(parts.hour) < 8) return;
    if (weekly.lastSentAt && Date.now() - new Date(weekly.lastSentAt) < 6 * DAY_MS) return;

    await AlertSettings.updateOne({}, { $set: { "weeklyReport.lastSentAt": new Date() } });
    await emailReport("week", tz);
    logger.info({ action: "WEEKLY_REPORT_SENT" });
  } catch (error) {
    logger.error({ action: "WEEKLY_REPORT_FAILED", error: error.message });
  }
};

export const startReportScheduler = () => {
  if (reportTimer) return;
  reportTimer = setInterval(sendWeeklyIfDue, 30 * 60 * 1000);
  reportTimer.unref?.();
};
