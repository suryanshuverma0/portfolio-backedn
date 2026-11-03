import Post from "./blog.model.js";
import logger from "../../utils/logger.js";

const WORDS_PER_MINUTE = 200;

const computeReadingTime = (content) => {
  const words = content.trim().split(/\s+/).filter(Boolean).length;

  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};

// Shared site content — not scoped per admin account, same as every other
// module. `user` is kept on each post as a "created by" reference only.
export const createPost = async (userId, postData) => {
  const existing = await Post.findOne({ slug: postData.slug });

  if (existing) {
    throw new Error("A post with this slug already exists");
  }

  const post = await Post.create({
    user: userId,
    ...postData,
    readingTime: computeReadingTime(postData.content),
    publishedAt: postData.isVisible ? new Date() : null,
    // A schedule only applies to drafts.
    scheduledAt: postData.isVisible ? null : postData.scheduledAt ? new Date(postData.scheduledAt) : null,
  });

  return post;
};

export const getPosts = async () => {
  return Post.find({}).sort({ createdAt: -1 });
};

export const getPost = async (id) => {
  const post = await Post.findById(id);

  if (!post) {
    throw new Error("Post not found");
  }

  return post;
};

export const updatePost = async (id, updateData) => {
  const existing = await Post.findById(id);

  if (!existing) {
    throw new Error("Post not found");
  }

  if (updateData.slug && updateData.slug !== existing.slug) {
    const slugTaken = await Post.findOne({
      slug: updateData.slug,
      _id: { $ne: id },
    });

    if (slugTaken) {
      throw new Error("A post with this slug already exists");
    }
  }

  const nextData = { ...updateData };

  if (updateData.content) {
    nextData.readingTime = computeReadingTime(updateData.content);
  }

  // Stamp publishedAt the first time a post transitions to visible — never
  // overwritten by later edits, so it reflects the original publish date.
  if (updateData.isVisible && !existing.isVisible) {
    nextData.publishedAt = new Date();
  }

  if (updateData.scheduledAt !== undefined) {
    nextData.scheduledAt = updateData.scheduledAt ? new Date(updateData.scheduledAt) : null;
  }

  // Publishing by hand cancels any pending schedule.
  if (updateData.isVisible ?? existing.isVisible) {
    nextData.scheduledAt = null;
  }

  const post = await Post.findByIdAndUpdate(
    id,
    { $set: nextData },
    { new: true, runValidators: true },
  );

  return post;
};

export const deletePost = async (id) => {
  const post = await Post.findByIdAndDelete(id);

  if (!post) {
    throw new Error("Post not found");
  }

  return post;
};

export const getPublicPosts = async ({ page = 1, limit = 9, tag } = {}) => {
  const filter = { isVisible: true };

  if (tag) {
    filter.tags = tag;
  }

  const skip = (page - 1) * limit;

  const [posts, total] = await Promise.all([
    Post.find(filter)
      .select("-content")
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(limit),

    Post.countDocuments(filter),
  ]);

  return {
    posts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getPublicPostBySlug = async (slug) => {
  const post = await Post.findOne({ slug, isVisible: true });

  if (!post) {
    throw new Error("Post not found");
  }

  return post;
};

export const getAllTags = async () => {
  return Post.distinct("tags", { isVisible: true });
};

/* ========================================
   SCHEDULED PUBLISHING
========================================= */

let schedulerTimer = null;

// Publishes every draft whose scheduledAt has passed. publishedAt is the
// scheduled time itself, so a late tick doesn't shift the post's date.
export const publishDuePosts = async () => {
  const due = await Post.find({ isVisible: false, scheduledAt: { $ne: null, $lte: new Date() } })
    .select("_id title scheduledAt")
    .lean();

  for (const post of due) {
    await Post.updateOne(
      { _id: post._id, isVisible: false },
      { $set: { isVisible: true, publishedAt: post.scheduledAt, scheduledAt: null } },
    );

    logger.info({ action: "BLOG_POST_AUTO_PUBLISHED", postId: String(post._id), title: post.title });
  }

  return due.length;
};

export const startBlogScheduler = () => {
  if (schedulerTimer) return;

  const tick = () => publishDuePosts().catch((error) => logger.warn({ action: "BLOG_SCHEDULER_FAILED", error: error.message }));

  tick();
  schedulerTimer = setInterval(tick, 60 * 1000);
  schedulerTimer.unref?.();
};
