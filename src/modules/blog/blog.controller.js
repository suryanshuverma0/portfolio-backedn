import {
  createPost,
  getPosts,
  getPost,
  updatePost,
  deletePost,
  getPublicPosts,
  getPublicPostBySlug,
  getAllTags,
} from "./blog.service.js";

export const createPostController = async (req, res, next) => {
  try {
    const post = await createPost(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Post created successfully",
      data: post,
    });
  } catch (error) {
    next(error);
  }
};

export const getPostsController = async (req, res, next) => {
  try {
    const posts = await getPosts();

    res.status(200).json({
      success: true,
      data: posts,
    });
  } catch (error) {
    next(error);
  }
};

export const getPostController = async (req, res, next) => {
  try {
    const post = await getPost(req.params.id);

    res.status(200).json({
      success: true,
      data: post,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePostController = async (req, res, next) => {
  try {
    const post = await updatePost(req.params.id, req.validatedData);

    res.status(200).json({
      success: true,
      message: "Post updated successfully",
      data: post,
    });
  } catch (error) {
    next(error);
  }
};

export const deletePostController = async (req, res, next) => {
  try {
    await deletePost(req.params.id);

    res.status(200).json({
      success: true,
      message: "Post deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicPostsController = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 9));
    const tag = req.query.tag || undefined;

    const result = await getPublicPosts({ page, limit, tag });

    res.status(200).json({
      success: true,
      data: result.posts,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicPostController = async (req, res, next) => {
  try {
    const post = await getPublicPostBySlug(req.params.slug);

    res.status(200).json({
      success: true,
      data: post,
    });
  } catch (error) {
    next(error);
  }
};

export const getTagsController = async (req, res, next) => {
  try {
    const tags = await getAllTags();

    res.status(200).json({
      success: true,
      data: tags,
    });
  } catch (error) {
    next(error);
  }
};
