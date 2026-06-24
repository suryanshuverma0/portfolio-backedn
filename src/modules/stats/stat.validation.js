import { z } from "zod";

export const createStatSchema = z.object({
  label: z.string().min(1).max(100),

  value: z.string().min(1).max(50),

  section: z.enum(["about", "hero","projects"]).optional(),

  order: z.number().optional(),

  isVisible: z.boolean().optional(),
});

export const updateStatSchema =
  createStatSchema.partial();