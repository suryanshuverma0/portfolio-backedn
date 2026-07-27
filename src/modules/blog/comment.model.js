import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 80,
    },

    // Never exposed on public reads — moderation contact only.
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: 200,
    },

    content: {
      type: String,
      required: [true, "Comment is required"],
      trim: true,
      maxlength: 2000,
    },

    isApproved: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

commentSchema.index({ post: 1, isApproved: 1, createdAt: -1 });

const Comment = mongoose.model("Comment", commentSchema);
export default Comment;
