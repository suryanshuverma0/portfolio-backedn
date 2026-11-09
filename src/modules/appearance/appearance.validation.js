import { z } from "zod";

// Everything here ends up inside CSS or a Google Fonts URL on the public
// site, so values are restricted to shapes that can't break out of them:
// 6-digit hex colours, plain font names, bounded numbers, slug ids.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be 6-digit hex, e.g. #1a2b3c");

const palette = z.object({
  background: hex,
  surface: hex,
  card: hex,
  primary: hex,
  secondary: hex,
  muted: hex,
  border: hex,
  borderStrong: hex,
  accent: hex,
});

const fontName = z.string().regex(/^[A-Za-z0-9 ]{2,40}$/, "Invalid font name");

const slug = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const appearanceSchema = z.object({
  version: z.number().int().min(1).max(100).optional(),
  preset: z.string().regex(/^[a-z0-9-]{0,40}$/).optional(),

  colors: z.object({ light: palette, dark: palette }),

  typography: z.object({
    headingFont: fontName,
    bodyFont: fontName,
    accentFont: fontName,
    monoFont: fontName,
    baseSize: z.number().min(14).max(18),
    headingWeight: z.number().int().min(300).max(900),
    headingTracking: z.number().min(0).max(1.5),
  }),

  shape: z.object({
    roundness: z.number().min(0).max(1.5),
    buttons: z.enum(["pill", "rounded", "square"]),
  }),

  effects: z.object({
    grain: z.boolean(),
    cursor: z.boolean(),
    smoothScroll: z.boolean(),
    sectionNumbers: z.boolean(),
    accentButtons: z.boolean(),
  }),

  defaultMode: z.enum(["system", "light", "dark"]),

  sections: z
    .array(z.object({ id: slug, visible: z.boolean() }))
    .min(1)
    .max(40)
    .refine((list) => new Set(list.map((s) => s.id)).size === list.length, "Duplicate section"),
});

export const restoreSchema = z.object({
  index: z.number().int().min(0).max(19),
});
