import { z } from "zod";

export const createServiceSchema = z.object({
  category: z.enum([
    "Frontend",
    "Backend",
    "Full Stack",
    "Blockchain",
    "Mobile",
    "DevOps",
    "UI/UX",
    "Other",
  ]),

  title: z.string().min(2).max(200),

  description: z.string().min(10).max(3000),

  technologies: z.array(z.string().min(1)).max(30).optional(),

  featured: z.boolean().optional(),

  order: z.number().optional(),

  isVisible: z.boolean().optional(),
});

export const updateServiceSchema = createServiceSchema.partial();
