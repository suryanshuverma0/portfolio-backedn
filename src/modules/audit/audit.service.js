import AuditLog from "./audit.model.js";
import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";
import { getVisitorNetworkMeta } from "../analytics/analytics.utils.js";
import { lookupIp } from "../analytics/geo.service.js";
import { recordOffense } from "../security/security.service.js";

// Request → where it came from. The online location lookup runs after the
// entry is written, so sign-in never waits on it.
const requestContext = (req) => {
  const meta = getVisitorNetworkMeta(req);

  return {
    ip: meta.ip,
    location: meta.location
      ? { country: meta.location.country, city: meta.location.city, region: meta.location.regionName || meta.location.region }
      : undefined,
    device: meta.device,
    browser: [meta.browser, meta.browserVersion].filter(Boolean).join(" "),
    os: [meta.os, meta.osVersion].filter(Boolean).join(" "),
  };
};

const enrich = async (id, ip) => {
  const online = await lookupIp(ip);
  if (!online?.location?.country) return;

  await AuditLog.updateOne(
    { _id: id },
    {
      $set: {
        location: {
          country: online.location.country,
          city: online.location.city,
          region: online.location.regionName || online.location.region,
        },
        network: online.network?.org,
      },
    },
  );
};

const write = (entry, ip) =>
  AuditLog.create(entry)
    .then((doc) => enrich(doc._id, ip))
    .catch((error) => logger.warn({ action: "AUDIT_WRITE_FAILED", error: error.message }));

// Fire-and-forget: never blocks or fails a login.
export const recordLogin = (req, { user, email, method, success, reason }) => {
  try {
    const context = requestContext(req);

    write(
      {
        kind: "login",
        actorId: user?._id || user?.id || null,
        actorEmail: String(user?.email || email || "").slice(0, 200),
        method,
        success,
        reason: reason ? String(reason).slice(0, 200) : undefined,
        ...context,
      },
      context.ip,
    );

    if (!success) recordOffense(context.ip, "login_failed");
  } catch (error) {
    logger.warn({ action: "AUDIT_LOGIN_FAILED", error: error.message });
  }
};

/* ---------- admin actions ---------- */

const ACTION_VERBS = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

// Endpoints that fire constantly or aren't a change worth recording.
const SKIP_PATHS = [
  /^\/api\/v1\/analytics\/(collect|track)/,
  /^\/api\/v1\/auth\/(refresh|logout|login)/,
  /^\/api\/v1\/google-auth/,
  /^\/api\/v1\/passkey\/(authentication|signup)/,
  /^\/api\/v1\/alerts\/(owner-device|read-all|[a-f\d]{24}\/read)/,
];

const isIdLike = (segment) =>
  /^[a-f\d]{24}$/i.test(segment) || /^[0-9a-f-]{32,36}$/i.test(segment) || /\d/.test(segment);

// "/api/v1/contact/<id>/reply" → { resource: "contact", resourceId: <id>, action: "reply" }
const describePath = (method, path) => {
  const segments = path.replace(/^\/api\/v1\//, "").split("/").filter(Boolean);
  const [resource = "unknown", ...rest] = segments;
  const resourceId = rest.find(isIdLike);
  const words = rest.filter((segment) => !isIdLike(segment));

  return {
    resource,
    resourceId,
    action: words.length ? words.join(" ").slice(0, 60) : ACTION_VERBS[method] || method.toLowerCase(),
  };
};

const bodyLabel = (body) => {
  if (!body || typeof body !== "object") return undefined;
  const value = body.title || body.name || body.slug || body.company || body.label;
  return typeof value === "string" ? value.slice(0, 200) : undefined;
};

// Records every successful admin write once the response is sent. Repeats
// of the same request (autosave) fold into one entry per minute.
export const auditTrail = (req, res, next) => {
  const path = req.originalUrl.split("?")[0].slice(0, 300);

  if (!ACTION_VERBS[req.method] || SKIP_PATHS.some((pattern) => pattern.test(path))) return next();

  res.on("finish", () => {
    if (req.user?.role !== "admin" || res.statusCode >= 400) return;

    const context = requestContext(req);

    redis
      .set(`audit:dedupe:${req.method}:${path}`, "1", { NX: true, EX: 60 })
      .then((claimed) => {
        if (!claimed) return;

        return write(
          {
            kind: "action",
            actorId: req.user._id,
            actorEmail: req.user.email,
            httpMethod: req.method,
            path,
            ...describePath(req.method, path),
            label: bodyLabel(req.body),
            status: res.statusCode,
            ...context,
          },
          context.ip,
        );
      })
      .catch((error) => logger.warn({ action: "AUDIT_TRAIL_FAILED", error: error.message }));
  });

  next();
};

/* ---------- queries ---------- */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export const listAuditLogs = async ({ kind, page = 1, limit = 30, resource, failedOnly }) => {
  const filter = { kind };
  if (resource) filter.resource = resource;
  if (failedOnly) filter.success = false;

  const [items, total, resources, summary] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
    kind === "action" ? AuditLog.distinct("resource", { kind: "action" }) : [],
    kind === "login"
      ? AuditLog.aggregate([
          { $match: { kind: "login", createdAt: { $gte: new Date(Date.now() - MONTH_MS) } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              failed: { $sum: { $cond: ["$success", 0, 1] } },
              ips: { $addToSet: "$ip" },
              countries: { $addToSet: "$location.country" },
            },
          },
        ])
      : [],
  ]);

  const stats = summary[0];

  return {
    items,
    resources: resources.filter(Boolean).sort(),
    summary: stats
      ? {
          total: stats.total,
          failed: stats.failed,
          uniqueIps: stats.ips.filter(Boolean).length,
          countries: stats.countries.filter(Boolean),
        }
      : null,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
};
