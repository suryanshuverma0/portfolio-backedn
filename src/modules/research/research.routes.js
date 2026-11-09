import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";

/* ---------------------------------------------------------------------------
   RESEARCH — papers shown in the portfolio's Research section and the hero
   announcement. Mirrors the shape the frontend card renders: headline
   results grouped by environment, architecture components, a metrics bar
   chart, contributions, notes, limitations and links.
--------------------------------------------------------------------------- */

const pair = new mongoose.Schema({ label: String, value: String }, { _id: false });
const named = new mongoose.Schema({ name: String, description: String }, { _id: false });

const researchSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, trim: true, maxlength: 80, default: "" },
    venue: { type: String, trim: true, maxlength: 120, default: "" },
    paperId: { type: String, trim: true, maxlength: 40, default: "" },
    schedule: { type: String, trim: true, maxlength: 120, default: "" },
    publishedAt: { type: Date, default: null },
    authors: { type: [new mongoose.Schema({ name: String, self: Boolean }, { _id: false })], default: [] },
    summary: { type: String, maxlength: 4000, default: "" },
    highlights: {
      type: [new mongoose.Schema({ environment: String, results: [pair] }, { _id: false })],
      default: [],
    },
    architectureTitle: { type: String, maxlength: 80, default: "" },
    architectureNote: { type: String, maxlength: 80, default: "" },
    contracts: { type: [named], default: [] },
    contributions: { type: [String], default: [] },
    metricsTitle: { type: String, maxlength: 80, default: "" },
    metricsNote: { type: String, maxlength: 80, default: "" },
    gas: { type: [pair], default: [] },
    evaluationNotes: { type: [String], default: [] },
    limitations: { type: [String], default: [] },
    technologies: { type: [String], default: [] },
    githubUrl: { type: String, default: "" },
    paperUrl: { type: String, default: "" },
    doiUrl: { type: String, default: "" },
    projectSlug: { type: String, default: "" },
    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Research = mongoose.models.Research || mongoose.model("Research", researchSchema);

/* ---------- validation ---------- */

const str = (max) => z.string().trim().max(max);
const url = z.union([z.literal(""), z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "Links must start with http(s)://")]);
const pairSchema = z.object({ label: str(200), value: str(60) });

const researchInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,80}$/, "Use lowercase letters, numbers and hyphens"),
  title: str(300).min(3, "Add a title"),
  status: str(80).optional(),
  venue: str(120).optional(),
  paperId: str(40).optional(),
  schedule: str(120).optional(),
  publishedAt: z.union([z.null(), z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
  authors: z.array(z.object({ name: str(120).min(1), self: z.boolean().optional() })).max(30).optional(),
  summary: str(4000).optional(),
  highlights: z.array(z.object({ environment: str(120), results: z.array(pairSchema).max(8) })).max(6).optional(),
  architectureTitle: str(80).optional(),
  architectureNote: str(80).optional(),
  contracts: z.array(z.object({ name: str(80).min(1), description: str(400).optional() })).max(10).optional(),
  contributions: z.array(str(600)).max(15).optional(),
  metricsTitle: str(80).optional(),
  metricsNote: str(80).optional(),
  gas: z.array(pairSchema).max(15).optional(),
  evaluationNotes: z.array(str(800)).max(15).optional(),
  limitations: z.array(str(800)).max(15).optional(),
  technologies: z.array(str(60)).max(40).optional(),
  githubUrl: url.optional(),
  paperUrl: url.optional(),
  doiUrl: url.optional(),
  projectSlug: z.union([z.literal(""), z.string().regex(/^[a-z0-9-]{1,120}$/)]).optional(),
  featured: z.boolean().optional(),
  order: z.number().int().min(0).max(10000).optional(),
  isVisible: z.boolean().optional(),
});

const reorderSchema = z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(200) });

/* ---------- routes ---------- */

const router = express.Router();

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    if (error?.code === 11000) return next(httpError("Another paper already uses that link name (slug)", 409));
    next(error);
  }
};
const checkId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError("Invalid id", 400);
  return id;
};

// Strip blank rows the editor may send.
const clean = (data) => ({
  ...data,
  authors: data.authors?.filter((a) => a.name),
  highlights: data.highlights?.map((h) => ({ ...h, results: h.results.filter((r) => r.label || r.value) })).filter((h) => h.environment || h.results.length),
  contracts: data.contracts?.filter((c) => c.name),
  gas: data.gas?.filter((g) => g.label || g.value),
  ...Object.fromEntries(["contributions", "evaluationNotes", "limitations", "technologies"].filter((k) => data[k]).map((k) => [k, data[k].filter(Boolean)])),
});

router.get(
  "/public",
  handle(async (req, res) => {
    res.set("Cache-Control", "public, max-age=60");
    return Research.find({ isVisible: true }).sort({ order: 1, createdAt: -1 }).lean();
  }),
);

router.use(protectAdmin);

router.get("/", handle(() => Research.find({}).sort({ order: 1, createdAt: -1 }).lean()));

router.post(
  "/",
  validate(researchInput),
  handle(async (req) => {
    const count = await Research.countDocuments({});
    return (await Research.create({ order: count, ...clean(req.validatedData) })).toObject();
  }),
);

router.put(
  "/reorder",
  validate(reorderSchema),
  handle(async (req) => {
    await Promise.all(req.validatedData.ids.map((id, order) => Research.updateOne({ _id: id }, { $set: { order } })));
    return true;
  }),
);

router.put(
  "/:id",
  validate(researchInput.partial()),
  handle(async (req) => {
    const doc = await Research.findByIdAndUpdate(checkId(req.params.id), { $set: clean(req.validatedData) }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) throw httpError("Paper not found", 404);
    return doc;
  }),
);

router.delete(
  "/:id",
  handle(async (req) => {
    const doc = await Research.findByIdAndDelete(checkId(req.params.id)).lean();
    if (!doc) throw httpError("Paper not found", 404);
    return true;
  }),
);

export default router;
export { researchInput };
