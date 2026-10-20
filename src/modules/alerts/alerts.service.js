import { Resend } from "resend";
import { AlertSettings, Alert } from "./alerts.model.js";
import { VisitorSession, VisitorEvent } from "../analytics/journey.model.js";
import logger from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Admin notifications: stored in-app (bell in the admin header) and, when
// configured, emailed via Resend.
// ---------------------------------------------------------------------------

const SETTINGS_TTL_MS = 60 * 1000;
let settingsCache = { value: null, at: 0 };

const adminEmail = () => (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean)[0] || "";

export const getAlertSettings = async ({ fresh = false } = {}) => {
  if (!fresh && settingsCache.value && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;

  let settings = await AlertSettings.findOne({}).lean();
  if (!settings) settings = (await AlertSettings.create({})).toObject();
  settingsCache = { value: settings, at: Date.now() };
  return settings;
};

export const updateAlertSettings = async (data) => {
  const set = {};
  Object.entries(data).forEach(([group, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, v]) => (set[`${group}.${key}`] = v));
    } else set[group] = value;
  });
  await AlertSettings.findOneAndUpdate({}, { $set: set }, { upsert: true, runValidators: true });
  settingsCache = { value: null, at: 0 };
  return getAlertSettings({ fresh: true });
};

export const registerOwnerDevice = async (visitorId) => {
  if (!visitorId) return;
  const settings = await getAlertSettings();
  if (settings.ownerVisitorIds.includes(visitorId)) return;
  // Keep the 20 most recent devices.
  await AlertSettings.updateOne({}, { $push: { ownerVisitorIds: { $each: [visitorId], $slice: -20 } } }, { upsert: true });
  settingsCache = { value: null, at: 0 };
};

/* ---------- email ---------- */

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const REGION = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code) => {
  try {
    return REGION.of(code);
  } catch {
    return code;
  }
};
const flag = (code) =>
  code && /^[A-Z]{2}$/i.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : "🌐";

const formatDuration = (ms) => {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
};

