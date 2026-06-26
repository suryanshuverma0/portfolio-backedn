import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
        "Frontend",
        "Backend",
        "Full Stack",
        "Blockchain",
        "Mobile",
        "DevOps",
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
      maxlength: 3000,
    },

    technologies: [
      {
        type: String,
        trim: true,
      },
    ],

    featured: {
      type: Boolean,
      default: false,
    },

    order: {
      type: Number,
      default: 0,
    },

    isVisible: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Service = mongoose.model(
  "Service",
  serviceSchema
);

export default Service;