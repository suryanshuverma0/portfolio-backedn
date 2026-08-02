import { z } from "zod";

// Structural check only — the exact shape of `response` is dictated by the
// WebAuthn spec / @simplewebauthn/browser, and the real cryptographic
// validation happens server-side in verifyRegistrationResponse /
// verifyAuthenticationResponse. This just rejects obviously-malformed input
// before it reaches that layer.
const credentialResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.string().min(1),
  response: z.record(z.any()),
  clientExtensionResults: z.record(z.any()).optional(),
  authenticatorAttachment: z.string().optional(),
});

export const registrationVerifySchema = z.object({
  response: credentialResponseSchema,
  name: z.string().trim().min(1).max(100).optional(),
});

export const authenticationVerifySchema = z.object({
  response: credentialResponseSchema,
});

export const renamePasskeySchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
});
