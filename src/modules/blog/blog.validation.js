import { z } from "zod";

const imageObjectSchema = z.object({
  publicId: z.string(),
  url: z.string().url(),
});

export const createPostSchema = z.object({
  title: z.string().min(2).max(200),

  slug: z
    .string()
    .min(2)
    .max(200)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers and hyphens",
    ),

  excerpt: z.string().max(300).optional(),

  content: z.string().min(1, "Content is required"),

  coverImage: imageObjectSchema.optional(),

  tags: z.array(z.string()).max(20).optional(),

  isVisible: z.boolean().optional(),

  // ISO date-time to auto-publish at, or null to cancel a schedule.
  scheduledAt: z
    .union([
      z.null(),
      z
        .string()
        .datetime({ offset: true })
        .refine((value) => new Date(value) > new Date(Date.now() - 60 * 1000), "Schedule time must be in the future"),
    ])
    .optional(),
});

export const updatePostSchema = createPostSchema.partial();

export const createCommentSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),

  email: z.string().min(1, "Email is required").email("Invalid email address"),

  content: z.string().min(1, "Comment is required").max(2000),
});
