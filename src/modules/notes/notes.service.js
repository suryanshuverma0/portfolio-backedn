import crypto from "node:crypto";
import mongoose from "mongoose";
import { Notebook, NoteTopic, Note, NoteVersion } from "./notes.model.js";
// The global error handler reads err.statusCode.
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VERSION_INTERVAL_MS = 10 * 60 * 1000; // at most one snapshot per 10 min of editing
const MAX_VERSIONS_PER_NOTE = 50;
const TRASH_RETENTION_DAYS = 30;

const ALIVE = { deletedAt: null };

const notFound = (what) => new ApiError(404, `${what} not found`);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NOTE_SUMMARY_PROJECTION = {
  title: 1,
  kind: 1,
  notebook: 1,
  topic: 1,
  order: 1,
  isPinned: 1,
  tags: 1,
  updatedAt: 1,
  createdAt: 1,
  excerpt: { $substrCP: [{ $ifNull: ["$text", ""] }, 0, 160] },
  strokeCount: { $size: { $ifNull: ["$ink.elements", []] } },
};

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------

export const getTree = async () => {
  const [notebooks, topics, notes] = await Promise.all([
    Notebook.find(ALIVE).sort({ order: 1, createdAt: 1 }).lean(),
    NoteTopic.find(ALIVE).sort({ order: 1, createdAt: 1 }).lean(),
    Note.aggregate([
      { $match: ALIVE },
      { $sort: { order: 1, createdAt: 1 } },
      { $project: NOTE_SUMMARY_PROJECTION },
    ]),
  ]);

  return { notebooks, topics, notes };
};

// ---------------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------------

export const createNotebook = async (data) => {
  const last = await Notebook.findOne(ALIVE).sort({ order: -1 }).select("order").lean();
  return Notebook.create({ ...data, order: (last?.order ?? -1) + 1 });
};

export const updateNotebook = async (id, data) => {
  const notebook = await Notebook.findOneAndUpdate({ _id: id, ...ALIVE }, { $set: data }, { returnDocument: "after" });
  if (!notebook) throw notFound("Notebook");
  return notebook;
};

const softDelete = async (filters) => {
  const batch = crypto.randomUUID();
  const now = new Date();
  const set = (root) => ({ $set: { deletedAt: now, trashBatch: batch, trashRoot: root } });

  await Promise.all(
    filters.map(({ model, filter, root }) => model.updateMany({ ...filter, ...ALIVE }, set(root))),
  );

  return batch;
};

export const deleteNotebook = async (id) => {
  const notebook = await Notebook.findOne({ _id: id, ...ALIVE }).lean();
  if (!notebook) throw notFound("Notebook");

  await softDelete([
    { model: Notebook, filter: { _id: id }, root: true },
    { model: NoteTopic, filter: { notebook: id }, root: false },
    { model: Note, filter: { notebook: id }, root: false },
  ]);
};

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

const descendantTopicIds = async (topicId) => {
  const all = await NoteTopic.find(ALIVE).select("_id parent").lean();
  const children = new Map();
  all.forEach((t) => {
    const key = String(t.parent || "");
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(String(t._id));
  });

  const result = [];
  const stack = [String(topicId)];
  while (stack.length) {
    const current = stack.pop();
    (children.get(current) || []).forEach((child) => {
      result.push(child);
      stack.push(child);
    });
  }
  return result;
};

const assertParentValid = async (notebookId, parentId) => {
  if (!parentId) return;
  const parent = await NoteTopic.findOne({ _id: parentId, ...ALIVE }).lean();
  if (!parent) throw notFound("Parent topic");
  if (String(parent.notebook) !== String(notebookId)) {
    throw new ApiError(400, "Parent topic belongs to another notebook");
  }
};

export const createTopic = async ({ notebook, parent = null, title }) => {
  if (!(await Notebook.exists({ _id: notebook, ...ALIVE }))) throw notFound("Notebook");
  await assertParentValid(notebook, parent);

  const last = await NoteTopic.findOne({ notebook, parent, ...ALIVE }).sort({ order: -1 }).select("order").lean();
  return NoteTopic.create({ notebook, parent, title, order: (last?.order ?? -1) + 1 });
};

