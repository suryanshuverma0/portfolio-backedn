import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import Appearance from "./appearance.model.js";
import { appearanceSchema, restoreSchema } from "./appearance.validation.js";

const router = express.Router();

const HISTORY_LIMIT = 10;

const getDoc = async () => (await Appearance.findOne({})) || Appearance.create({});

const adminView = (doc) => ({
  config: doc.config,
  updatedAt: doc.updatedAt,
  updatedBy: doc.updatedBy,
  history: (doc.history || []).map((entry, index) => ({
    index,
    savedAt: entry.savedAt,
    savedBy: entry.savedBy,
    preset: entry.config?.preset || null,
  })),
});

// Saves `config` as current, pushing the version it replaces to history.
const save = async (doc, config, email) => {
  if (doc.config) {
    doc.history.unshift({ config: doc.config, savedAt: doc.updatedAt || new Date(), savedBy: doc.updatedBy });
    doc.history = doc.history.slice(0, HISTORY_LIMIT);
  }

  doc.config = config;
  doc.updatedBy = email || "";
  doc.markModified("config");
  doc.markModified("history");

  await doc.save();
  return doc;
};

const handle = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    next(error);
  }
};

// Public: read on every visit, so never cached by browsers or proxies —
// an admin save shows up on the next page load.
router.get(
  "/public",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-cache");
    const doc = await Appearance.findOne({}).select("config updatedAt").lean();
    return { config: doc?.config || null, updatedAt: doc?.updatedAt || null };
  }),
);

router.get("/", protectAdmin, handle(async () => adminView(await getDoc())));

router.put(
  "/",
  protectAdmin,
  validate(appearanceSchema),
  handle(async (req) => adminView(await save(await getDoc(), req.validatedData, req.user?.email))),
);

// Reset: the live site falls back to its built-in defaults. The current
// version is kept in history, so a reset can be undone too.
router.delete(
  "/",
  protectAdmin,
  handle(async (req) => adminView(await save(await getDoc(), null, req.user?.email))),
);

router.post(
  "/restore",
  protectAdmin,
  validate(restoreSchema),
  handle(async (req) => {
    const doc = await getDoc();
    const entry = doc.history[req.validatedData.index];

    if (!entry) {
      const error = new Error("That version no longer exists");
      error.statusCode = 404;
      throw error;
    }

    return adminView(await save(doc, entry.config, req.user?.email));
  }),
);

export default router;
