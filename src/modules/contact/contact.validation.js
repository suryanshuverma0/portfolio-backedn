import { z } from "zod";

export const createMessageSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),

  email: z.string().min(1, "Email is required").email("Invalid email address"),

  subject: z.string().max(200).optional(),

  message: z.string().min(1, "Message is required").max(3000),
});
