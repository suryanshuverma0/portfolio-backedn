import mongoose from "mongoose";

// One document per signed-in device. The refresh token carries the session
// id (sid) and a one-time id (jti); only a hash of the current jti is kept.
// Every refresh rotates the jti — presenting an old one means the token was
// copied, and the whole session is revoked.
const authSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    method: { type: String, enum: ["password", "google", "passkey", "qr", "legacy"], default: "password" },

    tokenHash: { type: String, required: true },
    // The token rotated away most recently — accepted briefly so two tabs
    // refreshing at the same moment don't trip reuse detection.
    prevTokenHash: { type: String, default: null },
    rotatedAt: { type: Date, default: null },

    ip: { type: String, maxlength: 64 },
    lastIp: { type: String, maxlength: 64 },
    location: {
      country: { type: String, maxlength: 2 },
      city: { type: String, maxlength: 100 },
      region: { type: String, maxlength: 100 },
    },
    network: { type: String, maxlength: 150 },
    userAgent: { type: String, maxlength: 500 },
    device: { type: String, maxlength: 20 },
    browser: { type: String, maxlength: 80 },
    os: { type: String, maxlength: 80 },

    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, maxlength: 60, default: null },
  },
  { timestamps: true },
);

authSessionSchema.index({ userId: 1, revokedAt: 1, lastUsedAt: -1 });
// Expired sessions are cleaned up a month after they lapse (kept briefly
// so "recently signed out" history still shows them).
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, name: "session_ttl" });

const AuthSession = mongoose.model("AuthSession", authSessionSchema);
export default AuthSession;
