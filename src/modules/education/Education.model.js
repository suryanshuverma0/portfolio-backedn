import mongoose from "mongoose";

const educationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    degree: {
      type: String,
      required: [true, "Degree is required"],
      trim: true,
      maxlength: 200,
    },

    institution: {
      type: String,
      required: [true, "Institution is required"],
      trim: true,
      maxlength: 200,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    startYear: {
      type: Number,
      required: true,
    },

    endYear: {
      type: Number,
      default: null,
    },

    current: {
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
  },
);

const Education = mongoose.model("Education", educationSchema);

export default Education;
