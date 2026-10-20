import mongoose from "mongoose";

export const SCHEDULES = ["off", "daily", "weekly"];

const backupConfigSchema = new mongoose.Schema(
  {
    schedule: { type: String, enum: SCHEDULES, default: "weekly" },
    keep: { type: Number, min: 1, max: 100, default: 14 },
    destinations: {
      email: { type: Boolean, default: true },
      drive: { type: Boolean, default: true },
      driveDoc: { type: Boolean, default: true }, // readable Google Doc copy
    },
    google: {
      refreshTokenEnc: { type: String, default: null },
      email: { type: String, default: null },
      folderId: { type: String, default: null },
      connectedAt: { type: Date, default: null },
    },
    lastRun: {
      at: { type: Date, default: null },
      status: { type: String, default: null },
      message: { type: String, default: null },
    },
    // Simple lock so two schedulers/requests never back up concurrently.
    runningSince: { type: Date, default: null },
  },
  { timestamps: true },
);

const backupRunSchema = new mongoose.Schema(
  {
    trigger: { type: String, enum: ["manual", "schedule"], required: true },
    status: { type: String, enum: ["running", "success", "partial", "failed"], default: "running" },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    counts: { notebooks: Number, topics: Number, notes: Number },
    sizeBytes: { type: Number, default: 0 },
    destinations: [
      {
        _id: false,
        type: { type: String },
        ok: Boolean,
        ref: String,
        error: String,
      },
    ],
  },
  { versionKey: false },
);

backupRunSchema.index({ startedAt: -1 });
backupRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: "backup_run_ttl" });

export const BackupConfig = mongoose.model("BackupConfig", backupConfigSchema);
export const BackupRun = mongoose.model("BackupRun", backupRunSchema);
