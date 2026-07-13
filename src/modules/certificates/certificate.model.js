import mongoose from "mongoose";
import imageSchema from "../../shared/schemas/image.schema.js";

const certificateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: [true, "Certificate title is required"],
      trim: true,
      maxlength: 250,
    },

    issuer: {
      type: String,
      required: [true, "Issuer is required"],
      trim: true,
      maxlength: 150,
    },

    year: {
      type: Number,
      required: true,
    },

    image: {
      type: imageSchema,
      required: true,
    },

    verifyUrl: {
      type: String,
      trim: true,
      default: null,
    },

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
  },
);

const Certificate = mongoose.model("Certificate", certificateSchema);

export default Certificate;
