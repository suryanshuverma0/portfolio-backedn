import { z } from "zod";
import { LINK_KINDS, SECTION_KEYS, CARD_FINISHES } from "./card.model.js";

const optionalText = (max) => z.string().trim().max(max).optional();

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^(https?:\/\/|mailto:|tel:)/i.test(value), "Must start with https://, mailto: or tel:");

export const updateCardSchema = z.object({
  isEnabled: z.boolean().optional(),

  displayName: optionalText(100),
  title: optionalText(100),
  company: optionalText(100),
  tagline: optionalText(300),
  location: optionalText(100),
  availability: optionalText(80),
  photo: z
    .object({ publicId: z.string().min(1), url: z.string().url() })
    .nullable()
    .optional(),

  email: z.union([z.string().trim().email().max(150), z.literal("")]).optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d\s()-]*$/, "Only digits, spaces, +, ( ) and -")
    .optional(),
  whatsapp: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d\s()-]*$/, "Only digits, spaces, +, ( ) and -")
    .optional(),
  website: z.union([httpUrl, z.literal("")]).optional(),

  links: z
    .array(
      z.object({
        kind: z.enum(LINK_KINDS),
        label: optionalText(60),
        url: httpUrl,
        isVisible: z.boolean().optional(),
      }),
    )
    .max(12)
    .optional(),
  stats: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(20),
        label: z.string().trim().min(1).max(40),
      }),
    )
    .max(4)
    .optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  featuredProjects: z
    .array(z.string().regex(/^[a-f\d]{24}$/i, "Invalid project id"))
    .max(3)
    .optional(),

  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #2a78d6")
    .optional(),
  finish: z.enum(CARD_FINISHES).optional(),
  sections: z
    .object(Object.fromEntries(SECTION_KEYS.map((key) => [key, z.boolean().optional()])))
    .strict()
    .optional(),
});
