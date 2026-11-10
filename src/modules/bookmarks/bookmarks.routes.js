import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";
import requireLifeUnlock from "../life/requireLifeUnlock.middleware.js";
import { previewFor } from "../products/products.routes.js";

/* ---------------------------------------------------------------------------
   BOOKMARKS — links, text snippets and notes-to-self with title,
   description, category, tags, pinned and a reading-list status. Pasting a
   link reads the page's title, description, icon and social image through
   the SSRF-safe fetcher. Behind the life lock.
--------------------------------------------------------------------------- */

const bookmarkSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["link", "text"], default: "link" },
    url: { type: String, default: "", maxlength: 2000 },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, default: "", maxlength: 2000 },
    content: { type: String, default: "", maxlength: 20000 }, // text snippets
    category: { type: String, default: "", trim: true, maxlength: 60, index: true },
    tags: { type: [String], default: [], index: true },
    icon: { type: String, default: "", maxlength: 2000 },
    image: { type: String, default: "", maxlength: 2000 },
    siteName: { type: String, default: "", maxlength: 120 },
    color: { type: String, default: "", maxlength: 9 },
    notes: { type: String, default: "", maxlength: 5000 },
    pinned: { type: Boolean, default: false },
    status: { type: String, enum: ["saved", "unread", "read"], default: "saved" },
    openCount: { type: Number, default: 0 },
    lastOpenedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
bookmarkSchema.index({ title: "text", description: "text", content: "text", url: "text", tags: "text" });

export const Bookmark = mongoose.models.Bookmark || mongoose.model("Bookmark", bookmarkSchema);

const httpUrl = z.union([z.literal(""), z.string().trim().max(2000).url().refine((u) => /^https?:\/\//i.test(u), "Links must start with http(s)://")]);
const tag = z.string().trim().toLowerCase().min(1).max(40);

const input = z.object({
  kind: z.enum(["link", "text"]).optional(),
  url: httpUrl.optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).optional(),
  content: z.string().max(20000).optional(),
  category: z.string().trim().max(60).optional(),
  tags: z.array(tag).max(30).optional(),
  icon: httpUrl.optional(),
  image: httpUrl.optional(),
  siteName: z.string().trim().max(120).optional(),
  color: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  notes: z.string().max(5000).optional(),
  pinned: z.boolean().optional(),
  status: z.enum(["saved", "unread", "read"]).optional(),
});

const router = express.Router();
router.use(protectAdmin, requireLifeUnlock);

const previewLimiter = slidingWindowLimiter({ prefix: "bookmark-preview", limit: 60, windowInSeconds: 10 * 60, countsAsOffense: false });
const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const id = (v) => {
  if (!/^[a-f\d]{24}$/i.test(String(v))) throw httpError("Invalid id", 400);
  return v;
};
const send = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get(
  "/",
  send(async (req) => {
    const filter = {};
    const q = String(req.query.q || "").trim().slice(0, 100);
    if (q) {
      const re = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ title: re }, { description: re }, { url: re }, { tags: re }, { content: re }, { category: re }, { notes: re }];
    }
    if (typeof req.query.category === "string" && req.query.category) filter.category = req.query.category === "__none" ? "" : req.query.category;
    if (typeof req.query.tag === "string" && req.query.tag) filter.tags = req.query.tag.toLowerCase();
    if (["link", "text"].includes(req.query.kind)) filter.kind = req.query.kind;
    if (["saved", "unread", "read"].includes(req.query.status)) filter.status = req.query.status;
    if (req.query.pinned === "1") filter.pinned = true;
    const sort = req.query.sort === "opened" ? { openCount: -1, lastOpenedAt: -1 } : req.query.sort === "title" ? { title: 1 } : { pinned: -1, createdAt: -1 };
    return Bookmark.find(filter).sort(sort).limit(2000).lean();
  }),
);

router.get(
  "/facets",
  send(async () => {
    const [categories, tags, kinds, statuses, total] = await Promise.all([
      Bookmark.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
      Bookmark.aggregate([{ $unwind: "$tags" }, { $group: { _id: "$tags", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 60 }]),
      Bookmark.aggregate([{ $group: { _id: "$kind", n: { $sum: 1 } } }]),
      Bookmark.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
      Bookmark.countDocuments({}),
    ]);
    const map = (rows) => rows.map((r) => ({ value: r._id || "", count: r.n }));
    return { total, categories: map(categories), tags: map(tags), kinds: map(kinds), statuses: map(statuses) };
  }),
);

router.post(
  "/preview",
  previewLimiter,
  validate(z.object({ url: z.string().trim().min(4).max(2000) })),
  send(async (req) => {
    try {
      const p = await previewFor(req.validatedData.url);
      return {
        url: p.url || p.links?.website || p.links?.appStore || p.links?.playStore || req.validatedData.url,
        title: p.name || "",
        description: p.tagline && p.description && !p.description.startsWith(p.tagline) ? `${p.tagline}\n${p.description}`.slice(0, 2000) : (p.description || p.tagline || "").slice(0, 2000),
        icon: p.icon || "",
        image: p.image || p.screenshots?.[0] || "",
        siteName: p.name || "",
        color: p.accent || "",
      };
    } catch (error) {
      if (error.statusCode && error.statusCode < 500) throw error;
      throw httpError(`Couldn't read that page (${error.code || error.message}) — you can still save it`, 422);
    }
  }),
);

router.post("/", validate(input), send(async (req) => (await Bookmark.create(req.validatedData)).toObject()));

router.post(
  "/bulk",
  validate(z.object({ items: z.array(input).min(1).max(2000) })),
  send(async (req) => {
    const existing = new Set((await Bookmark.find({ url: { $in: req.validatedData.items.map((i) => i.url).filter(Boolean) } }).select("url").lean()).map((b) => b.url));
    const fresh = req.validatedData.items.filter((i) => !i.url || !existing.has(i.url));
    const created = fresh.length ? await Bookmark.insertMany(fresh, { ordered: false }) : [];
    return { created: created.length, skipped: req.validatedData.items.length - created.length };
  }),
);

router.patch(
  "/:id",
  validate(input.partial()),
  send(async (req) => {
    const doc = await Bookmark.findByIdAndUpdate(id(req.params.id), { $set: req.validatedData }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) throw httpError("Bookmark not found", 404);
    return doc;
  }),
);

router.post(
  "/:id/open",
  send(async (req) => {
    await Bookmark.updateOne({ _id: id(req.params.id) }, { $inc: { openCount: 1 }, $set: { lastOpenedAt: new Date() } });
    return true;
  }),
);

router.post(
  "/rename-category",
  validate(z.object({ from: z.string().trim().max(60), to: z.string().trim().max(60) })),
  send(async (req) => {
    const r = await Bookmark.updateMany({ category: req.validatedData.from }, { $set: { category: req.validatedData.to } });
    return { updated: r.modifiedCount };
  }),
);

router.delete(
  "/:id",
  send(async (req) => {
    await Bookmark.deleteOne({ _id: id(req.params.id) });
    return true;
  }),
);

export default router;
