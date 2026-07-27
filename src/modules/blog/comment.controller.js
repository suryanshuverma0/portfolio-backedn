import {
  createComment,
  getApprovedComments,
  getAllComments,
  approveComment,
  deleteComment,
} from "./comment.service.js";

export const createCommentController = async (req, res, next) => {
  try {
    await createComment(req.params.slug, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Comment submitted — it will appear once approved.",
    });
  } catch (error) {
    next(error);
  }
};

export const getApprovedCommentsController = async (req, res, next) => {
  try {
    const comments = await getApprovedComments(req.params.slug);

    res.status(200).json({
      success: true,
      data: comments,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllCommentsController = async (req, res, next) => {
  try {
    const comments = await getAllComments();

    res.status(200).json({
      success: true,
      data: comments,
    });
  } catch (error) {
    next(error);
  }
};

export const approveCommentController = async (req, res, next) => {
  try {
    const comment = await approveComment(req.params.id);

    res.status(200).json({
      success: true,
      message: "Comment approved",
      data: comment,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteCommentController = async (req, res, next) => {
  try {
    await deleteComment(req.params.id);

    res.status(200).json({
      success: true,
      message: "Comment deleted",
    });
  } catch (error) {
    next(error);
  }
};
