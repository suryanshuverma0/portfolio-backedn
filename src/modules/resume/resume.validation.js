import { z } from "zod";

// Templates and fonts are rendered by the frontend; the backend only checks
// shapes and bounds (and that ids/colours can't smuggle markup or CSS).

export const TEMPLATE_IDS = ["jake", "classic", "modern", "minimal", "compact", "executive", "technical", "academic", "elegant", "harvard"];
const SECTION_IDS = ["summary", "experience", "projects", "skills", "education", "certificates", "custom"];

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const text = (max) => z.string().max(max);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const slug = z.string().regex(/^[a-z0-9-]{2,60}$/, "Use 2–60 lowercase letters, numbers or hyphens");

const bulletList = z.array(text(400)).max(12);

const customItem = z.object({
  heading: text(120).optional(),
  subheading: text(160).optional(),
  date: text(60).optional(),
  bullets: bulletList.optional(),
});

export const configSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  style: z
    .object({
      accent: hex.optional(),
      font: z.string().regex(/^[A-Za-z0-9 ]{2,40}$/).optional(),
      fontSize: z.number().min(8.5).max(12.5).optional(),
      lineHeight: z.number().min(1.05).max(1.7).optional(),
      margin: z.number().min(0.3).max(1.1).optional(),
      pageSize: z.enum(["a4", "letter"]).optional(),
      sectionSpacing: z.number().min(0.4).max(2).optional(),
    })
    .default({}),
  header: z
    .object({
      name: text(80).optional(),
      headline: text(140).optional(),
      email: text(120).optional(),
      phone: text(40).optional(),
      location: text(80).optional(),
      website: text(200).optional(),
      linkedin: text(200).optional(),
      github: text(200).optional(),
      show: z.record(z.string().max(20), z.boolean()).optional(),
    })
    .default({}),
  summary: text(1200).optional(),
  sections: z
    .array(z.object({ id: z.enum(SECTION_IDS), title: text(60).optional(), visible: z.boolean() }))
    .max(SECTION_IDS.length),
  selected: z
    .object({
      experience: z.array(objectId).max(40).optional(),
      projects: z.array(objectId).max(40).optional(),
      education: z.array(objectId).max(20).optional(),
      certificates: z.array(objectId).max(40).optional(),
      skills: z.array(objectId).max(200).optional(),
    })
    .default({}),
  options: z.record(z.string().max(40), z.union([z.boolean(), z.number(), z.string().max(40)])).default({}),
  overrides: z
    .record(
      objectId,
      z.object({
        title: text(160).optional(),
        subtitle: text(160).optional(),
        bullets: bulletList.optional(),
        tech: text(300).optional(),
      }),
    )
    .default({}),
  custom: z.object({ title: text(60).optional(), items: z.array(customItem).max(12).optional() }).optional(),
});

export const createResumeSchema = z.object({
  name: text(80).min(1, "Give the resume a name"),
  slug,
  isPublic: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  config: configSchema,
});

export const updateResumeSchema = createResumeSchema.partial();
