import { z } from "zod";

export const createProfileSchema = z.object({
  name: z.string().min(2).max(100),

  headline: z.string().min(10).max(200),

  description: z.string().min(20).max(5000),

  availability: z.string().max(100).optional(),

  image: z
    .object({
      publicId: z.string(),

      url: z.string().url(),
    })
    .optional(),

  roles: z.array(z.string().min(1)).max(20).optional(),

  isVisible: z.boolean().optional(),
});

export const updateProfileSchema = createProfileSchema.partial();
