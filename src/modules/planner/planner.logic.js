/* ---------------------------------------------------------------------------
   PLANNER LOGIC — pure date / schedule / streak maths, shared by the routes
   and the life overview. Dates are local calendar days as "YYYY-MM-DD"
   strings sent by the browser, so "today" is the owner's today, not the
   server's.
--------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

export const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const fmtDay = (date) => date.toISOString().slice(0, 10);
export const addDays = (s, n) => fmtDay(new Date(parseDay(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((parseDay(a) - parseDay(b)) / DAY);
export const weekday = (s) => parseDay(s).getUTCDay(); // 0 = Sunday

// ISO week key, e.g. 2026-W46 (weeks start Monday).
export const weekKey = (s) => {
  const d = parseDay(s);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};
export const monthKey = (s) => s.slice(0, 7);
export const yearKey = (s) => s.slice(0, 4);

export const periodKeyFor = (scope, day) =>
  scope === "day" ? day : scope === "week" ? weekKey(day) : scope === "month" ? monthKey(day) : scope === "year" ? yearKey(day) : "someday";

export const range = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/* ---------- habits ---------- */

const target = (habit) => (habit.kind === "count" ? Math.max(1, habit.target || 1) : 1);
export const isHit = (habit, count = 0) => count >= target(habit);

// Is this habit expected on this day? (quota habits: every day counts)
export const isScheduledDay = (habit, day) => {
  if (day < habit.startDate) return false;
  const s = habit.schedule || { type: "daily" };
  if (s.type === "weekdays") return (s.days || []).includes(weekday(day));
  if (s.type === "interval") return diffDays(day, habit.startDate) % Math.max(1, s.every || 1) === 0;
  return true; // daily, weekly quota, monthly quota
};

const quotaPeriod = (habit) => (habit.schedule?.type === "weekly" ? weekKey : habit.schedule?.type === "monthly" ? monthKey : null);

// Per-habit stats over [from, to] given logs as Map(date -> count).
export const habitStats = (habit, logs, from, to) => {
  const days = range(from < habit.startDate ? habit.startDate : from, to);
  const periodOf = quotaPeriod(habit);

  if (periodOf) {
    // Quota habits: success = hit `times` days inside a week/month.
    const quota = Math.max(1, habit.schedule.times || 1);
    const byPeriod = new Map();
    for (const d of days) {
      const k = periodOf(d);
      byPeriod.set(k, (byPeriod.get(k) || 0) + (isHit(habit, logs.get(d)) ? 1 : 0));
    }
    const keys = [...byPeriod.keys()];
    const current = keys[keys.length - 1];
    const finished = keys.filter((k) => k !== current);
    const hitPeriods = finished.filter((k) => byPeriod.get(k) >= quota).length + (byPeriod.get(current) >= quota ? 1 : 0);
    const counted = finished.length + (byPeriod.get(current) >= quota ? 1 : 0);
    // streak in periods, walking back over all history
    let streak = 0;
    let best = 0;
    let run = 0;
    const allDays = range(habit.startDate, to);
    const all = new Map();
    for (const d of allDays) all.set(periodOf(d), (all.get(periodOf(d)) || 0) + (isHit(habit, logs.get(d)) ? 1 : 0));
    const allKeys = [...all.keys()];
    allKeys.forEach((k, i) => {
      const hit = all.get(k) >= quota;
      const isCurrent = i === allKeys.length - 1;
      if (hit) run += 1;
      else if (!isCurrent) run = 0;
      best = Math.max(best, run);
    });
    streak = run;
    return {
      unit: habit.schedule.type === "weekly" ? "week" : "month",
      scheduled: counted,
      done: hitPeriods,
      rate: counted ? hitPeriods / counted : null,
      streak,
      best,
      progress: { period: current, count: byPeriod.get(current) || 0, quota },
      daysDone: days.filter((d) => isHit(habit, logs.get(d))).length,
    };
  }

  const due = days.filter((d) => isScheduledDay(habit, d));
  const doneDays = due.filter((d) => isHit(habit, logs.get(d)));
  // Today not done yet doesn't count against you.
  const counted = due.filter((d) => d !== to || isHit(habit, logs.get(d)));

  let streak = 0;
  let best = 0;
  let run = 0;
  const history = range(habit.startDate, to).filter((d) => isScheduledDay(habit, d));
  history.forEach((d) => {
    if (isHit(habit, logs.get(d))) run += 1;
    else if (d !== to) run = 0;
    best = Math.max(best, run);
  });
  streak = run;

  return {
    unit: "day",
    scheduled: counted.length,
    done: doneDays.length,
    rate: counted.length ? doneDays.length / counted.length : null,
    streak,
    best,
    daysDone: doneDays.length,
  };
};
