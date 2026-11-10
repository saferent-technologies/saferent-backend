import { z } from "zod";
import { ALLOWED_EMAIL_DOMAIN, OTP_LENGTH } from "@/utils/constants";
import { findCountry, isValidNationalNumber } from "@/utils/phone";

/** Client-side checks give instant feedback. The server re-validates everything. */

export function isCompanyEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split("@");
  return parts.length === 2 && parts[0].length > 0 && parts[1] === ALLOWED_EMAIL_DOMAIN;
}

export const companyEmailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .email("Enter a valid email address.")
  .refine(isCompanyEmail, `Use your @${ALLOWED_EMAIL_DOMAIN} email address.`);

export const passwordPolicySchema = z
  .string()
  .min(12, "At least 12 characters.")
  .max(128, "At most 128 characters.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/\d/, "Include a number.")
  .regex(/[^A-Za-z0-9]/, "Include a symbol.");

export const PASSWORD_RULES: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: "12+ characters", test: (v) => v.length >= 12 },
  { label: "Uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "Lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "Number", test: (v) => /\d/.test(v) },
  { label: "Symbol", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export const emailLoginSchema = z.object({
  email: companyEmailSchema,
  password: z.string().min(1, "Enter your password."),
  rememberMe: z.boolean(),
});
export type EmailLoginValues = z.infer<typeof emailLoginSchema>;

export const phoneLoginSchema = z
  .object({
    countryIso: z.string().min(2),
    phone: z.string().trim().min(1, "Enter your phone number."),
  })
  .refine((v) => isValidNationalNumber(findCountry(v.countryIso), v.phone), {
    message: "Enter a valid phone number.",
    path: ["phone"],
  });
export type PhoneLoginValues = z.infer<typeof phoneLoginSchema>;

export const otpCodeSchema = z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code.`);

export const forgotPasswordSchema = z.object({ email: companyEmailSchema });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const newPasswordSchema = z
  .object({
    password: passwordPolicySchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });
export type NewPasswordValues = z.infer<typeof newPasswordSchema>;

export const reauthSchema = z.object({ password: z.string().min(1, "Enter your current password.") });
export type ReauthValues = z.infer<typeof reauthSchema>;

export const changeEmailSchema = z.object({ newEmail: companyEmailSchema });
export type ChangeEmailValues = z.infer<typeof changeEmailSchema>;
