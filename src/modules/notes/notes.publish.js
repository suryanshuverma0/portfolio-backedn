import { Note, NoteTopic, Notebook } from "./notes.model.js";
import Post from "../blog/blog.model.js";
import { createPost, updatePost } from "../blog/blog.service.js";
import { docToMarkdown } from "./notes.convert.js";

// ---------------------------------------------------------------------------
// Note ↔ blog post. Publishing converts the note to Markdown (typed) or an
// image post (handwritten — the client uploads a PNG snapshot) and creates
// or updates the linked post. Unpublishing hides the post but keeps it
// linked, so re-publishing reuses the same URL.
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";

const uniqueSlug = async (base, excludeId) => {
  let slug = base;
  for (let i = 2; await Post.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }); i += 1) {
    slug = `${base}-${i}`;
  }
  return slug;
};

export const breadcrumbFor = async (note) => {
  const [notebook, topics] = await Promise.all([
    Notebook.findById(note.notebook).select("title").lean(),
    NoteTopic.find({ notebook: note.notebook }).select("title parent").lean(),
  ]);
  const parts = [];
  for (let id = note.topic; id; ) {
    const topic = topics.find((t) => String(t._id) === String(id));
    if (!topic) break;
    parts.unshift(topic.title);
    id = topic.parent;
  }
  return [notebook?.title, ...parts].filter(Boolean).join(" / ");
};

export const getPublishStatus = async (noteId) => {
  const note = await Note.findOne({ _id: noteId, deletedAt: null }).select("blogPost").lean();
  if (!note) throw new ApiError(404, "Note not found");
  if (!note.blogPost) return { published: false, post: null };

  const post = await Post.findById(note.blogPost).select("title slug isVisible publishedAt updatedAt excerpt coverImage").lean();
  if (!post) return { published: false, post: null };
  return { published: post.isVisible, post };
};

export const publishNote = async (noteId, userId, { title, slug, excerpt, coverImage, imageUrl }) => {
  const note = await Note.findOne({ _id: noteId, deletedAt: null });
  if (!note) throw new ApiError(404, "Note not found");

  let content;
  if (note.kind === "typed") {
    content = docToMarkdown(note.doc);
    if (!content.trim()) throw new ApiError(400, "This note is empty — write something before publishing");
  } else {
    if (!imageUrl) throw new ApiError(400, "A snapshot of the handwriting is required");
    content = `![${(title || note.title).replace(/[[\]]/g, "")}](${imageUrl})`;
  }

  const postTitle = (title || note.title || "Untitled").trim().slice(0, 200);
  const postExcerpt = (excerpt ?? note.text?.replace(/\s+/g, " ").trim().slice(0, 280) ?? "").slice(0, 300);
  const existing = note.blogPost ? await Post.findById(note.blogPost) : null;

  let post;
  if (existing) {
    const nextSlug = slug ? await uniqueSlug(slugify(slug), existing._id) : existing.slug;
    post = await updatePost(existing._id, {
      title: postTitle,
      slug: nextSlug,
      excerpt: postExcerpt,
      content,
      ...(coverImage !== undefined && { coverImage }),
      ...(note.tags?.length && { tags: note.tags }),
      isVisible: true,
    });
  } else {
    post = await createPost(userId, {
      title: postTitle,
      slug: await uniqueSlug(slugify(slug || postTitle)),
      excerpt: postExcerpt,
      content,
      ...(coverImage && { coverImage }),
      ...(note.tags?.length && { tags: note.tags }),
      isVisible: true,
    });
    note.blogPost = post._id;
    await note.save();
  }

  return { published: true, post: { _id: post._id, slug: post.slug, title: post.title, isVisible: post.isVisible, publishedAt: post.publishedAt } };
};

export const unpublishNote = async (noteId) => {
  const note = await Note.findOne({ _id: noteId, deletedAt: null }).select("blogPost").lean();
  if (!note?.blogPost) throw new ApiError(400, "This note isn't published");
  const post = await updatePost(note.blogPost, { isVisible: false });
  return { published: false, post: { _id: post._id, slug: post.slug, title: post.title, isVisible: false } };
};

