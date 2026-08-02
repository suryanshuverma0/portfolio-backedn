import { z } from "zod";

// Duplicated from ../auth/auth.validation.js rather than imported, so this
// module stays self-contained (same rationale as ../google-auth).
const emailSchema = z.string().trim().email("Invalid email address").toLowerCase();

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

// Public passkey signup — creates a brand-new account, so (unlike login)
// it needs an email up front to run the same admin/public-access gate
// password and Google signup already go through.
export const signupOptionsSchema = z.object({
  email: emailSchema,
});

export const signupVerifySchema = z.object({
  email: emailSchema,
  response: credentialResponseSchema,
  name: z.string().trim().min(1).max(100).optional(),
});

// Add-this-device-to-my-existing-account flow, via an emailed one-time
// link — see verifyLink in passkey.service.js for why this can safely
// attach to an existing account (unlike public signup).
export const linkRequestSchema = z.object({
  email: emailSchema,
});

const tokenSchema = z.string({ required_error: "Token is required" }).min(1);

export const linkOptionsSchema = z.object({
  token: tokenSchema,
});

export const linkVerifySchema = z.object({
  token: tokenSchema,
  response: credentialResponseSchema,
  name: z.string().trim().min(1).max(100).optional(),
});

export const renamePasskeySchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
});
