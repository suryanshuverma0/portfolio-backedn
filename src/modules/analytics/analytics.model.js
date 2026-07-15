import mongoose from "mongoose";

const pageViewSchema = new mongoose.Schema(
  {
    path: {
      type: String,
      required: [true, "Path is required"],
      trim: true,
      maxlength: 300,
    },

    referrer: {
      type: String,
      trim: true,
      maxlength: 500,
    },

    visitorId: {
      type: String,
      required: [true, "Visitor id is required"],
      trim: true,
      maxlength: 100,
      index: true,
    },
  },
  { timestamps: true },
);

pageViewSchema.index({ createdAt: 1 });
pageViewSchema.index({ path: 1 });

const PageView = mongoose.model("PageView", pageViewSchema);
export default PageView;
