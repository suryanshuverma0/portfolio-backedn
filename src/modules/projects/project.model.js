import mongoose from "mongoose";
import imageSchema from "../../shared/schemas/image.schema.js";

const evaluationSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 150 },
    value: { type: String, required: true, trim: true, maxlength: 150 },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    slug: {
      type: String,
      required: [true, "Slug is required"],
      trim: true,
      lowercase: true,
      unique: true,
      match: [
        /^[a-z0-9-]+$/,
        "Slug can only contain lowercase letters, numbers and hyphens",
      ],
    },

    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
        "Frontend",
        "Backend",
        "Full Stack",
        "Blockchain",
        "Artificial Intelligence",
        "Mobile",
        "DevOps",
        "Software Engineering",
        "UI/UX",
        "Other",
      ],
      trim: true,
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: 5000,
    },

    thumbnail: {
      type: imageSchema,
      required: true,
    },

    gallery: {
      type: [imageSchema],
      default: [],
    },

    architectureImages: {
      type: [imageSchema],
      default: [],
    },

    features: [{ type: String, trim: true }],
    technologies: [{ type: String, trim: true }],
    challenges: [{ type: String, trim: true }],
    learnings: [{ type: String, trim: true }],

    evaluation: {
      type: [evaluationSchema],
      default: [],
    },

    githubUrl: { type: String, trim: true },
    liveUrl: { type: String, trim: true },

    featured: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Project = mongoose.model("Project", projectSchema);
export default Project;
