import Comment from "./comment.model.js";
import Post from "./blog.model.js";

export const createComment = async (slug, commentData) => {
  const post = await Post.findOne({ slug, isVisible: true });

  if (!post) {
    throw new Error("Post not found");
  }

  const comment = await Comment.create({
    post: post._id,
    ...commentData,
  });

  return comment;
};

// Email is never selected here — approved comments are public reads.
export const getApprovedComments = async (slug) => {
  const post = await Post.findOne({ slug, isVisible: true });

  if (!post) {
    throw new Error("Post not found");
  }

  return Comment.find({ post: post._id, isApproved: true })
    .select("-email")
    .sort({ createdAt: -1 });
};

// Admin-only — includes email, and pending comments, across every post.
export const getAllComments = async () => {
  return Comment.find({}).populate("post", "title slug").sort({ createdAt: -1 });
};

export const approveComment = async (id) => {
  const comment = await Comment.findByIdAndUpdate(
    id,
    { $set: { isApproved: true } },
    { new: true },
  );

  if (!comment) {
    throw new Error("Comment not found");
  }

  return comment;
};

export const deleteComment = async (id) => {
  const comment = await Comment.findByIdAndDelete(id);

  if (!comment) {
    throw new Error("Comment not found");
  }

  return comment;
};
