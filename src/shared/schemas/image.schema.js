import mongoose from "mongoose";

const imageSchema = new mongoose.Schema(
  {
    // Empty for external images (live-site screenshots, README images,
    // GitHub social cards) — only Cloudinary uploads carry an id.
    publicId: {
      type: String,
      default: "",
    },

    url: {
      type: String,
      required: true,
    },
  },
  {
    _id: false,
  }
);

export default imageSchema;