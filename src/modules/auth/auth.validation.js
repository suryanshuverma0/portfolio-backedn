import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .email("Invalid email address")
  .toLowerCase();

const passwordSchema = z
  .string()
  .min(
    8,
    "Password must be at least 8 characters",
  )
  .regex(
    /[A-Z]/,
    "Password must contain at least one uppercase letter",
  )
  .regex(
    /[a-z]/,
    "Password must contain at least one lowercase letter",
  )
  .regex(
    /[0-9]/,
    "Password must contain at least one number",
  );

export const registerSchema = z.object({
  email: emailSchema,

  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,

  password: z
    .string()
    .min(1, "Password is required"),
});

export const forgotPasswordSchema =
  z.object({
    email: emailSchema,
  });

export const resetPasswordSchema =
  z.object({
    password: passwordSchema,

    confirmPassword: z.string(),
  })
  .refine(
    (data) =>
      data.password === data.confirmPassword,
    {
      message: "Passwords do not match",

      path: ["confirmPassword"],
    },
  );
