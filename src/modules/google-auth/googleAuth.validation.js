import { z } from "zod";

export const googleLoginSchema = z.object({
  credential: z
    .string({
      required_error: "Google credential is required",
    })
    .min(1, "Google credential is required"),
});
