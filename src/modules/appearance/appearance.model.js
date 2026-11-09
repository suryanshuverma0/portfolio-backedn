import mongoose from "mongoose";

// Single document: how the public site looks (colours, fonts, shape,
// effects, and the order/visibility of homepage sections). The config is
// validated by appearance.validation.js on every write; the frontend
// normalizes it again on read, so older shapes keep working.
const historyEntrySchema = new mongoose.Schema(
  {
    config: { type: mongoose.Schema.Types.Mixed, required: true },
    savedAt: { type: Date, default: Date.now },
    savedBy: { type: String, default: "" },
  },
  { _id: false },
);

const appearanceSchema = new mongoose.Schema(
  {
    config: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: String, default: "" },
    // Previous versions, newest first — lets the admin roll back a save.
    history: { type: [historyEntrySchema], default: [] },
  },
  { timestamps: true, minimize: false },
);

const Appearance = mongoose.model("Appearance", appearanceSchema);
export default Appearance;
