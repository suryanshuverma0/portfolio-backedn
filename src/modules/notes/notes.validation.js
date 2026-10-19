import { z } from "zod";
import { NOTE_KINDS, PAPERS } from "./notes.model.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex colour like #2a78d6");

export const notebookSchema = z.object({
  title: z.string().trim().min(1).max(120),
  color: hex.optional(),
  icon: z.string().trim().max(8).optional(),
});

export const notebookUpdateSchema = notebookSchema.partial();

export const topicSchema = z.object({
  notebook: objectId,
  parent: objectId.nullable().optional(),
  title: z.string().trim().min(1).max(120),
});

export const topicUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  parent: objectId.nullable().optional(),
  notebook: objectId.optional(),
});

// Ink is validated structurally (types, sizes) but kept compact: points are
// [x, y, pressure] triples in page units.
const point = z.tuple([z.number().finite(), z.number().finite(), z.number().min(0).max(1)]);

const inkElement = z.discriminatedUnion("type", [
  z.object({
    id: z.string().max(40),
    type: z.literal("stroke"),
    tool: z.enum(["pen", "highlighter"]),
    color: hex,
    size: z.number().min(0.5).max(80),
    points: z.array(point).min(1).max(20000),
  }),
  z.object({
    id: z.string().max(40),
    type: z.literal("shape"),
    shape: z.enum(["line", "rect", "ellipse"]),
    color: hex,
    size: z.number().min(0.5).max(80),
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
  }),
  z.object({
    id: z.string().max(40),
    type: z.literal("image"),
    url: z.string().url().max(600),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().positive().max(20000),
    h: z.number().positive().max(20000),
  }),
]);

export const inkSchema = z.object({
  paper: z.enum(PAPERS).default("lined"),
  elements: z.array(inkElement).max(20000),
});

export const noteCreateSchema = z.object({
  notebook: objectId,
  topic: objectId.nullable().optional(),
  kind: z.enum(NOTE_KINDS),
  title: z.string().trim().max(200).optional(),
  paper: z.enum(PAPERS).optional(),
});

export const noteUpdateSchema = z.object({
  title: z.string().trim().max(200).optional(),
  isPinned: z.boolean().optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional(),
  notebook: objectId.optional(),
  topic: objectId.nullable().optional(),
  doc: z.record(z.string(), z.unknown()).nullable().optional(),
  text: z.string().max(500000).optional(),
  ink: inkSchema.optional(),
});

export const reorderSchema = z.object({
  type: z.enum(["notebook", "topic", "note"]),
  ids: z.array(objectId).min(1).max(500),
});
