import { z } from "zod";

export const createExperienceSchema =
  z.object({
    role: z.string().min(2).max(200),

    company: z.string().min(2).max(200),

    location: z.string().max(200).optional(),

    employmentType: z
      .enum([
        "Full-time",
        "Part-time",
        "Internship",
        "Contract",
        "Freelance",
        "Remote",
        "Others",
      ])
      .optional(),

    startDate: z.string(),

    endDate: z.string().nullable().optional(),

    isCurrent: z.boolean().optional(),

    description: z.string().min(10).max(5000),

    technologies: z
      .array(z.string())
      .max(50)
      .optional(),

    companyUrl: z
      .string()
      .url()
       .or(z.literal(""))
      .optional(),

    featured: z.boolean().optional(),

    order: z.number().optional(),

    isVisible: z.boolean().optional(),
  });

export const updateExperienceSchema =
  createExperienceSchema.partial();