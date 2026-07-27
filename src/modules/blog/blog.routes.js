import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import { slidingWindowLimiter } from "../../middleware/rateLimiter.middleware.js";

import {
  createPostController,
  getPostsController,
  getPostController,
  updatePostController,
  deletePostController,
  getPublicPostsController,
  getPublicPostController,
  getTagsController,
} from "./blog.controller.js";

import {
  createCommentController,
  getApprovedCommentsController,
  getAllCommentsController,
  approveCommentController,
  deleteCommentController,
} from "./comment.controller.js";

import {
  createPostSchema,
  updatePostSchema,
  createCommentSchema,
} from "./blog.validation.js";

const router = express.Router();

// Defined locally rather than in ../../middleware/limiters.js so this
// module doesn't require touching shared limiter config.
const commentLimiter = slidingWindowLimiter({
  prefix: "blog-comment",
  limit: 5,
  windowInSeconds: 600,
});

/* ========================================
   PUBLIC
========================================= */

router.get("/public", getPublicPostsController);

router.get("/public/tags", getTagsController);

router.get("/public/:slug", getPublicPostController);

router.get("/public/:slug/comments", getApprovedCommentsController);

router.post(
  "/public/:slug/comments",
  commentLimiter,
  validate(createCommentSchema),
  createCommentController,
);

/* ========================================
   ADMIN — COMMENTS
   (mounted before "/:id" below so "/comments"
   isn't swallowed by the post-id param route)
========================================= */

router.get("/comments", protectAdmin, getAllCommentsController);

router.put("/comments/:id/approve", protectAdmin, approveCommentController);

router.delete("/comments/:id", protectAdmin, deleteCommentController);

/* ========================================
   ADMIN — POSTS
========================================= */

router.post(
  "/",
  protectAdmin,
  validate(createPostSchema),
  createPostController,
);

router.get("/", protectAdmin, getPostsController);

router.get("/:id", protectAdmin, getPostController);

router.put(
  "/:id",
  protectAdmin,
  validate(updatePostSchema),
  updatePostController,
);

router.delete("/:id", protectAdmin, deletePostController);

export default router;
