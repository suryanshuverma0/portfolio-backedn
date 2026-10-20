import mongoose from "mongoose";
import { BackupConfig, BackupRun } from "./backups.model.js";
import { uploadToDrive, decrypt, isDriveConfigured } from "./backups.drive.js";
import { Notebook, NoteTopic, Note } from "../notes/notes.model.js";
import { docToHtml, escapeHtml } from "../notes/notes.convert.js";
import { sendAdminEmail, notifyBackupFailed, emailLayout } from "../alerts/alerts.service.js";
import logger from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Notes backups: a complete, restorable JSON snapshot (notebooks, topics,
// notes incl. handwriting and trash) sent to Google Drive and/or email on a
// schedule or on demand. Restore upserts by id — nothing is ever wiped.
// ---------------------------------------------------------------------------

const BACKUP_APP = "portfolio-notes";
const BACKUP_VERSION = 1;
const SCHEDULE_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 };
const LOCK_STALE_MS = 15 * 60 * 1000;
const EMAIL_ATTACHMENT_LIMIT = 35 * 1024 * 1024;

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const getConfig = async () => {
  let config = await BackupConfig.findOne({});
  if (!config) config = await BackupConfig.create({});
  return config;
};

export const publicConfig = (config) => {
  const c = config.toObject ? config.toObject() : config;
  return {
    schedule: c.schedule,
    keep: c.keep,
    destinations: c.destinations,
    google: { connected: Boolean(c.google?.refreshTokenEnc), email: c.google?.email, connectedAt: c.google?.connectedAt },
    lastRun: c.lastRun,
    running: Boolean(c.runningSince && Date.now() - new Date(c.runningSince) < LOCK_STALE_MS),
    driveConfigured: isDriveConfigured(),
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
    nextRunAt:
      c.schedule !== "off"
        ? new Date((c.lastRun?.at ? new Date(c.lastRun.at).getTime() : Date.now()) + SCHEDULE_MS[c.schedule])
        : null,
  };
};

export const updateConfig = async (data) => {
  const set = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v && typeof v === "object") Object.entries(v).forEach(([kk, vv]) => (set[`${k}.${kk}`] = vv));
    else set[k] = v;
  });
  await BackupConfig.findOneAndUpdate({}, { $set: set }, { upsert: true, runValidators: true });
  return publicConfig(await getConfig());
};

/* ---------- build ---------- */

export const buildBackup = async () => {
  const [notebooks, topics, notes] = await Promise.all([
    Notebook.find({}).lean(),
    NoteTopic.find({}).lean(),
    Note.find({}).lean(),
  ]);
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    counts: { notebooks: notebooks.length, topics: topics.length, notes: notes.length },
    notebooks,
    topics,
    notes,
  };
};

// Human-readable copy (becomes a Google Doc): notebooks → topics → notes.
const buildReadableHtml = (backup) => {
  const alive = (x) => !x.deletedAt;
  const topicsBy = new Map();
  backup.topics.filter(alive).forEach((t) => {
    const k = `${t.notebook}:${t.parent || ""}`;
    if (!topicsBy.has(k)) topicsBy.set(k, []);
    topicsBy.get(k).push(t);
  });
  const notesBy = new Map();
  backup.notes.filter(alive).forEach((n) => {
    const k = `${n.notebook}:${n.topic || ""}`;
    if (!notesBy.has(k)) notesBy.set(k, []);
    notesBy.get(k).push(n);
  });

  const noteHtml = (n) => {
    const meta = `<p style="color:#888;font-size:9pt">Updated ${new Date(n.updatedAt).toLocaleString("en-GB")}${n.tags?.length ? ` · ${n.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}` : ""}</p>`;
    const body =
      n.kind === "typed"
        ? docToHtml(n.doc)
        : `<p><em>Handwritten note (${n.ink?.elements?.length || 0} strokes &amp; items) — open it in the Notes app or restore the JSON backup.</em></p>`;
    return `<h4>${escapeHtml(n.title)}</h4>${meta}${body}<hr>`;
  };

  const section = (notebookId, parent, level) => {
    const key = `${notebookId}:${parent || ""}`;
    const own = (notesBy.get(key) || []).map(noteHtml).join("");
    const nested = (topicsBy.get(key) || [])
      .map((t) => `<h${Math.min(6, level)}>${escapeHtml(t.title)}</h${Math.min(6, level)}>${section(notebookId, String(t._id), level + 1)}`)
      .join("");
    return own + nested;
  };

  const body = backup.notebooks
    .filter(alive)
    .map((nb) => `<h1>${escapeHtml(nb.icon || "")} ${escapeHtml(nb.title)}</h1>${section(String(nb._id), null, 2)}`)
    .join("");

  return `<html><head><meta charset="utf-8"></head><body>
    <p style="color:#888">Notes backup · ${escapeHtml(new Date(backup.createdAt).toLocaleString("en-GB"))} · ${backup.counts.notes} notes</p>
    ${body}</body></html>`;
};

const stampOf = (date) => date.toISOString().slice(0, 16).replace(/[:T]/g, "-");

/* ---------- run ---------- */

