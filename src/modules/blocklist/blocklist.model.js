import mongoose from "mongoose";

// A blocked single IP ("1.2.3.4") or range in CIDR form ("1.2.3.0/24").
const blockedIpSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, unique: true, trim: true, maxlength: 64 },
    reason: { type: String, trim: true, maxlength: 200, default: "" },
    hits: { type: Number, default: 0 },
    lastHitAt: { type: Date, default: null },
    // Set for temporary (auto) bans; Mongo removes the entry once it passes.
    expiresAt: { type: Date, default: null },
    auto: { type: Boolean, default: false },
  },
  { timestamps: true },
);

blockedIpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: "date" } } });

const BlockedIp = mongoose.model("BlockedIp", blockedIpSchema);
export default BlockedIp;
