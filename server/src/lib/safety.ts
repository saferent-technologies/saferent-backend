import { z } from "zod";

/** Safety & emergency information: pure schema and helpers (unit tested in test/safety.test.ts). */

export const SAFETY_CERTIFICATES = ["STRUCTURAL_SAFETY_CERTIFICATE", "FIRE_NOC", "OCCUPANCY_CERTIFICATE"] as const;

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => /^\+?\d{3,15}$/.test(v), "Enter a valid phone number.");
const optText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal("").transform(() => null));
const optBool = z.boolean().nullable().optional();
const place = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: phone.nullable().optional(),
    address: optText(255),
    distanceKm: z.coerce.number().min(0).max(200).nullable().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  })
  .strict();

/** PUT /properties/:id/safety — the whole object (null / omitted = not answered). */
export const safetySchema = z
  .object({
    fireExtinguisher: optBool,
    fireExtinguisherCount: z.coerce.number().int().min(1).max(500).nullable().optional(),
    fireExtinguisherExpiry: z.coerce.date().nullable().optional().or(z.literal("").transform(() => null)),
    smokeDetectors: optBool,
    smokeDetectorLocations: optText(200),
    emergencyExits: z.coerce.number().int().min(0).max(50).nullable().optional(),
    emergencyStaircase: optBool,
    firstAidKit: optBool,
    firstAidLocation: optText(120),
    securityName: optText(120),
    securityPhone: phone.nullable().optional().or(z.literal("").transform(() => null)),
    security24x7: optBool,
    emergencyContacts: z.array(z.object({ label: z.string().trim().min(2).max(60), phone }).strict()).max(6).nullable().optional(),
    nearestHospital: place.nullable().optional(),
    nearestPoliceStation: place.nullable().optional(),
    instructions: optText(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.fireExtinguisher !== true && (v.fireExtinguisherCount != null || v.fireExtinguisherExpiry != null)) issue("fireExtinguisher", "Choose that there is a fire extinguisher to add its count or expiry.");
    if (v.fireExtinguisher === true && !v.fireExtinguisherExpiry) issue("fireExtinguisherExpiry", "Enter the fire extinguisher's expiry / refill date.");
    if (v.smokeDetectors !== true && v.smokeDetectorLocations) issue("smokeDetectorLocations", "Choose that there are smoke detectors first.");
    if (v.firstAidKit !== true && v.firstAidLocation) issue("firstAidLocation", "Choose that there is a first aid kit first.");
    if (v.securityPhone && !v.securityName) issue("securityName", "Enter the security person's or agency's name.");
  });
export type SafetyInput = z.infer<typeof safetySchema>;

/** Extinguisher state on a day: VALID, EXPIRING (≤ 30 days), EXPIRED, or null when there is none / no date. */
export function extinguisherState(has: boolean | null | undefined, expiry: Date | null | undefined, now = new Date()): "VALID" | "EXPIRING" | "EXPIRED" | null {
  if (!has || !expiry) return null;
  const days = Math.floor((expiry.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
  if (days < 0) return "EXPIRED";
  return days <= 30 ? "EXPIRING" : "VALID";
}

/** How complete the safety section is (0–100), for the owner's checklist. */
export function safetyScore(v: Partial<SafetyInput> | null): number {
  if (!v) return 0;
  const checks = [v.fireExtinguisher != null, v.smokeDetectors != null, v.emergencyExits != null, v.emergencyStaircase != null, v.firstAidKit != null, !!v.securityPhone || v.security24x7 === false, !!v.emergencyContacts?.length, !!v.nearestHospital, !!v.nearestPoliceStation, !!v.instructions];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
