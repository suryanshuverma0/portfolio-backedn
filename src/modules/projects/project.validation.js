import { z } from "zod";

const imageObjectSchema = z.object({
  publicId: z.string(),
  url: z.string().url(),
});

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

  features: z.array(z.string()).max(50).optional(),

  technologies: z.array(z.string()).max(50).optional(),

  challenges: z.array(z.string()).max(50).optional(),

  learnings: z.array(z.string()).max(50).optional(),

  evaluation: z.array(evaluationItemSchema).max(50).optional(),

  githubUrl: z.string().url().or(z.literal("")).optional(),

  liveUrl: z.string().url().or(z.literal("")).optional(),

  featured: z.boolean().optional(),

  order: z.number().optional(),

  isVisible: z.boolean().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();