export const updateTopic = async (id, data) => {
  const topic = await NoteTopic.findOne({ _id: id, ...ALIVE });
  if (!topic) throw notFound("Topic");

  const movingNotebook = data.notebook && String(data.notebook) !== String(topic.notebook);
  const targetNotebook = data.notebook || topic.notebook;

  if (data.parent !== undefined || movingNotebook) {
    const parent = data.parent === undefined ? (movingNotebook ? null : topic.parent) : data.parent;
    if (parent) {
      const descendants = await descendantTopicIds(id);
      if (String(parent) === String(id) || descendants.includes(String(parent))) {
        throw new ApiError(400, "A topic can't be moved inside itself");
      }
    }
    if (movingNotebook && !(await Notebook.exists({ _id: targetNotebook, ...ALIVE }))) throw notFound("Notebook");
    await assertParentValid(targetNotebook, parent);
    topic.parent = parent;
  }

  if (data.title !== undefined) topic.title = data.title;

  if (movingNotebook) {
    topic.notebook = targetNotebook;
    // Sub-topics and notes follow the topic into its new notebook.
    const descendants = await descendantTopicIds(id);
    await Promise.all([
      NoteTopic.updateMany({ _id: { $in: descendants } }, { $set: { notebook: targetNotebook } }),
      Note.updateMany({ topic: { $in: [id, ...descendants] } }, { $set: { notebook: targetNotebook } }),
    ]);
  }

  await topic.save();
  return topic;
};

