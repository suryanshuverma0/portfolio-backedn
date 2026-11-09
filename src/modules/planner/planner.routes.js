import express from "express";
import mongoose from "mongoose";
import { z } from "zod";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import requireLifeUnlock from "../life/requireLifeUnlock.middleware.js";
import { addDays, diffDays, habitStats, range, weekKey, monthKey, yearKey } from "./planner.logic.js";

/* ---------------------------------------------------------------------------
   PLANNER — tasks for a day, week, month, year (or someday), habits with
   their own schedules and daily check-ins, and the stats behind the
   planner's insights and the life dashboard. Behind the life lock.
--------------------------------------------------------------------------- */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^(\d{4}-\d{2}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}|\d{4}|someday)$/;

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    notes: { type: String, default: "", maxlength: 5000 },
    scope: { type: String, enum: ["day", "week", "month", "year", "someday"], default: "day", index: true },
    period: { type: String, required: true, index: true }, // 2026-11-10 | 2026-W46 | 2026-11 | 2026 | someday
    time: { type: String, default: "" }, // "HH:MM"
    priority: { type: Number, min: 0, max: 3, default: 0 },
    area: { type: String, default: "", maxlength: 40 },
    subtasks: { type: [new mongoose.Schema({ title: { type: String, maxlength: 200 }, done: Boolean }, { _id: false })], default: [] },
    done: { type: Boolean, default: false, index: true },
    doneDate: { type: String, default: null, index: true }, // local day it was ticked
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const habitSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    emoji: { type: String, default: "✅", maxlength: 8 },
    color: { type: String, default: "#2a78d6", maxlength: 9 },
    kind: { type: String, enum: ["check", "count"], default: "check" },
    target: { type: Number, default: 1, min: 1, max: 1000 },
    unit: { type: String, default: "", maxlength: 20 },
    schedule: {
      type: { type: String, enum: ["daily", "weekdays", "weekly", "monthly", "interval"], default: "daily" },
      days: { type: [Number], default: [] }, // weekdays: 0..6 (Sun..Sat)
      times: { type: Number, default: 1, min: 1, max: 31 }, // weekly / monthly quota
      every: { type: Number, default: 2, min: 1, max: 365 }, // interval: every N days
    },
    time: { type: String, default: "" }, // preferred time of day
    area: { type: String, default: "", maxlength: 40 },
    why: { type: String, default: "", maxlength: 300 },
    startDate: { type: String, required: true },
    archived: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const habitLogSchema = new mongoose.Schema(
  {
    habit: { type: mongoose.Schema.Types.ObjectId, ref: "Habit", required: true },
    date: { type: String, required: true },
    count: { type: Number, default: 1, min: 0, max: 1000 },
    note: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true },
);
habitLogSchema.index({ habit: 1, date: 1 }, { unique: true });
habitLogSchema.index({ date: 1 });

export const Task = mongoose.models.PlannerTask || mongoose.model("PlannerTask", taskSchema);
export const Habit = mongoose.models.Habit || mongoose.model("Habit", habitSchema);
export const HabitLog = mongoose.models.HabitLog || mongoose.model("HabitLog", habitLogSchema);

/* ---------- validation ---------- */

const day = z.string().regex(DAY_RE);
const time = z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(5000).optional(),
  scope: z.enum(["day", "week", "month", "year", "someday"]),
  period: z.string().regex(PERIOD_RE),
  time: time.optional(),
  priority: z.number().int().min(0).max(3).optional(),
  area: z.string().trim().max(40).optional(),
  subtasks: z.array(z.object({ title: z.string().trim().max(200), done: z.boolean() })).max(50).optional(),
  done: z.boolean().optional(),
  doneDate: z.union([z.null(), day]).optional(),
  order: z.number().int().min(0).max(100000).optional(),
});

const habitInput = z.object({
  name: z.string().trim().min(1).max(80),
  emoji: z.string().max(8).optional(),
  color: color.optional(),
  kind: z.enum(["check", "count"]).optional(),
  target: z.number().int().min(1).max(1000).optional(),
  unit: z.string().trim().max(20).optional(),
  schedule: z
    .object({
      type: z.enum(["daily", "weekdays", "weekly", "monthly", "interval"]),
      days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      times: z.number().int().min(1).max(31).optional(),
      every: z.number().int().min(1).max(365).optional(),
    })
    .optional(),
  time: time.optional(),
  area: z.string().trim().max(40).optional(),
  why: z.string().trim().max(300).optional(),
  startDate: day,
  archived: z.boolean().optional(),
  order: z.number().int().min(0).max(100000).optional(),
});

