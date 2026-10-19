import { UAParser } from "ua-parser-js";
import { isBot } from "ua-parser-js/bot-detection";
import geoip from "geoip-lite";

const HEADLESS_UA = /headless|lighthouse|pagespeed|phantomjs|puppeteer|playwright|selenium/i;

// Express reports IPv4 clients on a dual-stack socket as "::ffff:1.2.3.4".
const normalizeIp = (ip) => (ip || "").replace(/^::ffff:/, "");

const parseDevice = (ua) => {
  const deviceType = ua.device.type; // "mobile" | "tablet" | undefined

  return deviceType === "mobile" || deviceType === "tablet" ? deviceType : "desktop";
};

// Derives device/browser/os/country from the request itself — never from
// client-supplied fields, since those can't be trusted for anything used
// in aggregate reporting.
export const getRequestMeta = (req) => {
  const ua = new UAParser(req.headers["user-agent"] || "").getResult();

  const geo = geoip.lookup(normalizeIp(req.ip));

  return {
    device: parseDevice(ua),
    browser: ua.browser.name || "Other",
    os: ua.os.name || "Other",
    country: geo?.country || undefined,
  };
};

// Fuller version of getRequestMeta for journey sessions: full IP, city-level
// location (offline geoip-lite lookup) and versioned device details.
export const getVisitorNetworkMeta = (req) => {
  const userAgent = (req.headers["user-agent"] || "").slice(0, 500);
  const ua = new UAParser(userAgent).getResult();
  const ip = normalizeIp(req.ip);
  const geo = geoip.lookup(ip);

  return {
    ip,
    location: geo
      ? {
          country: geo.country || undefined,
          region: geo.region || undefined,
          city: geo.city || undefined,
          timezone: geo.timezone || undefined,
          ll: Array.isArray(geo.ll) ? geo.ll : undefined,
        }
      : undefined,
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
