import mongoose from "mongoose";
import imageSchema from "../../shared/schemas/image.schema.js";

const postSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: 200,
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

    excerpt: {
      type: String,
      trim: true,
      maxlength: 300,
    },

    content: {
      type: String,
      required: [true, "Content is required"],
    },

    coverImage: {
      type: imageSchema,
    },

    tags: [{ type: String, trim: true }],

    // Minutes, computed server-side from content word count on save.
    readingTime: {
      type: Number,
      default: 1,
    },

    isVisible: {
      type: Boolean,
      default: false,
    },

    // Set the first time a post transitions to isVisible: true — not the
    // same as createdAt, which is when the draft was first started.
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

postSchema.index({ isVisible: 1, publishedAt: -1 });
postSchema.index({ tags: 1 });

const Post = mongoose.model("Post", postSchema);
export default Post;
