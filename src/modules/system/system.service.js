import os from "os";
import { monitorEventLoopDelay } from "perf_hooks";
import mongoose from "mongoose";

import redis from "../../config/redis.js";
import cloudinary from "../../config/cloudinary.js";
import { AlertSettings } from "../alerts/alerts.model.js";
import { BackupConfig } from "../backups/backups.model.js";
import Post from "../blog/blog.model.js";

// ---------------------------------------------------------------------------
// System health for the admin panel: live checks of every dependency the
// API needs, plus process stats and scheduler state. External services
// (Cloudinary admin API, Resend) are rate-limited, so their checks are
// cached for a few minutes.
// ---------------------------------------------------------------------------

const startedAt = new Date();
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

const EXTERNAL_TTL_MS = 5 * 60 * 1000;
const externalCache = new Map();

const MONGO_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

const timed = async (fn) => {
  const start = performance.now();

  try {
    const detail = await fn();
    return { status: "ok", latencyMs: Math.round(performance.now() - start), ...detail };
  } catch (error) {
    return { status: "down", latencyMs: Math.round(performance.now() - start), error: error.message?.slice(0, 200) };
  }
};

const withTimeout = (promise, ms = 5000) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))]);

const cachedExternal = async (key, fn) => {
  const hit = externalCache.get(key);
  if (hit && Date.now() - hit.at < EXTERNAL_TTL_MS) return { ...hit.value, cached: true };

  const value = await fn();
  externalCache.set(key, { value, at: Date.now() });
  return value;
};

const checkMongo = () =>
  timed(async () => {
    await withTimeout(mongoose.connection.db.admin().ping());
    const stats = await mongoose.connection.db.command({ dbStats: 1 });
    const quotaBytes = (Number(process.env.MONGO_STORAGE_LIMIT_MB) || 512) * 1024 * 1024;
    const usedBytes = (stats.dataSize || 0) + (stats.indexSize || 0);

    return {
      state: MONGO_STATES[mongoose.connection.readyState] || "unknown",
      host: mongoose.connection.host,
      collections: stats.collections,
      documents: stats.objects,
      usedBytes,
      quotaBytes,
    };
  });

const checkRedis = () =>
  timed(async () => {
    if (!redis.isReady) throw new Error("Not connected");
    await withTimeout(redis.ping());

    const info = await redis.info("memory");
    const used = /used_memory:(\d+)/.exec(info)?.[1];

    return { usedBytes: used ? Number(used) : undefined, keys: await redis.dbSize() };
  });

const checkCloudinary = () =>
  cachedExternal("cloudinary", () =>
    process.env.CLOUDINARY_API_KEY
      ? timed(async () => {
          await withTimeout(cloudinary.api.ping());
          return {};
        })
      : { status: "not_configured" },
  );

const checkResend = () =>
  cachedExternal("resend", () =>
    process.env.RESEND_API_KEY
      ? timed(async () => {
          const response = await fetch("https://api.resend.com/domains", {
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
            signal: AbortSignal.timeout(5000),
          });

          // Sending-only keys can't list domains but are still valid.
          if (response.status === 401) throw new Error("API key rejected");

          const body = response.ok ? await response.json() : null;
          return {
            domains: body?.data?.map((d) => ({ name: d.name, status: d.status })),
            from: process.env.RESEND_FROM_EMAIL || null,
          };
        })
      : { status: "not_configured" },
  );

const checkGeo = async () => {
  const cooling = redis.isReady ? await redis.get("geo:ipapi:cooldown").catch(() => null) : null;

  return {
    status: cooling ? "degraded" : "ok",
    provider: "ipapi.co",
    keyConfigured: Boolean(process.env.IPAPI_KEY),
    note: cooling ? "Rate-limited — using the offline database for ~15 min" : undefined,
  };
};

const schedulers = async () => {
  const [alertSettings, backupConfig, scheduledPosts] = await Promise.all([
    AlertSettings.findOne({}).select("weeklyReport").lean(),
    BackupConfig.findOne({}).select("schedule lastRun").lean(),
    Post.countDocuments({ isVisible: false, scheduledAt: { $ne: null } }),
  ]);

  return {
    weeklyReport: {
      enabled: Boolean(alertSettings?.weeklyReport?.enabled),
      lastSentAt: alertSettings?.weeklyReport?.lastSentAt || null,
    },
    backups: {
      schedule: backupConfig?.schedule || "off",
      lastRunAt: backupConfig?.lastRun?.at || null,
      lastStatus: backupConfig?.lastRun?.status || null,
    },
    scheduledPosts,
  };
};

export const getSystemHealth = async () => {
  const [mongo, redisCheck, cloudinaryCheck, resend, geo, jobs] = await Promise.all([
    checkMongo(),
    checkRedis(),
    checkCloudinary(),
    checkResend(),
    checkGeo(),
    schedulers().catch(() => null),
  ]);

  const memory = process.memoryUsage();

  const services = { mongo, redis: redisCheck, cloudinary: cloudinaryCheck, resend, geo };
  const critical = [mongo, redisCheck];

  return {
    overall: critical.some((s) => s.status === "down")
      ? "down"
      : Object.values(services).some((s) => s.status === "down" || s.status === "degraded")
        ? "degraded"
        : "ok",
    checkedAt: new Date(),
    api: {
      status: "ok",
      startedAt,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      env: process.env.NODE_ENV || "development",
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
      systemMemory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      cpuLoad: os.loadavg()[0],
      cpus: os.cpus().length,
      eventLoopDelayMs: {
        mean: Math.round(loopDelay.mean / 1e6),
        p99: Math.round(loopDelay.percentile(99) / 1e6),
      },
      deploy: {
        service: process.env.RENDER_SERVICE_NAME || null,
        commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null,
        branch: process.env.RENDER_GIT_BRANCH || null,
        instance: process.env.RENDER_INSTANCE_ID || null,
      },
    },
    services,
    schedulers: jobs,
  };
};
