import mongoose from "mongoose";

// A resume is a set of choices over the portfolio's own content: which
// template, which items (by id) in which order, styling and per-item text
// overrides. Content is resolved live, so editing a project updates every
// resume that includes it. `config` is validated by resume.validation.js.
const resumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]{2,60}$/, "Use 2–60 lowercase letters, numbers or hyphens"],
    },
    isPublic: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    views: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false },
);

const Resume = mongoose.model("Resume", resumeSchema);
export default Resume;
