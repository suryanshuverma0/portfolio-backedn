import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";
import { isPublicIp } from "./analytics.utils.js";

// ---------------------------------------------------------------------------
// Online IP geolocation (ipapi.co) — the bundled geoip-lite database is
// coarse and often has no city, especially outside the US/EU, and knows
// nothing about the visitor's ISP. Looked up once per new session, after the
// tracker has already been answered, and cached per IP.
//
// Free tier is ~1000 lookups/day without a key; set IPAPI_KEY for more.
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const MISS_TTL_SECONDS = 6 * 60 * 60;
const COOLDOWN_KEY = "geo:ipapi:cooldown";
const COOLDOWN_SECONDS = 15 * 60;
const TIMEOUT_MS = 3000;

const cacheKey = (ip) => `geo:ip:${ip}`;

const trimmed = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);

const fromIpapi = (body) => {
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);

  return {
    location: {
      country: /^[A-Z]{2}$/.test(body.country_code || "") ? body.country_code : undefined,
      region: trimmed(body.region_code, 10),
      regionName: trimmed(body.region, 100),
      city: trimmed(body.city, 100),
      postal: trimmed(body.postal, 20),
      timezone: trimmed(body.timezone, 60),
      ll: Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? [lat, lng] : undefined,
      source: "ipapi",
    },
    network: {
      asn: trimmed(body.asn, 20),
      org: trimmed(body.org, 150),
    },
  };
};

// Returns { location, network } or null. Never throws.
export const lookupIp = async (ip) => {
  if (!isPublicIp(ip)) return null;

  try {
    const cached = await redis.get(cacheKey(ip));
    if (cached) return JSON.parse(cached);
    if (await redis.get(COOLDOWN_KEY)) return null;

    const url = new URL(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (process.env.IPAPI_KEY) url.searchParams.set("key", process.env.IPAPI_KEY);

    const response = await fetch(url, {
      headers: { "User-Agent": "portfolio-analytics/1.0" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 429 || response.status === 403) {
      await redis.setEx(COOLDOWN_KEY, COOLDOWN_SECONDS, "1");
      logger.warn({ action: "GEO_LOOKUP_RATE_LIMITED", status: response.status });
      return null;
    }

    const body = response.ok ? await response.json() : null;

    if (!body || body.error || !body.country_code) {
      await redis.setEx(cacheKey(ip), MISS_TTL_SECONDS, "null");
      return null;
    }

    const result = fromIpapi(body);
    await redis.setEx(cacheKey(ip), CACHE_TTL_SECONDS, JSON.stringify(result));

    return result;
  } catch (error) {
    logger.warn({ action: "GEO_LOOKUP_FAILED", error: error.message });
    return null;
  }
};

const definedOnly = (obj) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));

// Merges an online lookup over the location captured at ingestion. Edge
// (Cloudflare) data that already has a city is kept as the more direct
// signal; otherwise the online result wins field by field.
export const mergeLocation = (current, online) => {
  if (!online?.country) return current;
  if (current?.source === "cloudflare" && current.city) return { ...definedOnly(online), ...definedOnly(current) };
  if (current?.country && current.country !== online.country) return { ...definedOnly(online) };

  return { ...definedOnly(current || {}), ...definedOnly(online) };
};
