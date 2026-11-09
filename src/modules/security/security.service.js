import SecuritySettings from "./security.model.js";
import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";
import { getClientIp, isPublicIp } from "../analytics/analytics.utils.js";
import { banIp } from "../blocklist/blocklist.service.js";
import { getAlertSettings, notifySecurityEvent } from "../alerts/alerts.service.js";
import AuditLog from "../audit/audit.model.js";
import AuthSession from "../auth/session.model.js";

export { notifySecurityEvent };

// ---------------------------------------------------------------------------
// Automatic defences: auto-ban for repeat offenders (failed sign-ins, spam
// bot hits, rate-limit abuse) and the honeypot / timing spam trap.
// ---------------------------------------------------------------------------

const SETTINGS_TTL_MS = 60 * 1000;
let settingsCache = { value: null, at: 0 };

export const getSecuritySettings = async ({ fresh = false } = {}) => {
  if (!fresh && settingsCache.value && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.value;

  let settings = await SecuritySettings.findOne({}).lean();
  if (!settings) settings = (await SecuritySettings.create({})).toObject();

  settingsCache = { value: settings, at: Date.now() };
  return settings;
};

export const updateSecuritySettings = async (data) => {
  const set = {};
  Object.entries(data).forEach(([group, value]) => {
    Object.entries(value || {}).forEach(([key, v]) => (set[`${group}.${key}`] = v));
  });

  await SecuritySettings.findOneAndUpdate({}, { $set: set }, { upsert: true, runValidators: true });
  settingsCache = { value: null, at: 0 };
  return getSecuritySettings({ fresh: true });
};

/* ---------- counters ---------- */

const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);

const bump = async (key, ttlSeconds) => {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, ttlSeconds);
  return count;
};

// Daily totals for the security page (kept 40 days).
const countDaily = (kind) => bump(`security:stat:${kind}:${dayKey()}`, 40 * 24 * 60 * 60).catch(() => {});

export const getDailyStats = async (kind, days = 30) => {
  const keys = Array.from({ length: days }, (_, i) => `security:stat:${kind}:${dayKey(new Date(Date.now() - i * 864e5))}`);

  try {
    const values = await redis.mGet(keys);
    return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
  } catch {
    return 0;
  }
};

/* ---------- auto-ban ---------- */

const OFFENCES = {
  login_failed: { setting: "loginFailures", label: "failed sign-ins" },
  spam: { setting: "spamHits", label: "spam bot submissions" },
  rate_limited: { setting: "rateLimitHits", label: "rate-limit violations" },
};

// Never auto-ban the admin's own networks: listed owner IPs, IPs the admin
// signed in from in the last 30 days, and IPs of live admin sessions.
const isTrustedIp = async (ip) => {
  const alertSettings = await getAlertSettings();
  if ((alertSettings.ownerIps || []).includes(ip)) return true;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [login, session] = await Promise.all([
    AuditLog.exists({ kind: "login", success: true, ip, createdAt: { $gte: since } }),
    AuthSession.exists({ revokedAt: null, $or: [{ ip }, { lastIp: ip }] }),
  ]);

  return Boolean(login || session);
};

const MAX_BAN_HOURS = 30 * 24;

const autoBan = async (ip, kind, count, settings) => {
  if (await isTrustedIp(ip)) {
    logger.warn({ action: "AUTO_BAN_SKIPPED_TRUSTED", ip, kind });
    return;
  }

  // Repeat offenders (within 90 days) get 7× longer each time.
  const strikes = await bump(`autoban:strikes:${ip}`, 90 * 24 * 60 * 60);
  const hours = Math.min(MAX_BAN_HOURS, settings.autoBan.banHours * 7 ** (strikes - 1));
  const reason = `Auto-ban: ${count} ${OFFENCES[kind].label} in ${settings.autoBan.windowMinutes} min${strikes > 1 ? ` (strike ${strikes})` : ""}`;

  const entry = await banIp({ value: ip, reason, hours });
  countDaily("auto_ban");
  logger.warn({ action: "AUTO_BAN", ip, kind, count, hours, strikes });

  if (entry && settings.autoBan.notify) {
    await notifySecurityEvent({
      title: `Auto-banned ${ip} for ${hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`}`,
      body: `${reason}. It can't sign in, send messages, comment or be tracked until the ban expires. Unban it under Security if this was you.`,
      link: "/dashboard/security",
      ip,
    });
  }
};

// Called wherever something suspicious happens. Never throws.
export const recordOffense = async (ip, kind) => {
  try {
    if (!ip || !isPublicIp(ip) || !OFFENCES[kind]) return;

    countDaily(kind);

    const settings = await getSecuritySettings();
    if (!settings.autoBan.enabled) return;

    const threshold = settings.autoBan[OFFENCES[kind].setting];
    const count = await bump(`autoban:${kind}:${ip}`, settings.autoBan.windowMinutes * 60);

    // Fire exactly once, at the threshold.
    if (count === threshold) await autoBan(ip, kind, count, settings);
  } catch (error) {
    logger.warn({ action: "RECORD_OFFENSE_FAILED", kind, error: error.message });
  }
};

/* ---------- spam trap ---------- */

// The public forms send two hidden fields: `_hp` — a honeypot input people
// never see (bots fill every field) — and `_ts`, milliseconds between the
// form appearing and being sent (people need a few seconds). A trapped
// submission gets the normal success response but is never saved.
// Requests without the fields (older cached bundles) pass through.
export const spamTrap = ({ success }) => async (req, res, next) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { _hp: honeypot, _ts: elapsed } = body;

  delete body._hp;
  delete body._ts;

  try {
    const settings = await getSecuritySettings();
    if (!settings.spamTrap.enabled) return next();

    const filledHoneypot = typeof honeypot === "string" && honeypot.trim() !== "";
    const tooFast = typeof elapsed === "number" && elapsed >= 0 && elapsed < settings.spamTrap.minSeconds * 1000;

    if (!filledHoneypot && !tooFast) return next();

    const ip = getClientIp(req);
    logger.warn({ action: "SPAM_TRAPPED", path: req.originalUrl, ip, reason: filledHoneypot ? "honeypot" : "too_fast", elapsed });
    recordOffense(ip, "spam");

    return res.status(201).json(success);
  } catch (error) {
    logger.warn({ action: "SPAM_TRAP_FAILED", error: error.message });
    return next();
  }
};
