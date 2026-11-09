import mongoose from "mongoose";

// Single settings document for automatic defences.
const securitySettingsSchema = new mongoose.Schema(
  {
    autoBan: {
      enabled: { type: Boolean, default: true },
      // Offences from one IP within `windowMinutes` before it's banned.
      loginFailures: { type: Number, min: 3, max: 100, default: 8 },
      spamHits: { type: Number, min: 1, max: 50, default: 3 },
      rateLimitHits: { type: Number, min: 5, max: 500, default: 30 },
      windowMinutes: { type: Number, min: 5, max: 1440, default: 60 },
      // First ban length; repeat offenders get 7× longer each time (max 30 days).
      banHours: { type: Number, min: 1, max: 720, default: 24 },
      notify: { type: Boolean, default: true },
    },
    spamTrap: {
      enabled: { type: Boolean, default: true },
      // Forms sent faster than this after opening are treated as bots.
      minSeconds: { type: Number, min: 1, max: 30, default: 3 },
    },
  },
  { timestamps: true },
);

const SecuritySettings = mongoose.model("SecuritySettings", securitySettingsSchema);
export default SecuritySettings;
