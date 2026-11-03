import net from "net";
import { UAParser } from "ua-parser-js";
import { isBot } from "ua-parser-js/bot-detection";
import geoip from "geoip-lite";

const HEADLESS_UA = /headless|lighthouse|pagespeed|phantomjs|puppeteer|playwright|selenium/i;

// Express reports IPv4 clients on a dual-stack socket as "::ffff:1.2.3.4".
const normalizeIp = (ip) => String(ip || "").trim().replace(/^::ffff:/, "");

const PRIVATE_IP =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1?$|f[cd][0-9a-f]{2}:|fe80:)/i;

export const isPublicIp = (ip) => net.isIP(ip) !== 0 && !PRIVATE_IP.test(ip);

// The API runs behind Render's edge (itself behind Cloudflare), so req.ip
// with "trust proxy 1" is a proxy hop, not the visitor — which is why every
// session used to geolocate as unknown. Prefer the headers the edge sets
// with the real client address, then the left-most public X-Forwarded-For
// entry. Only used for analytics; the rate limiter keys on its own.
export const getClientIp = (req) => {
  const candidates = [
    req.headers["cf-connecting-ip"],
    req.headers["true-client-ip"],
    req.headers["x-real-ip"],
    ...String(req.headers["x-forwarded-for"] || "").split(","),
    req.ip,
  ].map(normalizeIp);

  return candidates.find(isPublicIp) || candidates.find((ip) => net.isIP(ip)) || "";
};

// Node decodes header bytes as latin1; Cloudflare sends UTF-8 city names.
const headerText = (value) =>
  value ? Buffer.from(String(value), "latin1").toString("utf8").slice(0, 100) : undefined;

// Cloudflare always sends CF-IPCountry; city/region/coords only when the
// "Add visitor location headers" managed transform is on for the zone.
const cloudflareLocation = (req) => {
  const country = String(req.headers["cf-ipcountry"] || "").toUpperCase();

  if (!/^[A-Z]{2}$/.test(country) || country === "XX" || country === "T1") return undefined;

  const lat = Number.parseFloat(req.headers["cf-iplatitude"]);
  const lng = Number.parseFloat(req.headers["cf-iplongitude"]);

  return {
    country,
    city: headerText(req.headers["cf-ipcity"]),
    region: headerText(req.headers["cf-region-code"])?.slice(0, 10),
    regionName: headerText(req.headers["cf-region"]),
    postal: headerText(req.headers["cf-postal-code"])?.slice(0, 20),
    timezone: headerText(req.headers["cf-timezone"])?.slice(0, 60),
    ll: Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : undefined,
    source: "cloudflare",
  };
};

const offlineLocation = (ip) => {
  const geo = ip ? geoip.lookup(ip) : null;

  if (!geo?.country) return undefined;

  return {
    country: geo.country,
    region: geo.region || undefined,
    city: geo.city || undefined,
    timezone: geo.timezone || undefined,
    ll: Array.isArray(geo.ll) && (geo.ll[0] || geo.ll[1]) ? geo.ll : undefined,
    source: "geoip",
  };
};

// Best location available synchronously: edge headers with a city win, then
// the offline database (when it agrees on the country), then country only.
// journey.service upgrades this afterwards with an online lookup.
export const resolveLocation = (req, ip) => {
  const edge = cloudflareLocation(req);
  const offline = offlineLocation(ip);

  if (edge?.city) return edge;
  if (offline && (!edge || edge.country === offline.country)) return offline;

  return edge;
};

const parseDevice = (ua) => {
  const deviceType = ua.device.type; // "mobile" | "tablet" | undefined

  return deviceType === "mobile" || deviceType === "tablet" ? deviceType : "desktop";
};

// Derives device/browser/os/country from the request itself — never from
// client-supplied fields, since those can't be trusted for anything used
// in aggregate reporting.
export const getRequestMeta = (req) => {
  const ua = new UAParser(req.headers["user-agent"] || "").getResult();

  const geo = resolveLocation(req, getClientIp(req));

  return {
    device: parseDevice(ua),
    browser: ua.browser.name || "Other",
    os: ua.os.name || "Other",
    country: geo?.country || undefined,
  };
};

// Fuller version of getRequestMeta for journey sessions: full IP, city-level
// location and versioned device details.
export const getVisitorNetworkMeta = (req) => {
  const userAgent = (req.headers["user-agent"] || "").slice(0, 500);
  const ua = new UAParser(userAgent).getResult();
  const ip = getClientIp(req);

  return {
    ip,
    location: resolveLocation(req, ip),
    userAgent,
    device: parseDevice(ua),
    deviceVendor: ua.device.vendor || undefined,
    deviceModel: ua.device.model || undefined,
    browser: ua.browser.name || "Other",
    browserVersion: ua.browser.version || undefined,
    os: ua.os.name || "Other",
    osVersion: ua.os.version || undefined,
    // isBot() only recognises crawlers from the raw UA string (not from a
    // parsed result); headless browsers / audit tools are caught separately.
    isBot: !userAgent || isBot(userAgent) || HEADLESS_UA.test(userAgent),
  };
};
