import { z } from "zod";

export const createEducationSchema = z.object({
  degree: z.string().min(2).max(200),
  institution: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  startYear: z.number(),
  endYear: z.number().nullable().optional(),
  current: z.boolean().optional(),
  order: z.number().optional(),
  isVisible: z.boolean().optional(),
});

export const updateEducationSchema = createEducationSchema.partial();
