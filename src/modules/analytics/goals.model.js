import mongoose from "mongoose";

// A goal is an ordered list of steps; one step = a simple conversion goal,
// several = a funnel. Each step matches tracker events by type and,
// optionally, text contained in the event's path / section / label / target.
export const GOAL_STEP_TYPES = [
  "page_view",
  "section_view",
  "click",
  "outbound_click",
  "download",
  "contact_link",
  "form_submit",
];

const stepSchema = new mongoose.Schema(
  {
    type: { type: String, enum: GOAL_STEP_TYPES, required: true },
    match: { type: String, trim: true, maxlength: 200, default: "" },
    label: { type: String, trim: true, maxlength: 80, default: "" },
  },
  { _id: false },
);

const goalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    steps: {
      type: [stepSchema],
      validate: [(steps) => steps.length >= 1 && steps.length <= 8, "A goal needs 1–8 steps"],
    },
  },
  { timestamps: true },
);

const Goal = mongoose.model("Goal", goalSchema);
export default Goal;
