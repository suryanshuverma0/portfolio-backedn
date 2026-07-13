import { z } from "zod";

export const createCertificateSchema = z.object({
  title: z.string().min(2).max(250),

  issuer: z.string().min(2).max(150),

  year: z.number(),

  image: z.object({
    publicId: z.string(),

    url: z.string().url(),
  }),

  verifyUrl: z.string().url().optional(),

  featured: z.boolean().optional(),

  order: z.number().optional(),

  isVisible: z.boolean().optional(),
});

export const updateCertificateSchema = createCertificateSchema.partial();
