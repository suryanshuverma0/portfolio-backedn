import { z } from "zod";

// http(s) only — z.string().url() alone would accept javascript: links,
// which end up in href attributes on the public site.
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Links must start with http(s)://");

const imageObjectSchema = z.object({
  publicId: z.string().max(300).default(""),
  url: httpUrl,
});

const listOf = (max = 50) => z.array(z.string().trim().min(1).max(500)).max(max);

const evaluationItemSchema = z.object({
  label: z.string().min(1).max(150),
  value: z.string().min(1).max(150),
});

export const createProjectSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(200)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers and hyphens",
    ),

  category: z.enum([
    "Frontend",
    "Backend",
    "Full Stack",
    "Blockchain",
    "Artificial Intelligence",
    "Mobile",
    "DevOps",
    "Software Engineering",
    "UI/UX",
    "Other",
  ]),

  title: z.string().min(2).max(200),

  description: z.string().min(10).max(5000),

  thumbnail: imageObjectSchema,

  gallery: z.array(imageObjectSchema).max(50).optional(),

  architectureImages: z.array(imageObjectSchema).max(50).optional(),

  features: listOf().optional(),

  technologies: listOf().optional(),

  challenges: listOf().optional(),

  learnings: listOf().optional(),

  evaluation: z.array(evaluationItemSchema).max(50).optional(),

  githubUrl: httpUrl.or(z.literal("")).optional(),

  liveUrl: httpUrl.or(z.literal("")).optional(),

  featured: z.boolean().optional(),

  order: z.number().int().min(0).max(10000).optional(),

  isVisible: z.boolean().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const reorderProjectsSchema = z.object({
  ids: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(500),
});

export const githubImportSchema = z.object({
  repo: z.string().trim().min(3).max(300),
});
