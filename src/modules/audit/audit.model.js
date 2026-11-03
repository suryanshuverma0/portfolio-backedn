import mongoose from "mongoose";

// Sign-ins (successful and failed) and admin write actions, kept for a year.
const auditLogSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["login", "action"], required: true },

    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },

    // --- login ---
    method: { type: String, enum: ["password", "google", "passkey"] },
    success: { type: Boolean },
    reason: { type: String, maxlength: 200 },

    // --- action ---
    httpMethod: { type: String, maxlength: 10 },
    path: { type: String, maxlength: 300 },
    resource: { type: String, maxlength: 60 },
    resourceId: { type: String, maxlength: 100 },
    action: { type: String, maxlength: 60 },
    label: { type: String, maxlength: 200 },
    status: { type: Number },

    // --- where from ---
    ip: { type: String, maxlength: 64 },
    location: {
      country: { type: String, maxlength: 2 },
      city: { type: String, maxlength: 100 },
      region: { type: String, maxlength: 100 },
    },
    network: { type: String, maxlength: 150 },
    device: { type: String, maxlength: 20 },
    browser: { type: String, maxlength: 80 },
    os: { type: String, maxlength: 80 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ kind: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: "audit_ttl" });

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