export const deleteTopic = async (id) => {
  if (!(await NoteTopic.exists({ _id: id, ...ALIVE }))) throw notFound("Topic");
  const descendants = await descendantTopicIds(id);

  await softDelete([
    { model: NoteTopic, filter: { _id: id }, root: true },
    { model: NoteTopic, filter: { _id: { $in: descendants } }, root: false },
    { model: Note, filter: { topic: { $in: [id, ...descendants] } }, root: false },
  ]);
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const assertTopicInNotebook = async (notebookId, topicId) => {
  if (!(await Notebook.exists({ _id: notebookId, ...ALIVE }))) throw notFound("Notebook");
  if (!topicId) return;
  const topic = await NoteTopic.findOne({ _id: topicId, ...ALIVE }).lean();
  if (!topic) throw notFound("Topic");
  if (String(topic.notebook) !== String(notebookId)) throw new ApiError(400, "Topic belongs to another notebook");
};

export const createNote = async ({ notebook, topic = null, kind, title, paper }) => {
  await assertTopicInNotebook(notebook, topic);

  const last = await Note.findOne({ notebook, topic, ...ALIVE }).sort({ order: -1 }).select("order").lean();

  return Note.create({
    notebook,
    topic,
    kind,
    title: title || (kind === "handwritten" ? "Untitled sketch" : "Untitled note"),
    order: (last?.order ?? -1) + 1,
    doc: kind === "typed" ? { type: "doc", content: [{ type: "paragraph" }] } : null,
    ink: kind === "handwritten" ? { paper: paper || "lined", elements: [] } : null,
  });
};

export const getNote = async (id) => {
  const note = await Note.findOne({ _id: id, ...ALIVE }).lean();
  if (!note) throw notFound("Note");
  return note;
};

const snapshot = (note) =>
  NoteVersion.create({
    note: note._id,
    title: note.title,
    kind: note.kind,
    doc: note.doc,
    text: note.text,
    ink: note.ink,
  });

const pruneVersions = async (noteId) => {
  const stale = await NoteVersion.find({ note: noteId })
    .sort({ createdAt: -1 })
    .skip(MAX_VERSIONS_PER_NOTE)
    .select("_id")
    .lean();
  if (stale.length) await NoteVersion.deleteMany({ _id: { $in: stale.map((v) => v._id) } });
};

export const updateNote = async (id, data) => {
  const note = await Note.findOne({ _id: id, ...ALIVE });
  if (!note) throw notFound("Note");

  const changesContent = data.doc !== undefined || data.ink !== undefined;

  // Snapshot the state *before* this edit at most every 10 minutes, so the
  // history holds meaningful checkpoints rather than every autosave.
  if (changesContent && (!note.lastVersionAt || Date.now() - note.lastVersionAt > VERSION_INTERVAL_MS)) {
    const hasContent =
      (note.kind === "typed" && note.text?.trim()) || (note.kind === "handwritten" && note.ink?.elements?.length);
    if (hasContent) {
      await snapshot(note.toObject());
      await pruneVersions(note._id);
    }
    note.lastVersionAt = new Date();
  }

  if (data.notebook !== undefined || data.topic !== undefined) {
    const notebook = data.notebook ?? note.notebook;
    const topic = data.topic !== undefined ? data.topic : data.notebook ? null : note.topic;
    await assertTopicInNotebook(notebook, topic);
    note.notebook = notebook;
    note.topic = topic;
  }

  ["title", "isPinned", "tags", "text"].forEach((key) => {
    if (data[key] !== undefined) note[key] = data[key];
  });

  if (data.doc !== undefined && note.kind === "typed") {
    note.doc = data.doc;
    note.markModified("doc");
  }
  if (data.ink !== undefined && note.kind === "handwritten") {
    note.ink = data.ink;
    note.markModified("ink");
  }

  await note.save();

  const { doc, ink, ...meta } = note.toObject();
  return { ...meta, savedAt: note.updatedAt };
};

export const deleteNote = async (id) => {
  if (!(await Note.exists({ _id: id, ...ALIVE }))) throw notFound("Note");
  await softDelete([{ model: Note, filter: { _id: id }, root: true }]);
};

export const reorder = async ({ type, ids }) => {
  const model = { notebook: Notebook, topic: NoteTopic, note: Note }[type];
  await model.bulkWrite(
    ids.map((id, index) => ({ updateOne: { filter: { _id: id }, update: { $set: { order: index } } } })),
  );
};

// ---------------------------------------------------------------------------
// Search & tags
// ---------------------------------------------------------------------------

export const searchNotes = async ({ q, tag }) => {
  const base = { ...ALIVE, ...(tag ? { tags: tag.toLowerCase() } : {}) };

  if (!q) {
    return Note.aggregate([{ $match: base }, { $sort: { updatedAt: -1 } }, { $limit: 100 }, { $project: NOTE_SUMMARY_PROJECTION }]);
  }

  // Word search ranks by relevance; the regex pass catches partial words
  // ("algo" → "algorithms") that $text doesn't match.
  const [byText, byPrefix] = await Promise.all([
    Note.aggregate([
      { $match: { ...base, $text: { $search: q } } },
      { $addFields: { score: { $meta: "textScore" } } },
      { $sort: { score: -1 } },
      { $limit: 50 },
      { $project: NOTE_SUMMARY_PROJECTION },
    ]),
    Note.aggregate([
      {
        $match: {
          ...base,
          $or: [
            { title: { $regex: escapeRegex(q), $options: "i" } },
            { text: { $regex: escapeRegex(q), $options: "i" } },
          ],
        },
      },
      { $sort: { updatedAt: -1 } },
      { $limit: 50 },
      { $project: NOTE_SUMMARY_PROJECTION },
    ]),
  ]);

  const seen = new Set();
  const merged = [...byText, ...byPrefix].filter((n) => {
    const key = String(n._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Snippet around the first match for the results list.
  const needle = q.toLowerCase();
  const withSnippets = await Note.find({ _id: { $in: merged.map((n) => n._id) } }).select("text").lean();
  const textMap = new Map(withSnippets.map((n) => [String(n._id), n.text || ""]));

  return merged.slice(0, 60).map((n) => {
    const text = textMap.get(String(n._id));
    const at = text.toLowerCase().indexOf(needle);
    return at > 40 ? { ...n, excerpt: `…${text.slice(at - 40, at + 120)}` } : n;
  });
};

export const getTags = async () =>
  Note.aggregate([
    { $match: ALIVE },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $project: { _id: 0, tag: "$_id", count: 1 } },
  ]);

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export const listVersions = async (noteId) =>
  NoteVersion.aggregate([
    { $match: { note: new mongoose.Types.ObjectId(String(noteId)) } },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        title: 1,
        kind: 1,
        createdAt: 1,
        excerpt: { $substrCP: [{ $ifNull: ["$text", ""] }, 0, 120] },
        elementCount: { $size: { $ifNull: ["$ink.elements", []] } },
      },
    },
  ]);

export const getVersion = async (noteId, versionId) => {
  const version = await NoteVersion.findOne({ _id: versionId, note: noteId }).lean();
  if (!version) throw notFound("Version");
  return version;
};

export const restoreVersion = async (noteId, versionId) => {
  const [note, version] = await Promise.all([
    Note.findOne({ _id: noteId, ...ALIVE }),
    NoteVersion.findOne({ _id: versionId, note: noteId }).lean(),
  ]);
  if (!note) throw notFound("Note");
  if (!version) throw notFound("Version");

  // Keep the current state restorable too.
  await snapshot(note.toObject());
  await pruneVersions(note._id);

  note.title = version.title;
  note.doc = version.doc;
  note.text = version.text;
  note.ink = version.ink;
  note.lastVersionAt = new Date();
  note.markModified("doc");
  note.markModified("ink");
  await note.save();

  return note.toObject();
};

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

const purgeBatches = async (batches) => {
  if (!batches.length) return;
  const notes = await Note.find({ trashBatch: { $in: batches } }).select("_id").lean();
  await Promise.all([
    Notebook.deleteMany({ trashBatch: { $in: batches } }),
    NoteTopic.deleteMany({ trashBatch: { $in: batches } }),
    Note.deleteMany({ trashBatch: { $in: batches } }),
    NoteVersion.deleteMany({ note: { $in: notes.map((n) => n._id) } }),
  ]);
};

export const listTrash = async () => {
  // Items older than the retention window are removed for good.
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await Promise.all(
    [Notebook, NoteTopic, Note].map((m) => m.distinct("trashBatch", { trashRoot: true, deletedAt: { $lt: cutoff } })),
  );
  await purgeBatches(expired.flat().filter(Boolean));

  const [notebooks, topics, notes] = await Promise.all([
    Notebook.find({ trashRoot: true, deletedAt: { $ne: null } }).select("title icon deletedAt trashBatch").lean(),
    NoteTopic.find({ trashRoot: true, deletedAt: { $ne: null } }).select("title notebook deletedAt trashBatch").lean(),
    Note.find({ trashRoot: true, deletedAt: { $ne: null } }).select("title kind notebook topic deletedAt trashBatch").lean(),
  ]);

  const counts = await Note.aggregate([
    { $match: { trashBatch: { $in: [...notebooks, ...topics].map((i) => i.trashBatch) } } },
    { $group: { _id: "$trashBatch", notes: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [c._id, c.notes]));

  return [
    ...notebooks.map((n) => ({ type: "notebook", ...n, noteCount: countMap.get(n.trashBatch) || 0 })),
    ...topics.map((t) => ({ type: "topic", ...t, noteCount: countMap.get(t.trashBatch) || 0 })),
    ...notes.map((n) => ({ type: "note", ...n })),
  ]
    .map((item) => ({
      ...item,
      expiresAt: new Date(new Date(item.deletedAt).getTime() + TRASH_RETENTION_DAYS * 86400000),
    }))
    .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
};

export const restoreBatch = async (batch) => {
  const [rootNote, rootTopic] = await Promise.all([
    Note.findOne({ trashBatch: batch, trashRoot: true }).lean(),
    NoteTopic.findOne({ trashBatch: batch, trashRoot: true }).lean(),
  ]);

  // A note/topic whose container is itself in the trash can't come back on
  // its own — restore the container first.
  const container = rootNote || rootTopic;
  if (container) {
    if (await Notebook.exists({ _id: container.notebook, deletedAt: { $ne: null } })) {
      throw new ApiError(409, "Its notebook is in the trash — restore the notebook first");
    }
    const parentTopic = rootNote ? rootNote.topic : rootTopic.parent;
    if (parentTopic && (await NoteTopic.exists({ _id: parentTopic, deletedAt: { $ne: null } }))) {
      throw new ApiError(409, "Its parent topic is in the trash — restore that first");
    }
  }

  const unset = { $set: { deletedAt: null, trashBatch: null, trashRoot: false } };
  const results = await Promise.all(
    [Notebook, NoteTopic, Note].map((m) => m.updateMany({ trashBatch: batch }, unset)),
  );
  if (!results.some((r) => r.modifiedCount)) throw notFound("Trash item");
};

export const purgeBatch = async (batch) => purgeBatches([batch]);

export const emptyTrash = async () => {
  const batches = await Promise.all([Notebook, NoteTopic, Note].map((m) => m.distinct("trashBatch", { deletedAt: { $ne: null } })));
  await purgeBatches(batches.flat().filter(Boolean));
};