export const runBackup = async (trigger = "manual") => {
  await getConfig(); // first run on a fresh database: create the config
  // Claim the lock atomically.
  const claimed = await BackupConfig.findOneAndUpdate(
    { $or: [{ runningSince: null }, { runningSince: { $lt: new Date(Date.now() - LOCK_STALE_MS) } }] },
    { $set: { runningSince: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) throw new ApiError(409, "A backup is already running");

  const run = await BackupRun.create({ trigger });
  const destinations = [];

  try {
    const backup = await buildBackup();
    const json = JSON.stringify(backup);
    const now = new Date();
    const stamp = stampOf(now);
    run.counts = backup.counts;
    run.sizeBytes = Buffer.byteLength(json);

    const { destinations: dest, google } = claimed;

    if (dest.drive && google?.refreshTokenEnc && isDriveConfigured()) {
      try {
        const result = await uploadToDrive({
          refreshToken: decrypt(google.refreshTokenEnc),
          folderId: google.folderId,
          keep: claimed.keep,
          stamp,
          json,
          html: dest.driveDoc ? buildReadableHtml(backup) : null,
          withDoc: dest.driveDoc,
        });
        if (result.folderId !== google.folderId) {
          await BackupConfig.updateOne({}, { $set: { "google.folderId": result.folderId } });
        }
        destinations.push({ type: "drive", ok: true, ref: result.file?.webViewLink || result.file?.id });
        if (result.doc) destinations.push({ type: "drive-doc", ok: true, ref: result.doc.webViewLink || result.doc.id });
      } catch (error) {
        destinations.push({ type: "drive", ok: false, error: error.message.slice(0, 300) });
      }
    }

    if (dest.email) {
      try {
        if (run.sizeBytes > EMAIL_ATTACHMENT_LIMIT) throw new Error("Backup is too large to email — use Google Drive");
        await sendAdminEmail({
          subject: `🗂️ Notes backup — ${now.toLocaleDateString("en-GB", { dateStyle: "medium" })}`,
          html: emailLayout({
            heading: "Your notes backup",
            intro: "The attached file is a complete backup of your notes. Keep it — you can restore it any time from Admin → Automations.",
            rows: [
              ["Notebooks", String(backup.counts.notebooks)],
              ["Topics", String(backup.counts.topics)],
              ["Notes", String(backup.counts.notes)],
              ["Size", `${Math.round(run.sizeBytes / 1024)} KB`],
            ],
          }),
          attachments: [{ filename: `notes-backup-${stamp}.json`, content: Buffer.from(json).toString("base64") }],
        });
        destinations.push({ type: "email", ok: true });
      } catch (error) {
        destinations.push({ type: "email", ok: false, error: error.message.slice(0, 300) });
      }
    }

    if (!destinations.length) {
      destinations.push({ type: "none", ok: false, error: "No backup destination is enabled or connected" });
    }

    const okCount = destinations.filter((d) => d.ok).length;
    run.status = okCount === destinations.length ? "success" : okCount ? "partial" : "failed";
  } catch (error) {
    run.status = "failed";
    destinations.push({ type: "build", ok: false, error: error.message.slice(0, 300) });
  }

  run.destinations = destinations;
  run.finishedAt = new Date();
  await run.save();

  const failures = destinations.filter((d) => !d.ok).map((d) => `${d.type}: ${d.error}`);
  await BackupConfig.updateOne(
    {},
    {
      $set: {
        runningSince: null,
        "lastRun.at": run.startedAt,
        "lastRun.status": run.status,
        "lastRun.message": failures.join(" · ") || null,
      },
    },
  );

  if (run.status !== "success" && trigger === "schedule") {
    notifyBackupFailed(failures.join("\n") || "Unknown error").catch(() => {});
  }

  return run.toObject();
};

export const listRuns = () => BackupRun.find({}).sort({ startedAt: -1 }).limit(20).lean();

/* ---------- restore ---------- */

const reviveDates = (doc) => {
  const out = { ...doc };
  ["createdAt", "updatedAt", "deletedAt", "lastVersionAt"].forEach((k) => {
    if (out[k]) out[k] = new Date(out[k]);
  });
  return out;
};

export const restoreBackup = async (backup) => {
  if (!backup || backup.app !== BACKUP_APP || !Array.isArray(backup.notes) || !Array.isArray(backup.notebooks) || !Array.isArray(backup.topics)) {
    throw new ApiError(400, "This isn't a notes backup file");
  }
  if (backup.version > BACKUP_VERSION) throw new ApiError(400, "This backup was made by a newer version");

  const upsertAll = async (Model, docs) => {
    const valid = docs.filter((d) => mongoose.isValidObjectId(d._id));
    if (!valid.length) return 0;
    const result = await Model.bulkWrite(
      valid.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: reviveDates(d), upsert: true } })),
      { ordered: false },
    );
    return (result.upsertedCount || 0) + (result.modifiedCount || 0);
  };

  const [notebooks, topics, notes] = [
    await upsertAll(Notebook, backup.notebooks),
    await upsertAll(NoteTopic, backup.topics),
    await upsertAll(Note, backup.notes),
  ];
  return { notebooks, topics, notes, backupDate: backup.createdAt };
};

/* ---------- scheduler ---------- */

let schedulerTimer = null;

const runIfDue = async () => {
  try {
    const config = await getConfig();
    if (config.schedule === "off") return;
    const last = config.lastRun?.at ? new Date(config.lastRun.at).getTime() : 0;
    // Small grace so a daily run doesn't drift later every day.
    if (Date.now() - last < SCHEDULE_MS[config.schedule] - 10 * 60 * 1000) return;
    const run = await runBackup("schedule");
    logger.info({ action: "SCHEDULED_BACKUP", status: run.status });
  } catch (error) {
    if (error.statusCode !== 409) logger.error({ action: "SCHEDULED_BACKUP_FAILED", error: error.message });
  }
};

// Checks every 15 minutes (the Render keep-alive ping keeps the process up).
export const startBackupScheduler = () => {
  if (schedulerTimer) return;
  setTimeout(runIfDue, 60 * 1000);
  schedulerTimer = setInterval(runIfDue, 15 * 60 * 1000);
  schedulerTimer.unref?.();
};
