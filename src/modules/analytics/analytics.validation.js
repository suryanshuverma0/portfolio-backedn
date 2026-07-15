import { z } from "zod";

export const trackSchema = z.object({
  path: z.string().min(1).max(300),
  referrer: z.string().max(500).optional(),
  visitorId: z.string().min(1).max(100),
});
