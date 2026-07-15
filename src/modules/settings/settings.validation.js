import { z } from "zod";

const socialsSchema = z.object({
  github: z.string().url().or(z.literal("")).optional(),
  linkedin: z.string().url().or(z.literal("")).optional(),
  twitter: z.string().url().or(z.literal("")).optional(),
  instagram: z.string().url().or(z.literal("")).optional(),
  facebook: z.string().url().or(z.literal("")).optional(),
});

export const createSettingsSchema = z.object({
  siteTitle: z.string().max(200).optional(),
  siteDescription: z.string().max(500).optional(),
  siteKeywords: z.array(z.string()).max(50).optional(),
  ogImage: z.string().url().or(z.literal("")).optional(),

  contactEmail: z.string().email().or(z.literal("")).optional(),
  contactPhone: z.string().max(50).optional(),

  socials: socialsSchema.optional(),

  footerName: z.string().max(100).optional(),
  footerRole: z.string().max(100).optional(),
  resumeUrl: z.string().url().or(z.literal("")).optional(),

  maintenanceMode: z.boolean().optional(),
});

export const updateSettingsSchema = createSettingsSchema.partial();
