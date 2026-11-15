import { z } from "zod";
import { withoutNulls } from "./validation";
import { clientAcceptedAtSchema, consentItemsSchema, sourceSchema } from "./consents";

/*
 * Profile completion — what the demographic screen asks after sign-in. Pure (unit tested in
 * test/profileCompletion.test.ts). The app decides isProfileCompleted (stored on the user); the server
 * only refuses "true" while a REQUIRED field is still empty. Email, occupation and referral are optional.
 */

export const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"] as const;
export const REQUIRED_PROFILE_FIELDS = ["fullName", "gender", "dateOfBirth", "city", "state"] as const;
export type ProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export const MIN_AGE = 18;
export const MAX_AGE = 120;

export function profileCompletion(u: { fullName: string | null; gender: string | null; dateOfBirth: Date | null; city: string | null; state: string | null }): {
  isProfileCompleted: boolean;
  missingFields: ProfileField[];
} {
  const filled: Record<ProfileField, boolean> = {
    fullName: !!u.fullName && u.fullName.trim().length >= 2,
    gender: !!u.gender,
    dateOfBirth: !!u.dateOfBirth,
    city: !!u.city && u.city.trim().length > 0,
    state: !!u.state && u.state.trim().length > 0,
  };
  const missingFields = REQUIRED_PROFILE_FIELDS.filter((f) => !filled[f]);
  return { isProfileCompleted: missingFields.length === 0, missingFields };
}

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC). */
export function ageOn(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split("-").map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

export const dateOfBirthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth as YYYY-MM-DD.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), { message: "Enter a valid date of birth." })
  .refine((v) => ageOn(v) >= MIN_AGE, { message: `You must be at least ${MIN_AGE} years old to use SafeRent.` })
  .refine((v) => ageOn(v) <= MAX_AGE, { message: "Enter a valid date of birth." });

const place = (label: string) => z.string().trim().min(2, `Enter your ${label}.`).max(80);

/** Optional demographics sent with registration (new users), plus the app's isProfileCompleted flag. */
export const registrationDemographics = {
  isProfileCompleted: z.boolean().optional(),
  gender: z.enum(GENDERS).optional(),
  dateOfBirth: dateOfBirthSchema.optional(),
  city: place("city").optional(),
  state: place("state").optional(),
  occupation: z.string().trim().max(80).optional(),
};

/**
 * POST/PUT /userProfile — the user profile screen after sign-in (new and existing users).
 * isProfileCompleted is sent by the app: true when the user finished the screen, false when they skipped.
 * true is accepted only when every required field is filled (sent now or saved earlier).
 */
export const demographicsSchema = z.preprocess(
  withoutNulls,
  z
  .object({
    isProfileCompleted: z.boolean({ error: "Send isProfileCompleted as true or false." }),
    /** The user type chosen on the screen. The app opens this role's dashboard afterwards. */
    role: z.enum(["LANDLORD", "TENANT"], { error: "Choose Landlord or Tenant." }),
    /** First-time users only (creating the account); ignored for existing accounts. */
    referralCode: z.string().trim().toUpperCase().max(20).optional(),
    fullName: z.string().trim().min(2, "Enter your full name.").max(120).optional(),
    gender: z.enum(GENDERS).optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
    city: place("city").optional(),
    state: place("state").optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid email address.")
      .max(254)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    occupation: z.string().trim().max(80).optional(),
    /** Terms / Privacy / WhatsApp consents from the login screen — recorded in user_consents. */
    consents: consentItemsSchema.optional(),
    clientAcceptedAt: clientAcceptedAtSchema.optional(),
    source: sourceSchema.default("ANDROID"),
    appVersion: z.string().trim().max(32, "appVersion is at most 32 characters.").optional(),
  })
  .strict(),
);

export const toDateOnly = (v: string) => new Date(`${v}T00:00:00Z`);

/** What the auth responses return: the app's stored flag + which required fields are still empty. */
export function completionView(u: Parameters<typeof profileCompletion>[0] & { profileCompleted: boolean }): { isProfileCompleted: boolean; missingFields: ProfileField[] } {
  return { isProfileCompleted: u.profileCompleted, missingFields: profileCompletion(u).missingFields };
}

export const MISSING_MESSAGE: Record<ProfileField, string> = {
  fullName: "full name",
  gender: "gender",
  dateOfBirth: "date of birth",
  city: "city",
  state: "state",
};
