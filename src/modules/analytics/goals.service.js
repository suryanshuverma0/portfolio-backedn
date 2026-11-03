import Goal from "./goals.model.js";
import { VisitorSession, VisitorEvent } from "./journey.model.js";
import { PORTFOLIO_SESSION } from "./journey.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stepFilter = (step, since) => {
  const filter = { type: step.type, at: { $gte: since } };

  if (step.match) {
    const pattern = new RegExp(escapeRegex(step.match), "i");
    filter.$or = [{ path: pattern }, { section: pattern }, { label: pattern }, { target: pattern }];
  }

  return filter;
};

const referrerHost = (session) => {
  if (session.utm?.source) return session.utm.source;
  if (!session.referrer) return "Direct";

  try {
    return new URL(session.referrer).hostname.replace(/^www\./, "");
  } catch {
    return "Referral";
  }
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const dayKey = (date, timezone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// Walks each step in order: a session reaches step N if it did step N's
// event at or after the moment it reached step N-1.
const evaluateGoal = async (goal, { since, sessionMap, timezone }) => {
  let reached = new Map([...sessionMap.keys()].map((id) => [id, sessionMap.get(id).startedAt]));
  const steps = [];

  for (const step of goal.steps) {
    const rows = await VisitorEvent.aggregate([
      { $match: { ...stepFilter(step, since), sessionId: { $in: [...reached.keys()] } } },
      { $group: { _id: "$sessionId", times: { $push: "$at" } } },
    ]);

    const next = new Map();

    rows.forEach((row) => {
      const after = reached.get(row._id);
      const time = row.times
        .map((t) => new Date(t))
        .filter((t) => t >= after)
        .sort((a, b) => a - b)[0];

      if (time) next.set(row._id, time);
    });

    steps.push({ ...step, sessions: next.size });
    reached = next;

    if (!reached.size) break;
  }

  // Steps after an empty one were never evaluated.
  while (steps.length < goal.steps.length) steps.push({ ...goal.steps[steps.length], sessions: 0 });

  const total = sessionMap.size;
  const converted = [...reached.entries()];

  const sources = new Map();
  const daily = new Map();

  converted.forEach(([sessionId, at]) => {
    const session = sessionMap.get(sessionId);
    const source = referrerHost(session);
    sources.set(source, (sources.get(source) || 0) + 1);

    const day = dayKey(at, timezone);
    daily.set(day, (daily.get(day) || 0) + 1);
  });

  return {
    _id: goal._id,
    name: goal.name,
    createdAt: goal.createdAt,
    totalSessions: total,
    conversions: converted.length,
    conversionRate: total ? Math.round((converted.length / total) * 1000) / 10 : 0,
    medianTimeToConvertMs: median(converted.map(([id, at]) => at - new Date(sessionMap.get(id).startedAt))),
    steps: steps.map((step, index) => ({
      type: step.type,
      match: step.match,
      label: step.label,
      sessions: step.sessions,
      fromStart: total ? Math.round((step.sessions / total) * 1000) / 10 : 0,
      fromPrevious:
        index === 0
          ? total
            ? Math.round((step.sessions / total) * 1000) / 10
            : 0
          : steps[index - 1].sessions
            ? Math.round((step.sessions / steps[index - 1].sessions) * 1000) / 10
            : 0,
    })),
    topSources: [...sources.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    daily: [...daily.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
  };
};

export const listGoalsWithStats = async ({ rangeDays, timezone }) => {
  const since = new Date(Date.now() - rangeDays * DAY_MS);

  const [goals, sessions] = await Promise.all([
    Goal.find({}).sort({ createdAt: 1 }).lean(),
    VisitorSession.find({ startedAt: { $gte: since }, isBot: { $ne: true }, ...PORTFOLIO_SESSION })
      .select("sessionId startedAt referrer utm")
      .lean(),
  ]);

  const sessionMap = new Map(sessions.map((s) => [s.sessionId, { ...s, startedAt: new Date(s.startedAt) }]));

  const results = [];
  for (const goal of goals) results.push(await evaluateGoal(goal, { since, sessionMap, timezone }));

  return { goals: results, totalSessions: sessionMap.size, rangeDays };
};

export const createGoal = (data) => Goal.create(data);

export const updateGoal = (id, data) => Goal.findByIdAndUpdate(id, data, { returnDocument: "after", runValidators: true }).lean();

export const deleteGoal = (id) => Goal.findByIdAndDelete(id).lean();
