import mongoose from "mongoose";

const statSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    label: {
      type: String,
      required: [true, "Label is required"],
      trim: true,
      maxlength: 100,
    },

    value: {
      type: String,
      required: [true, "Value is required"],
      trim: true,
      maxlength: 50,
    },

    section: {
      type: String,
      enum: ["about", "hero", "projects"],
      default: "about",
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

const Stat = mongoose.model("Stat", statSchema);

export default Stat;