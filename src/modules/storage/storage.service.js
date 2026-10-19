import mongoose from "mongoose";
import { getOrSetCache } from "../../utils/cache.js";
import redis from "../../config/redis.js";
import logger from "../../utils/logger.js";

const CACHE_KEY = "storage:overview";
const CACHE_TTL_SECONDS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

// Atlas M0 (free tier) caps a cluster at 512 MB. Override for paid tiers.
const quotaBytes = () => (Number(process.env.MONGO_STORAGE_LIMIT_MB) || 512) * MB;

// Model name -> how it shows up in the admin panel. Collections without a
// model (or models not listed) fall into "Other".
const MODEL_INFO = {
  VisitorEvent: { label: "Visitor journey events", category: "Analytics" },
  VisitorSession: { label: "Visitor sessions", category: "Analytics" },
  PageView: { label: "Page views", category: "Analytics" },

  Profile: { label: "Profile", category: "Content" },
  Project: { label: "Projects", category: "Content" },
  Skill: { label: "Skills", category: "Content" },
  Certificate: { label: "Certificates", category: "Content" },
  Experience: { label: "Experience", category: "Content" },
  Education: { label: "Education", category: "Content" },
  Service: { label: "Services", category: "Content" },
  Stat: { label: "Stats", category: "Content" },
  Message: { label: "Contact messages", category: "Content" },

  Post: { label: "Blog posts", category: "Blog" },
  Comment: { label: "Blog comments", category: "Blog" },

  User: { label: "Users", category: "Accounts" },
  Passkey: { label: "Passkeys", category: "Accounts" },

  Settings: { label: "Site settings", category: "Other" },
  Card: { label: "NFC business card", category: "Content" },
  Notebook: { label: "Notes · notebooks", category: "Content" },
  NoteTopic: { label: "Notes · topics", category: "Content" },
  Note: { label: "Notes (typed & handwritten)", category: "Content" },
  NoteVersion: { label: "Notes · version history", category: "Content" },
};

export const CATEGORIES = ["Analytics", "Content", "Blog", "Accounts", "Other"];

const collectionInfoMap = () => {
  const map = new Map();

  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    map.set(model.collection.collectionName, {
      model: name,
      ...(MODEL_INFO[name] || { label: name, category: "Other" }),
    });
  }

  return map;
};

// Storage stats for one collection. $collStats is the modern API; the
// collStats command is the fallback for tiers/versions that reject it, and
// a bare document count is the last resort.
const getCollectionStats = async (db, name) => {
  try {
    const [row] = await db
      .collection(name)
      .aggregate([{ $collStats: { storageStats: {} } }])
      .toArray();
    const s = row?.storageStats;

    if (s) {
      return {
        count: s.count ?? 0,
        size: s.size ?? 0,
        avgObjSize: s.avgObjSize ?? 0,
        storageSize: s.storageSize ?? 0,
        totalIndexSize: s.totalIndexSize ?? 0,
        indexSizes: s.indexSizes || {},
        nindexes: s.nindexes ?? Object.keys(s.indexSizes || {}).length,
        source: "collStats",
      };
    }
  } catch (error) {
    logger.debug({ action: "STORAGE_COLLSTATS_STAGE_FAILED", name, error: error.message });
  }

  try {
    const s = await db.command({ collStats: name });

    return {
      count: s.count ?? 0,
      size: s.size ?? 0,
      avgObjSize: s.avgObjSize ?? 0,
      storageSize: s.storageSize ?? 0,
      totalIndexSize: s.totalIndexSize ?? 0,
      indexSizes: s.indexSizes || {},
      nindexes: s.nindexes ?? Object.keys(s.indexSizes || {}).length,
      source: "collStats",
    };
  } catch (error) {
    logger.debug({ action: "STORAGE_COLLSTATS_COMMAND_FAILED", name, error: error.message });
  }

  return {
    count: await db.collection(name).estimatedDocumentCount(),
    size: 0,
    avgObjSize: 0,
    storageSize: 0,
    totalIndexSize: 0,
    indexSizes: {},
    nindexes: 0,
    source: "count-only",
  };
};

// Documents created in the window, read off the ObjectId timestamp — works
// for every collection without relying on a createdAt field.
const countCreatedSince = async (db, name, since) => {
  try {
    return await db.collection(name).countDocuments({
      _id: { $gte: mongoose.Types.ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) },
    });
  } catch {
    return 0;
  }
};

