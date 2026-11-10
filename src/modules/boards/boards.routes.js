import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import requireLifeUnlock from "../life/requireLifeUnlock.middleware.js";

/* ---------------------------------------------------------------------------
   BOARDS — vision boards / whiteboards: an Excalidraw scene (shapes, ink,
   sticky notes, images) plus a meeting side: agenda, decisions with status,
   action items (which can become planner tasks) and linked notes.
   Behind the life lock.
--------------------------------------------------------------------------- */

const boardSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    emoji: { type: String, default: "🧠", maxlength: 8 },
    color: { type: String, default: "#ffd65a", maxlength: 9 },
    kind: { type: String, enum: ["vision", "brainstorm", "flow", "meeting", "decision", "blank"], default: "blank" },
    scene: { type: mongoose.Schema.Types.Mixed, default: null }, // { elements, appState, files }
    thumbnail: { type: String, default: "" }, // small PNG data URL
    meeting: {
      date: { type: String, default: "" },
      attendees: { type: [String], default: [] },
      agenda: { type: [new mongoose.Schema({ text: String, done: Boolean }, { _id: false })], default: [] },
      notes: { type: String, default: "" },
    },
    decisions: {
      type: [new mongoose.Schema({ id: String, text: String, status: String, owner: String, why: String, date: String }, { _id: false })],
      default: [],
    },
    actions: {
      type: [new mongoose.Schema({ id: String, text: String, owner: String, due: String, done: Boolean, taskId: String }, { _id: false })],
      default: [],
    },
    linkedNotes: { type: [String], default: [] },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true, minimize: false },
);

const Board = mongoose.models.Board || mongoose.model("Board", boardSchema);

const short = (n) => z.string().max(n);
const boardInput = z.object({
  title: z.string().trim().min(1).max(160),
  emoji: short(8).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kind: z.enum(["vision", "brainstorm", "flow", "meeting", "decision", "blank"]).optional(),
  scene: z.object({ elements: z.array(z.any()).max(20000), appState: z.record(z.string(), z.any()).optional(), files: z.record(z.string(), z.any()).optional() }).nullable().optional(),
  thumbnail: z.union([z.literal(""), z.string().max(400_000).regex(/^data:image\/(png|jpeg|webp);base64,/)]).optional(),
  meeting: z
    .object({
      date: short(20).optional(),
      attendees: z.array(short(80)).max(50).optional(),
      agenda: z.array(z.object({ text: short(300), done: z.boolean() })).max(100).optional(),
      notes: short(20000).optional(),
    })
    .optional(),
  decisions: z.array(z.object({ id: short(40), text: short(500), status: z.enum(["proposed", "approved", "rejected", "parked"]), owner: short(80).optional(), why: short(1000).optional(), date: short(20).optional() })).max(200).optional(),
  actions: z.array(z.object({ id: short(40), text: short(300), owner: short(80).optional(), due: short(20).optional(), done: z.boolean(), taskId: short(40).optional() })).max(200).optional(),
  linkedNotes: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(50).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

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

const router = express.Router();
router.use(protectAdmin, requireLifeUnlock);

// List without the heavy scene.
router.get("/", send(() => Board.find({}).select("-scene").sort({ pinned: -1, updatedAt: -1 }).lean()));

router.get(
  "/:id",
  send(async (req) => {
    const board = await Board.findById(id(req.params.id)).lean();
    if (!board) throw httpError("Board not found", 404);
    return board;
  }),
);

router.post("/", validate(boardInput), send(async (req) => (await Board.create(req.validatedData)).toObject()));

router.patch(
  "/:id",
  validate(boardInput.partial()),
  send(async (req) => {
    const doc = await Board.findByIdAndUpdate(id(req.params.id), { $set: req.validatedData }, { returnDocument: "after", runValidators: true }).select("-scene").lean();
    if (!doc) throw httpError("Board not found", 404);
    return doc;
  }),
);

router.post(
  "/:id/duplicate",
  send(async (req) => {
    const src = await Board.findById(id(req.params.id)).lean();
    if (!src) throw httpError("Board not found", 404);
    const { _id, createdAt, updatedAt, ...rest } = src;
    return (await Board.create({ ...rest, title: `${src.title} (copy)`.slice(0, 160), pinned: false })).toObject();
  }),
);

router.delete(
  "/:id",
  send(async (req) => {
    await Board.deleteOne({ _id: id(req.params.id) });
    return true;
  }),
);

export { Board };
export default router;