const emailLayout = ({ heading, intro, rows = [], buttonLabel, buttonUrl, footer }) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 6px;font-size:20px">${escapeHtml(heading)}</h2>
    <p style="margin:0 0 20px;color:#555;line-height:1.5">${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${rows
        .filter(([, v]) => v)
        .map(
          ([k, v]) => `<tr>
            <td style="padding:8px 12px 8px 0;color:#6b7280;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td>
            <td style="padding:8px 0;border-bottom:1px solid #f1f1f1">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}
    </table>
    ${
      buttonUrl
        ? `<p style="margin:24px 0"><a href="${escapeHtml(buttonUrl)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">${escapeHtml(buttonLabel)}</a></p>`
        : ""
    }
    <p style="color:#9ca3af;font-size:12px;margin-top:24px">${escapeHtml(footer || "Sent by your portfolio admin panel. Change alert settings under Automations.")}</p>
  </div>`;

export const sendAdminEmail = async ({ subject, html, attachments }) => {
  const settings = await getAlertSettings();
  const to = settings.email.to || adminEmail();
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  if (!to) throw new Error("No recipient email configured");

  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: process.env.RESEND_FROM_EMAIL || "Portfolio <onboarding@resend.dev>",
    to,
    subject,
    html,
    ...(attachments && { attachments }),
  });
  if (error) throw new Error(error.message || "Email failed");
};

const createAlert = async (data, { email } = {}) => {
  const alert = await Alert.create(data);
  const settings = await getAlertSettings();

  if (email && settings.email.enabled) {
    try {
      await sendAdminEmail(email);
      await Alert.updateOne({ _id: alert._id }, { emailedAt: new Date() });
    } catch (error) {
      logger.warn({ action: "ALERT_EMAIL_FAILED", error: error.message });
      await Alert.updateOne({ _id: alert._id }, { emailError: error.message.slice(0, 300) });
    }
  }
  return alert;
};

/* ---------- long visit ---------- */

const pageName = (path) => {
  if (!path || path === "/") return "Home";
  if (path === "/card") return "NFC card";
  return path;
};

const describeSource = (session) => {
  if (session.utm?.medium === "card") return session.utm.source === "nfc" ? "NFC card tap" : "Card QR / link";
  if (session.utm?.source) return [session.utm.source, session.utm.campaign].filter(Boolean).join(" / ");
  if (!session.referrer) return "Direct";
  try {
    return new URL(session.referrer).hostname.replace(/^www\./, "");
  } catch {
    return "Referral";
  }
};

// Called after every tracker batch. A single conditional update claims the
// alert, so each session alerts at most once even with concurrent batches.
export const checkLongVisit = async (sessionId) => {
  const settings = await getAlertSettings();
  if (!settings.longVisit.enabled) return;

  const thresholdMs = settings.longVisit.minutes * 60 * 1000;
  const filter = {
    sessionId,
    isBot: { $ne: true },
    longVisitAlertedAt: null,
    $expr: { $gte: [{ $subtract: ["$lastSeenAt", "$startedAt"] }, thresholdMs] },
  };
  if (settings.ignoreOwner && settings.ownerVisitorIds.length) filter.visitorId = { $nin: settings.ownerVisitorIds };
  if (!settings.longVisit.includeCard) filter.portfolioPageViews = { $ne: 0 };

  const session = await VisitorSession.findOneAndUpdate(filter, { $set: { longVisitAlertedAt: new Date() } }, { returnDocument: "after" }).lean();
  if (!session) return;

  const [events, visitCount] = await Promise.all([
    VisitorEvent.find({ sessionId, type: { $in: ["page_view", "section_view", "click", "outbound_click", "download", "contact_link", "form_submit"] } })
      .sort({ at: 1 })
      .limit(300)
      .select("type path section label")
      .lean(),
    VisitorSession.countDocuments({ visitorId: session.visitorId }),
  ]);

  const unique = (list) => [...new Set(list.filter(Boolean))];
  const pages = unique(events.filter((e) => e.type === "page_view").map((e) => pageName(e.path)));
  const sections = unique(events.filter((e) => e.type === "section_view").map((e) => e.section));
  const actions = unique(events.filter((e) => !["page_view", "section_view"].includes(e.type)).map((e) => e.label)).slice(0, 8);

  const location = session.location?.country
    ? `${flag(session.location.country)} ${[session.location.city, countryName(session.location.country)].filter(Boolean).join(", ")}`
    : "Unknown location";
  const durationMs = new Date(session.lastSeenAt) - new Date(session.startedAt);
  const onCard = (session.cardViews || 0) > 0 && !(session.portfolioPageViews > 0);
  const where = onCard ? "your NFC card" : "your portfolio";
  const link = `${process.env.FRONTEND_URL || "https://suryanshuverma.com.np"}/dashboard/visitors/${sessionId}`;

  const title = `Visitor from ${location.replace(/^\S+\s/, "")} — ${settings.longVisit.minutes}+ min on ${where}`;
  const rows = [
    ["Where", location],
    ["Time so far", `${formatDuration(durationMs)} (still counting)`],
    ["Device", [session.device, session.browser, session.os].filter(Boolean).join(" · ")],
    ["Came from", describeSource(session)],
    ["Pages", pages.join(" → ")],
    ["Sections seen", sections.join(", ")],
    ["Clicked", actions.join(", ")],
    ["Visit", visitCount > 1 ? `Returning — visit #${visitCount}` : "First visit"],
    ["IP", session.ip],
  ];

  await createAlert(
    {
      type: "long_visit",
      title,
      body: rows
        .filter(([, v]) => v)
        .slice(0, 5)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · "),
      link: `/dashboard/visitors/${sessionId}`,
      sessionId,
      meta: { location: session.location, device: session.device, durationMs, pages, onCard },
    },
    {
      email: {
        subject: `👀 ${title}`,
        html: emailLayout({
          heading: `Someone has spent ${settings.longVisit.minutes}+ minutes on ${where}`,
          intro: "They're probably reading closely — here's what they've looked at so far.",
          rows,
          buttonLabel: "View their journey",
          buttonUrl: link,
        }),
      },
    },
  );
};

/* ---------- other alerts ---------- */

export const notifyBackupFailed = (message) =>
  createAlert(
    { type: "backup_failed", title: "Notes backup failed", body: message.slice(0, 900), link: "/dashboard/automations" },
    {
      email: {
        subject: "⚠️ Notes backup failed",
        html: emailLayout({
          heading: "Your scheduled notes backup failed",
          intro: message,
          buttonLabel: "Open backup settings",
          buttonUrl: `${process.env.FRONTEND_URL || ""}/dashboard/automations`,
        }),
      },
    },
  );

export const sendTestAlert = () =>
  createAlert(
    { type: "test", title: "Test alert — notifications are working", body: "This is what a visitor alert looks like in the admin panel.", link: "/dashboard/automations" },
    {
      email: {
        subject: "✅ Test alert from your portfolio",
        html: emailLayout({
          heading: "Notifications are working",
          intro: "You'll get an email like this when a visitor stays on your portfolio past your threshold.",
          rows: [["Example", "🇳🇵 Kathmandu, Nepal · 3m 12s · desktop · from linkedin.com"]],
        }),
      },
    },
  );

export const listAlerts = async (limit = 30) => {
  const [alerts, unread] = await Promise.all([
    Alert.find({}).sort({ createdAt: -1 }).limit(limit).lean(),
    Alert.countDocuments({ read: false }),
  ]);
  return { alerts, unread };
};

export const markRead = (id) => Alert.updateOne({ _id: id }, { read: true });
export const markAllRead = () => Alert.updateMany({ read: false }, { read: true });
export const clearAlerts = () => Alert.deleteMany({});

export { emailLayout };
