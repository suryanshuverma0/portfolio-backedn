import mongoose from "mongoose";

// A blocked single IP ("1.2.3.4") or range in CIDR form ("1.2.3.0/24").
const blockedIpSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, unique: true, trim: true, maxlength: 64 },
    reason: { type: String, trim: true, maxlength: 200, default: "" },
    hits: { type: Number, default: 0 },
    lastHitAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const BlockedIp = mongoose.model("BlockedIp", blockedIpSchema);
export default BlockedIp;
