import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Private notes (admin only). Notebook → Topic (nested via `parent`, any
// depth) → Note. A note is either "typed" (Tiptap/ProseMirror JSON) or
// "handwritten" (vector ink: strokes, shapes and images in page units).
//
// Deletes are soft: `deletedAt` + `trashBatch` so a notebook or topic sent
// to the trash comes back together with everything deleted alongside it.
// ---------------------------------------------------------------------------

const trashFields = {
  deletedAt: { type: Date, default: null, index: true },
  trashBatch: { type: String, default: null, index: true },
  // true on the item the user actually deleted (what the trash lists)
  trashRoot: { type: Boolean, default: false },
};

const notebookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    color: { type: String, trim: true, maxlength: 9, default: "#2a78d6" },
    icon: { type: String, trim: true, maxlength: 8, default: "📓" },
    order: { type: Number, default: 0 },
    ...trashFields,
  },
  { timestamps: true },
);

const topicSchema = new mongoose.Schema(
  {
    notebook: { type: mongoose.Schema.Types.ObjectId, ref: "Notebook", required: true, index: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "NoteTopic", default: null, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    order: { type: Number, default: 0 },
    ...trashFields,
  },
  { timestamps: true },
);

export const NOTE_KINDS = ["typed", "handwritten"];
export const PAPERS = ["blank", "lined", "grid", "dotted"];

const noteSchema = new mongoose.Schema(
  {
    notebook: { type: mongoose.Schema.Types.ObjectId, ref: "Notebook", required: true, index: true },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: "NoteTopic", default: null, index: true },
    title: { type: String, trim: true, maxlength: 200, default: "Untitled" },
    kind: { type: String, enum: NOTE_KINDS, required: true },
    order: { type: Number, default: 0 },
    isPinned: { type: Boolean, default: false },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],

    // typed: Tiptap document JSON + plain text (search / previews)
    doc: { type: mongoose.Schema.Types.Mixed, default: null },
    text: { type: String, default: "" },

    // handwritten: { paper, elements: [...] }
    ink: { type: mongoose.Schema.Types.Mixed, default: null },

    lastVersionAt: { type: Date, default: null },

    // Blog post this note was published as (kept when unpublished, so
    // publishing again updates the same post and URL).
    blogPost: { type: mongoose.Schema.Types.ObjectId, ref: "Post", default: null },
    ...trashFields,
  },
  { timestamps: true, minimize: false },
);

noteSchema.index({ title: "text", text: "text", tags: "text" }, { weights: { title: 5, tags: 3, text: 1 } });
noteSchema.index({ tags: 1 });
noteSchema.index({ updatedAt: -1 });

const noteVersionSchema = new mongoose.Schema(
  {
    note: { type: mongoose.Schema.Types.ObjectId, ref: "Note", required: true, index: true },
    title: { type: String },
    kind: { type: String, enum: NOTE_KINDS },
    doc: { type: mongoose.Schema.Types.Mixed, default: null },
    text: { type: String, default: "" },
    ink: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

export const Notebook = mongoose.model("Notebook", notebookSchema);
export const NoteTopic = mongoose.model("NoteTopic", topicSchema);
export const Note = mongoose.model("Note", noteSchema);
export const NoteVersion = mongoose.model("NoteVersion", noteVersionSchema);