/* ---------- helpers ---------- */

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const id = (v) => {
  if (!/^[a-f\d]{24}$/i.test(String(v))) throw httpError("Invalid id", 400);
  return v;
};
const send = (fn) => async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await fn(req, res) });
  } catch (error) {
    next(error);
  }
};
const todayOf = (req) => (DAY_RE.test(req.query.today || "") ? req.query.today : new Date().toISOString().slice(0, 10));

/* ---------- stats (used by insights and the life overview) ---------- */

export const plannerStats = async ({ today, days = 30 }) => {
  const from = addDays(today, -(days - 1));
  const span = range(from, today);
  const [habits, logs, doneTasks, openTasks, createdTasks] = await Promise.all([
    Habit.find({ archived: false }).sort({ order: 1, createdAt: 1 }).lean(),
    HabitLog.find({ date: { $lte: today } }).select("habit date count").lean(),
    Task.find({ done: true, doneDate: { $gte: from, $lte: today } }).select("scope area priority doneDate period").lean(),
    Task.find({ done: false }).select("scope period priority area").lean(),
    Task.countDocuments({ createdAt: { $gte: new Date(`${from}T00:00:00Z`) } }),
  ]);

  const logsByHabit = new Map();
  for (const l of logs) {
    const key = String(l.habit);
    if (!logsByHabit.has(key)) logsByHabit.set(key, new Map());
    logsByHabit.get(key).set(l.date, l.count);
  }

  const habitRows = habits.map((h) => {
    const map = logsByHabit.get(String(h._id)) || new Map();
    return { id: String(h._id), name: h.name, emoji: h.emoji, color: h.color, schedule: h.schedule, ...habitStats(h, map, from, today) };
  });

  // Daily: tasks ticked + share of that day's scheduled habits hit.
  const tasksByDay = new Map();
  doneTasks.forEach((t) => tasksByDay.set(t.doneDate, (tasksByDay.get(t.doneDate) || 0) + 1));
  const daily = span.map((d) => {
    let due = 0;
    let hit = 0;
    for (const h of habits) {
      if (d < h.startDate) continue;
      const type = h.schedule?.type;
      const map = logsByHabit.get(String(h._id));
      const count = map?.get(d) || 0;
      const done = count >= (h.kind === "count" ? h.target : 1);
      if (type === "weekly" || type === "monthly") {
        if (done) hit += 1; // quota habits only add when done
        continue;
      }
      const s = h.schedule || {};
      const scheduled = type === "weekdays" ? (s.days || []).includes(new Date(`${d}T00:00:00Z`).getUTCDay()) : type === "interval" ? diffDays(d, h.startDate) % Math.max(1, s.every || 1) === 0 : true;
      if (scheduled) {
        due += 1;
        if (done) hit += 1;
      }
    }
    return { date: d, tasks: tasksByDay.get(d) || 0, habitsHit: hit, habitsDue: due, habitRate: due ? Math.min(1, hit / due) : null };
  });

  const overdue = openTasks.filter((t) => (t.scope === "day" && t.period < today) || (t.scope === "week" && t.period < weekKey(today)) || (t.scope === "month" && t.period < monthKey(today)) || (t.scope === "year" && t.period < yearKey(today))).length;
  const dueToday = openTasks.filter((t) => t.scope === "day" && t.period === today).length;
  const doneToday = tasksByDay.get(today) || 0;
  const rated = habitRows.filter((h) => h.rate !== null);
  const byArea = {};
  doneTasks.forEach((t) => {
    const a = t.area || "General";
    byArea[a] = (byArea[a] || 0) + 1;
  });
  const byScope = { day: 0, week: 0, month: 0, year: 0, someday: 0 };
  doneTasks.forEach((t) => (byScope[t.scope] += 1));

  return {
    days,
    from,
    today,
    tasks: { done: doneTasks.length, open: openTasks.length, overdue, dueToday, doneToday, created: createdTasks, byArea: Object.entries(byArea).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), byScope },
    habits: {
      count: habits.length,
      avgRate: rated.length ? rated.reduce((s, h) => s + h.rate, 0) / rated.length : null,
      bestStreak: Math.max(0, ...habitRows.map((h) => h.best)),
      currentStreaks: habitRows.reduce((s, h) => s + (h.streak > 0 ? 1 : 0), 0),
      rows: habitRows,
    },
    daily,
  };
};

/* ---------- routes ---------- */

const router = express.Router();
router.use(protectAdmin, requireLifeUnlock);

