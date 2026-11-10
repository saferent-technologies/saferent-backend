import { z } from "zod";
import { ALLOWED_EMAIL_DOMAIN, OTP, REASONS } from "../config/constants";
import { fail } from "./errors";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isAllowedEmailDomain(email: string): boolean {
  const normalized = normalizeEmail(email);
  const parts = normalized.split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[1] === ALLOWED_EMAIL_DOMAIN;
}

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const companyEmailSchema = emailSchema.refine(isAllowedEmailDomain, {
  message: `Only @${ALLOWED_EMAIL_DOMAIN} addresses are allowed.`,
});

/** Shared password policy (the web app enforces the same rules for instant feedback). */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.")
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/\d/, "Password must contain a number.")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol.");

export const phoneE164Schema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Phone number must be in E.164 format.");

export const verifyOtpInputSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(new RegExp(`^\\d{${OTP.LENGTH}}$`)),
});

export const passwordResetInputSchema = z.object({ email: emailSchema });
export const changePasswordInputSchema = z.object({ newPassword: passwordSchema });
export const emailChangeInputSchema = z.object({ newEmail: companyEmailSchema });
export const rebindSessionInputSchema = z.object({ previousIdToken: z.string().min(20).max(8192) });

/** Parses callable input or throws invalid-argument without echoing internals. */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    fail("invalid-argument", REASONS.INVALID_INPUT, result.error.issues[0]?.message ?? "Invalid request.");
  }
  return result.data;
}