const computeOverview = async () => {
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("Database not connected");
  }

  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS);
  const since7 = new Date(now - 7 * DAY_MS);

  const [dbStats, collectionList] = await Promise.all([
    db.command({ dbStats: 1, scale: 1 }),
    db.listCollections({}, { nameOnly: false }).toArray(),
  ]);

  const infoMap = collectionInfoMap();

  const names = collectionList
    .filter((c) => (c.type || "collection") === "collection" && !c.name.startsWith("system."))
    .map((c) => c.name);

  const collections = await Promise.all(
    names.map(async (name) => {
      const [stats, created30, created7] = await Promise.all([
        getCollectionStats(db, name),
        countCreatedSince(db, name, since30),
        countCreatedSince(db, name, since7),
      ]);

      const info = infoMap.get(name) || { model: null, label: name, category: "Other" };

      return {
        name,
        ...info,
        documents: stats.count,
        dataSize: stats.size,
        storageSize: stats.storageSize,
        indexSize: stats.totalIndexSize,
        avgDocSize: Math.round(stats.avgObjSize),
        totalSize: stats.size + stats.totalIndexSize,
        compressionRatio:
          stats.storageSize > 0 ? Math.round((stats.size / stats.storageSize) * 10) / 10 : null,
        indexes: Object.entries(stats.indexSizes)
          .map(([indexName, size]) => ({ name: indexName, size }))
          .sort((a, b) => b.size - a.size),
        created30d: created30,
        created7d: created7,
        estimatedGrowth30dBytes: Math.round(created30 * (stats.avgObjSize || 0)),
        statsSource: stats.source,
      };
    }),
  );

  collections.sort((a, b) => b.totalSize - a.totalSize);

  // Prefer dbStats totals (they include anything listCollections skipped);
  // fall back to summing collections when the tier hides them.
  const sum = (key) => collections.reduce((total, c) => total + (c[key] || 0), 0);
  const dataSize = dbStats.dataSize ?? sum("dataSize");
  const indexSize = dbStats.indexSize ?? sum("indexSize");
  const storageSize = dbStats.storageSize ?? sum("storageSize");
  const usedBytes = dataSize + indexSize;
  const limitBytes = quotaBytes();

  const categories = CATEGORIES.map((category) => {
    const members = collections.filter((c) => c.category === category);
    const bytes = members.reduce((total, c) => total + c.totalSize, 0);

    return {
      category,
      bytes,
      documents: members.reduce((total, c) => total + c.documents, 0),
      collections: members.length,
      percent: usedBytes > 0 ? Math.round((bytes / usedBytes) * 1000) / 10 : 0,
    };
  }).filter((c) => c.collections > 0);

  const growth30d = sum("estimatedGrowth30dBytes");
  const growthPerDay = growth30d / 30;
  const remaining = Math.max(0, limitBytes - usedBytes);

  return {
    database: dbStats.db,
    generatedAt: new Date().toISOString(),
    totals: {
      dataSize,
      storageSize,
      indexSize,
      usedBytes,
      totalSize: dbStats.totalSize ?? storageSize + indexSize,
      documents: dbStats.objects ?? sum("documents"),
      collections: names.length,
      indexes: dbStats.indexes ?? collections.reduce((total, c) => total + c.indexes.length, 0),
      avgDocSize: Math.round(dbStats.avgObjSize ?? 0),
    },
    quota: {
      limitBytes,
      usedBytes,
      remainingBytes: remaining,
      percent: Math.round((usedBytes / limitBytes) * 1000) / 10,
      // Atlas shared tiers count data size + index size toward the limit.
      basis: "dataSize + indexSize",
    },
    growth: {
      last30dBytes: growth30d,
      last7dBytes: collections.reduce((total, c) => total + Math.round(c.created7d * c.avgDocSize), 0),
      perDayBytes: Math.round(growthPerDay),
      daysUntilFull: growthPerDay > 0 ? Math.floor(remaining / growthPerDay) : null,
    },
    categories,
    collections,
    partialStats: collections.some((c) => c.statsSource !== "collStats"),
  };
};

export const getStorageOverview = async ({ refresh = false } = {}) => {
  if (refresh) {
    try {
      await redis.del(CACHE_KEY);
    } catch {
      /* cache miss is fine */
    }
  }

  return getOrSetCache(CACHE_KEY, CACHE_TTL_SECONDS, computeOverview);
};
