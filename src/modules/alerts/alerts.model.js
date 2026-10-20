import mongoose from "mongoose";

// Single settings document for admin notifications.
const alertSettingsSchema = new mongoose.Schema(
  {
    longVisit: {
      enabled: { type: Boolean, default: true },
      minutes: { type: Number, min: 1, max: 120, default: 3 },
      includeCard: { type: Boolean, default: true },
    },
    email: {
      enabled: { type: Boolean, default: true },
      to: { type: String, trim: true, maxlength: 150, default: "" },
    },
    // Executive report emailed on Mondays (08:00 in this timezone).
    weeklyReport: {
      enabled: { type: Boolean, default: false },
      timezone: { type: String, default: "UTC" },
      lastSentAt: { type: Date, default: null },
    },
    // Browsers (tracker visitor ids) that belong to the admin — their
    // visits never trigger alerts. Registered automatically when the admin
    // panel is opened on that device.
    ignoreOwner: { type: Boolean, default: true },
    ownerVisitorIds: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const ALERT_TYPES = ["long_visit", "backup_failed", "test"];

const alertSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ALERT_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, maxlength: 1000, default: "" },
    link: { type: String, maxlength: 300 },
    sessionId: { type: String, maxlength: 100 },
    meta: { type: mongoose.Schema.Types.Mixed },
    read: { type: Boolean, default: false, index: true },
    emailedAt: { type: Date, default: null },
    emailError: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);

alertSchema.index({ createdAt: -1 });
// Notifications are transient — keep six months.
alertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60, name: "alert_ttl" });

export const AlertSettings = mongoose.model("AlertSettings", alertSettingsSchema);
export const Alert = mongoose.model("Alert", alertSchema);