// Tasks: by period keys (?periods=a,b,c), or overdue (?overdue=1&today=)
router.get(
  "/tasks",
  send(async (req) => {
    const filter = {};
    if (req.query.periods) {
      const periods = String(req.query.periods).split(",").filter((p) => PERIOD_RE.test(p)).slice(0, 400);
      filter.period = { $in: periods };
    }
    if (req.query.from && req.query.to && DAY_RE.test(req.query.from) && DAY_RE.test(req.query.to)) {
      filter.scope = "day";
      filter.period = { $gte: req.query.from, $lte: req.query.to };
    }
    const tasks = await Task.find(filter).sort({ done: 1, order: 1, priority: -1, createdAt: 1 }).limit(2000).lean();
    let overdue = [];
    if (req.query.overdue) {
      const today = todayOf(req);
      overdue = await Task.find({
        done: false,
        $or: [
          { scope: "day", period: { $lt: today } },
          { scope: "week", period: { $lt: weekKey(today) } },
          { scope: "month", period: { $lt: monthKey(today) } },
          { scope: "year", period: { $lt: yearKey(today) } },
        ],
      })
        .sort({ period: 1 })
        .limit(200)
        .lean();
    }
    return { tasks, overdue };
  }),
);

router.get(
  "/tasks/all",
  send(() => Task.find({}).sort({ period: 1, order: 1 }).limit(10000).lean()),
);

router.post("/tasks", validate(taskInput), send(async (req) => (await Task.create({ order: await Task.countDocuments({ period: req.validatedData.period }), ...req.validatedData })).toObject()));

router.patch(
  "/tasks/:id",
  validate(taskInput.partial()),
  send(async (req) => {
    const patch = { ...req.validatedData };
    if (patch.done === false) patch.doneDate = null;
    const doc = await Task.findByIdAndUpdate(id(req.params.id), { $set: patch }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) throw httpError("Task not found", 404);
    return doc;
  }),
);

router.post(
  "/tasks/reorder",
  validate(z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(500) })),
  send(async (req) => {
    await Promise.all(req.validatedData.ids.map((tid, order) => Task.updateOne({ _id: tid }, { $set: { order } })));
    return true;
  }),
);

router.delete(
  "/tasks/:id",
  send(async (req) => {
    await Task.deleteOne({ _id: id(req.params.id) });
    return true;
  }),
);

// Habits
router.get("/habits", send(() => Habit.find({}).sort({ archived: 1, order: 1, createdAt: 1 }).lean()));
router.post("/habits", validate(habitInput), send(async (req) => (await Habit.create({ order: await Habit.countDocuments({}), ...req.validatedData })).toObject()));
router.patch(
  "/habits/:id",
  validate(habitInput.partial()),
  send(async (req) => {
    const doc = await Habit.findByIdAndUpdate(id(req.params.id), { $set: req.validatedData }, { returnDocument: "after", runValidators: true }).lean();
    if (!doc) throw httpError("Habit not found", 404);
    return doc;
  }),
);
router.post(
  "/habits/reorder",
  validate(z.object({ ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(200) })),
  send(async (req) => {
    await Promise.all(req.validatedData.ids.map((hid, order) => Habit.updateOne({ _id: hid }, { $set: { order } })));
    return true;
  }),
);
router.delete(
  "/habits/:id",
  send(async (req) => {
    await Habit.deleteOne({ _id: id(req.params.id) });
    await HabitLog.deleteMany({ habit: req.params.id });
    return true;
  }),
);

// Check-ins
router.get(
  "/logs",
  send(async (req) => {
    const { from, to } = req.query;
    if (!DAY_RE.test(from || "") || !DAY_RE.test(to || "") || diffDays(to, from) > 400) throw httpError("Give from/to days (max 400 days)", 400);
    return HabitLog.find({ date: { $gte: from, $lte: to } }).select("habit date count note").lean();
  }),
);

router.put(
  "/logs",
  validate(z.object({ habit: z.string().regex(/^[a-f\d]{24}$/i), date: day, count: z.number().int().min(0).max(1000), note: z.string().max(300).optional() })),
  send(async (req) => {
    const { habit, date, count, note } = req.validatedData;
    if (!(await Habit.exists({ _id: habit }))) throw httpError("Habit not found", 404);
    if (count === 0 && !note) {
      await HabitLog.deleteOne({ habit, date });
      return { habit, date, count: 0 };
    }
    return HabitLog.findOneAndUpdate({ habit, date }, { $set: { count, ...(note !== undefined ? { note } : {}) } }, { upsert: true, returnDocument: "after" }).lean();
  }),
);

router.get(
  "/stats",
  send((req) => plannerStats({ today: todayOf(req), days: [7, 14, 30, 90, 180, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30 })),
);

// Everything, for export / backup.
router.get(
  "/export",
  send(async () => ({
    exportedAt: new Date(),
    tasks: await Task.find({}).sort({ period: 1, order: 1 }).lean(),
    habits: await Habit.find({}).lean(),
    logs: await HabitLog.find({}).sort({ date: 1 }).lean(),
  })),
);

export default router;
