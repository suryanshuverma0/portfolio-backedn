import { z } from "zod";
import { EVENT_TYPES } from "./journey.model.js";

const shortText = (max) => z.string().trim().max(max).optional();

const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  path: z.string().max(300).optional(),
  title: shortText(200),
  label: shortText(200),
  section: shortText(60),
  target: shortText(500),
  value: z.number().finite().min(0).max(1e9).optional(),
  meta: z
    .record(z.string().max(40), z.union([z.string().max(300), z.number(), z.boolean()]))
    .refine((meta) => Object.keys(meta).length <= 10, "Too many meta keys")
    .optional(),
  ts: z.number().int().positive(),
});

const contextSchema = z.object({
  screen: shortText(20),
  viewport: shortText(20),
  pixelRatio: z.number().finite().min(0).max(10).optional(),
  language: shortText(20),
  timezone: shortText(60),
  connection: shortText(20),
  touch: z.boolean().optional(),
  colorScheme: shortText(10),
  referrer: shortText(500),
  landingUrl: shortText(500),
  utm: z
    .object({
      source: shortText(100),
      medium: shortText(100),
      campaign: shortText(100),
      term: shortText(100),
      content: shortText(100),
    })
    .optional(),
});

export const collectSchema = z.object({
  sessionId: z.string().min(8).max(100),
  visitorId: z.string().min(1).max(100),
  sentAt: z.number().int().positive(),
  context: contextSchema.optional(),
  events: z.array(eventSchema).min(1).max(50),
});
