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

    // All four derived server-side from the request (User-Agent + IP) in
    // trackController — never trusted from client input.
    device: {
      type: String,
      enum: ["desktop", "mobile", "tablet"],
      default: "desktop",
    },

    browser: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    os: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    country: {
      type: String,
      trim: true,
      maxlength: 2,
    },
  },
  { timestamps: true },
);

pageViewSchema.index({ createdAt: 1 });
pageViewSchema.index({ path: 1 });

const PageView = mongoose.model("PageView", pageViewSchema);
export default PageView;
