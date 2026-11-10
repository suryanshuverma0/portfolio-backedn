import { Note, Notebook, NoteVersion } from "../notes/notes.model.js";
import { plannerStats } from "../planner/planner.routes.js";
import { Bookmark } from "../bookmarks/bookmarks.routes.js";

/* ---------------------------------------------------------------------------
   LIFE OVERVIEW — the numbers behind the life dashboard. Each area of the
   personal side contributes a block; the planner, habits, bookmarks and
   vault add theirs as they land.
--------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

const daysBack = (n) => {
  const out = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKey(today.getTime() - i * DAY));
  return out;
};

const perDay = (Model, match, field, since) =>
  Model.aggregate([
    { $match: { ...match, [field]: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: `$${field}` } }, n: { $sum: 1 } } },
  ]).then((rows) => new Map(rows.map((r) => [r._id, r.n])));

const notesBlock = async (days) => {
  const since = new Date(Date.now() - days * DAY);
  const live = { deletedAt: null };
  const [total, typed, pinned, notebooks, tags, recent, created, edited, words, byNotebook] = await Promise.all([
    Note.countDocuments(live),
    Note.countDocuments({ ...live, kind: "typed" }),
    Note.countDocuments({ ...live, isPinned: true }),
    Notebook.countDocuments(live),
    Note.aggregate([{ $match: live }, { $unwind: "$tags" }, { $group: { _id: "$tags", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
    Note.find(live).sort({ updatedAt: -1 }).limit(6).select("title kind updatedAt tags").lean(),
    perDay(Note, live, "createdAt", since),
    perDay(NoteVersion, {}, "createdAt", since),
    Note.aggregate([
      { $match: { ...live, kind: "typed" } },
      { $project: { w: { $size: { $filter: { input: { $split: [{ $ifNull: ["$text", ""] }, " "] }, cond: { $ne: ["$$this", ""] } } } } } },
      { $group: { _id: null, w: { $sum: "$w" } } },
    ]),
    Note.aggregate([
      { $match: live },
      { $group: { _id: "$notebook", n: { $sum: 1 } } },
      { $lookup: { from: "notebooks", localField: "_id", foreignField: "_id", as: "nb" } },
      { $unwind: "$nb" },
      { $match: { "nb.deletedAt": null } },
      { $project: { _id: 0, title: "$nb.title", icon: "$nb.icon", color: "$nb.color", n: 1 } },
      { $sort: { n: -1 } },
      { $limit: 8 },
    ]),
  ]);

  return {
    total,
    typed,
    handwritten: total - typed,
    pinned,
    notebooks,
    words: words[0]?.w || 0,
    tags: tags.map((t) => ({ tag: t._id, count: t.n })),
    byNotebook,
    recent: recent.map((n) => ({ id: String(n._id), title: n.title || "Untitled", kind: n.kind, updatedAt: n.updatedAt, tags: n.tags })),
    activity: daysBack(days).map((date) => ({ date, created: created.get(date) || 0, edits: edited.get(date) || 0 })),
  };
};

const bookmarksBlock = async (days) => {
  const since = new Date(Date.now() - days * DAY);
  const [total, unread, added, categories, opened] = await Promise.all([
    Bookmark.countDocuments({}),
    Bookmark.countDocuments({ status: "unread" }),
    Bookmark.countDocuments({ createdAt: { $gte: since } }),
    Bookmark.aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    Bookmark.find({ openCount: { $gt: 0 } }).sort({ openCount: -1 }).limit(5).select("title url icon openCount").lean(),
  ]);
  return { total, unread, added, categories: categories.map((c) => ({ label: c._id || "Uncategorised", value: c.n })), mostOpened: opened.map((b) => ({ id: String(b._id), title: b.title, url: b.url, icon: b.icon, opens: b.openCount })) };
};

export const lifeOverview = async (query = {}) => {
  const days = [7, 30, 90, 365].includes(Number(query.days)) ? Number(query.days) : 30;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(query.today || "") ? query.today : new Date().toISOString().slice(0, 10);
  const [notes, planner, bookmarks] = await Promise.all([notesBlock(days), plannerStats({ today, days }), bookmarksBlock(days)]);
  return { days, notes, planner, bookmarks, generatedAt: new Date() };
};
