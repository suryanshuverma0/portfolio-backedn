import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import Resume from "./resume.model.js";
import { createResumeSchema, updateResumeSchema } from "./resume.validation.js";
import Profile from "../profile/profile.model.js";
import Settings from "../settings/settings.model.js";
import Experience from "../experience/experience.model.js";
import Project from "../projects/project.model.js";
import Education from "../education/education.model.js";
import Skill from "../skills/skills.model.js";
import Certificate from "../certificates/certificate.model.js";

/* ---------------------------------------------------------------------------
   RESUMES — built in the admin from the portfolio's own content.

   Public: GET /public/:slug (or /public for the default one) returns the
   resume's config plus only the items it selects, in its order — even if
   an item is hidden on the portfolio. Private resumes are never served.
--------------------------------------------------------------------------- */

const router = express.Router();

const FIELDS = {
  experience: "role company location employmentType startDate endDate isCurrent description technologies",
  projects: "title slug category description features technologies githubUrl liveUrl featured",
  education: "degree institution description startYear endYear current",
  certificates: "title issuer year verifyUrl featured",
  skills: "name category featured order",
};

const MODELS = { experience: Experience, projects: Project, education: Education, certificates: Certificate, skills: Skill };

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    if (error?.code === 11000) return next(httpError("That share link is already used by another resume", 409));
    next(error);
  }
};

const identity = async () => {
  const [profile, settings] = await Promise.all([
    Profile.findOne({}).select("name headline description roles").lean(),
    Settings.findOne({}).select("contactEmail contactPhone socials footerName resumeUrl").lean(),
  ]);
  return {
    name: profile?.name || settings?.footerName || "",
    headline: profile?.headline || "",
    summary: profile?.description || "",
    email: settings?.contactEmail || "",
    phone: settings?.contactPhone || "",
    linkedin: settings?.socials?.linkedin || "",
    github: settings?.socials?.github || "",
  };
};

// Everything the builder can pick from (hidden portfolio items included).
const allSources = async () => {
  const entries = await Promise.all(
    Object.entries(MODELS).map(async ([key, Model]) => [key, await Model.find({}).select(FIELDS[key]).sort({ order: 1, createdAt: -1 }).lean()]),
  );
  return { identity: await identity(), ...Object.fromEntries(entries) };
};

// Selected items only, in the resume's order.
const resolve = async (config) => {
  const selected = config?.selected || {};
  const entries = await Promise.all(
    Object.entries(MODELS).map(async ([key, Model]) => {
      const ids = (selected[key] || []).filter((id) => /^[a-f\d]{24}$/i.test(id));
      if (!ids.length) return [key, []];
      const docs = await Model.find({ _id: { $in: ids } }).select(FIELDS[key]).lean();
      const byId = new Map(docs.map((d) => [String(d._id), d]));
      return [key, ids.map((id) => byId.get(id)).filter(Boolean)];
    }),
  );
  return { identity: await identity(), ...Object.fromEntries(entries) };
};

const present = (doc) => ({
  id: String(doc._id),
  name: doc.name,
  slug: doc.slug,
  isPublic: doc.isPublic,
  isDefault: doc.isDefault,
  config: doc.config,
  views: doc.views,
  updatedAt: doc.updatedAt,
  createdAt: doc.createdAt,
});

const checkId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(id)) throw httpError("Invalid id", 400);
  return id;
};

// Only one default resume at a time.
const claimDefault = async (id) => Resume.updateMany({ _id: { $ne: id }, isDefault: true }, { $set: { isDefault: false } });

/* ---------- public ---------- */

const servePublic = (filter) =>
  handle(async (req, res) => {
    res.set("Cache-Control", "no-cache");
    const doc = await Resume.findOneAndUpdate({ ...filter(req), isPublic: true }, { $inc: { views: 1 } }, { returnDocument: "after" }).lean();
    if (!doc) throw httpError("Resume not found", 404);
    return { name: doc.name, slug: doc.slug, config: doc.config, updatedAt: doc.updatedAt, data: await resolve(doc.config) };
  });

router.get("/public", servePublic(() => ({ isDefault: true })));
router.get("/public/:slug", servePublic((req) => ({ slug: String(req.params.slug).toLowerCase().slice(0, 60) })));

/* ---------- admin ---------- */

router.use(protectAdmin);

router.get("/source", handle(() => allSources()));
router.get("/", handle(async () => (await Resume.find({}).sort({ updatedAt: -1 }).lean()).map(present)));
router.get("/:id", handle(async (req) => {
  const doc = await Resume.findById(checkId(req.params.id)).lean();
  if (!doc) throw httpError("Resume not found", 404);
  return present(doc);
}));

router.post(
  "/",
  validate(createResumeSchema),
  handle(async (req) => {
    const isFirst = (await Resume.countDocuments({})) === 0;
    const doc = await Resume.create({ ...req.validatedData, user: req.user._id, isDefault: req.validatedData.isDefault ?? isFirst });
    if (doc.isDefault) await claimDefault(doc._id);
    return present(doc.toObject());
  }),
);

router.put(
  "/:id",
  validate(updateResumeSchema),
  handle(async (req) => {
    const doc = await Resume.findByIdAndUpdate(checkId(req.params.id), { $set: req.validatedData }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) throw httpError("Resume not found", 404);
    if (doc.isDefault) await claimDefault(doc._id);
    return present(doc);
  }),
);

router.post(
  "/:id/duplicate",
  handle(async (req) => {
    const source = await Resume.findById(checkId(req.params.id)).lean();
    if (!source) throw httpError("Resume not found", 404);
    let slug = `${source.slug}-copy`.slice(0, 56);
    for (let i = 2; await Resume.exists({ slug }); i += 1) slug = `${source.slug.slice(0, 50)}-copy-${i}`;
    const doc = await Resume.create({ user: req.user._id, name: `${source.name} (copy)`.slice(0, 80), slug, isPublic: false, isDefault: false, config: source.config });
    return present(doc.toObject());
  }),
);

router.delete(
  "/:id",
  handle(async (req) => {
    const doc = await Resume.findByIdAndDelete(checkId(req.params.id)).lean();
    if (!doc) throw httpError("Resume not found", 404);
    // Keep a default if one is left.
    if (doc.isDefault) {
      const next = await Resume.findOne({}).sort({ updatedAt: -1 });
      if (next) await Resume.updateOne({ _id: next._id }, { $set: { isDefault: true } });
    }
    return true;
  }),
);

export default router;
