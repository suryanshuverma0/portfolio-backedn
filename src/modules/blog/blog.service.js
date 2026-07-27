import Post from "./blog.model.js";

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
