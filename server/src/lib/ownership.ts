import { z } from "zod";

/** Owner details + property ownership: pure schemas / rules (unit tested in test/ownership.test.ts). */

export const LANGUAGES = ["en", "te", "hi", "ta", "kn", "ml", "mr", "bn", "gu", "ur", "or", "pa"] as const;
export const CONTACT_METHODS = ["CALL", "SMS", "WHATSAPP", "EMAIL", "IN_APP"] as const;
export const OWNER_TYPES = ["INDIVIDUAL", "JOINT", "COMPANY"] as const;
export const OWNERSHIP_TYPES = ["SOLE", "JOINT"] as const;
export const AUTHORITY_TYPES = ["POWER_OF_ATTORNEY", "BOARD_RESOLUTION", "AUTHORIZATION_LETTER", "OTHER"] as const;

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => /^\+?[1-9]\d{9,14}$/.test(v), "Enter a valid phone number.");
const optionalPhone = phone.nullable().optional().or(z.literal("").transform(() => null));
const text = (max: number) => z.string().trim().min(2).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal("").transform(() => null));
const percent = z.coerce.number().gt(0, "Share must be more than 0%.").max(100).multipleOf(0.01, "Use at most 2 decimals.");

/** PUT /landlord/owner-details (partial: send only what changes; null clears). */
export const ownerDetailsSchema = z
  .object({
    alternatePhone: optionalPhone,
    address: optionalText(255),
    city: optionalText(80),
    state: optionalText(80),
    pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code.").nullable().optional().or(z.literal("").transform(() => null)),
    preferredLanguage: z.enum(LANGUAGES).nullable().optional(),
    preferredContactMethod: z.enum(CONTACT_METHODS).nullable().optional(),
    emergencyContactName: optionalText(120),
    emergencyContactPhone: optionalPhone,
    emergencyContactRelation: optionalText(40),
  })
  .strict();

const personSchema = z.object({ name: text(120), phone: optionalPhone, email: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal("").transform(() => null)), relation: optionalText(40) });

/** PUT /properties/:id/ownership */
export const ownershipSchema = z
  .object({
    ownerType: z.enum(OWNER_TYPES),
    ownershipType: z.enum(OWNERSHIP_TYPES),
    companyName: optionalText(150),
    ownerSharePercent: percent.nullable().optional(),
    coOwners: z.array(personSchema.extend({ sharePercent: percent })).max(10).optional().default([]),
    representative: personSchema.extend({ phone, relation: text(40), authorityType: z.enum(AUTHORITY_TYPES) }).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.ownerType === "INDIVIDUAL" && v.ownershipType !== "SOLE") issue("ownershipType", "An individual owner is the sole owner. Choose Joint owners for shared ownership.");
    if (v.ownerType === "JOINT" && v.ownershipType !== "JOINT") issue("ownershipType", "Joint owners means joint ownership.");
    if (v.ownerType === "COMPANY" && !v.companyName) issue("companyName", "Enter the company name.");
    if (v.ownerType === "COMPANY" && !v.representative) issue("representative", "Add the company's authorized representative.");
    if (v.ownershipType === "SOLE" && v.coOwners.length) issue("coOwners", "Sole ownership has no co-owners.");
    if (v.ownershipType === "JOINT") {
      if (!v.coOwners.length) issue("coOwners", "Add the other owners and their shares.");
      if (v.ownerSharePercent == null) issue("ownerSharePercent", "Enter your share of the property (%).");
      const total = Math.round(((v.ownerSharePercent ?? 0) + v.coOwners.reduce((a, c) => a + c.sharePercent, 0)) * 100) / 100;
      if (total !== 100) issue("coOwners", `Shares must add up to 100% (now ${total}%).`);
    }
  });

export type OwnershipInput = z.infer<typeof ownershipSchema>;
