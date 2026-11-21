import { z } from "zod";

/** Society / association details: pure schemas (unit tested in test/society.test.ts). */

export const CONTACT_ROLES = ["SECRETARY", "PRESIDENT", "MANAGER", "FACILITY_MANAGER", "OTHER"] as const;
export const FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const;
export const MAINTENANCE_PAID_BY = ["INCLUDED_IN_RENT", "TENANT", "OWNER"] as const;
export const PAY_TO = ["SOCIETY", "OWNER"] as const;
export const GATE_METHODS = ["MYGATE", "NOBROKERHOOD", "ADDA", "APNACOMPLEX", "ACCESS_CARD", "BIOMETRIC", "GUARD_REGISTER", "OTHER"] as const;
export const APPROVAL_STATUSES = ["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED"] as const;
export const VEHICLE_TYPES = ["CAR", "BIKE", "BOTH"] as const;

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => /^\+?\d{3,15}$/.test(v), "Enter a valid phone number.");
const optPhone = phone.nullable().optional().or(z.literal("").transform(() => null));
const optText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal("").transform(() => null));
const money = z.coerce.number().min(0).max(10_000_000).multipleOf(0.01);

/** PUT /properties/:id/society — the whole object. */
export const societySchema = z
  .object({
    isSociety: z.boolean().default(true),
    associationName: optText(150),
    registrationNumber: optText(60),
    contactName: optText(120),
    contactRole: z.enum(CONTACT_ROLES).nullable().optional(),
    contactPhone: optPhone,
    contactEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional().or(z.literal("").transform(() => null)),
    officeHours: optText(120),
    maintenanceAmount: money.nullable().optional(),
    maintenanceFrequency: z.enum(FREQUENCIES).nullable().optional(),
    maintenancePaidBy: z.enum(MAINTENANCE_PAID_BY).nullable().optional(),
    maintenancePayTo: z.enum(PAY_TO).nullable().optional(),
    rules: z.array(z.object({ title: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default("") }).strict()).max(30).nullable().optional(),
    visitorPolicy: optText(1000),
    gateAccessMethods: z
      .array(z.enum(GATE_METHODS))
      .max(GATE_METHODS.length)
      .refine((x) => new Set(x).size === x.length, "List each method once.")
      .nullable()
      .optional(),
    gateContactName: optText(120),
    gateContactPhone: optPhone,
    clubhouseRules: optText(1000),
    commonAreas: z.array(z.object({ name: z.string().trim().min(2).max(60), timings: z.string().trim().min(2).max(80), notes: optText(200) }).strict()).max(15).nullable().optional(),
    moveRequiresPermission: z.boolean().nullable().optional(),
    moveNoticeDays: z.coerce.number().int().min(0).max(60).nullable().optional(),
    moveAllowedTimings: optText(120),
    moveChargeAmount: money.nullable().optional(),
    moveDepositAmount: money.nullable().optional(),
    moveLiftBooking: z.boolean().nullable().optional(),
    moveNotes: optText(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.maintenanceAmount != null && !v.maintenanceFrequency) issue("maintenanceFrequency", "Choose how often maintenance is paid.");
    if (v.maintenancePaidBy === "TENANT" && !v.maintenancePayTo) issue("maintenancePayTo", "Choose who the tenant pays maintenance to.");
    if (v.maintenancePaidBy !== "TENANT" && v.maintenancePayTo) issue("maintenancePayTo", "Only needed when the tenant pays maintenance.");
    if (v.contactPhone && !v.contactName) issue("contactName", "Enter the contact person's name.");
    if (v.gateContactPhone && !v.gateContactName) issue("gateContactName", "Enter a name for the gate contact (e.g. Main gate security).");
    if (v.moveRequiresPermission === false && (v.moveNoticeDays != null || v.moveChargeAmount != null || v.moveDepositAmount != null)) issue("moveRequiresPermission", "Choose that the society's permission is needed to add notice, charges or deposit.");
  });
export type SocietyInput = z.infer<typeof societySchema>;

export const parkingSlotSchema = z
  .object({
    slotNumber: z.string().trim().min(1).max(20),
    unitId: z.string().uuid().nullable().optional(),
    vehicleType: z.enum(VEHICLE_TYPES).default("CAR"),
    covered: z.boolean().default(false),
    notes: optText(200),
  })
  .strict();
export const parkingSlotUpdateSchema = parkingSlotSchema.partial().strict();

export const approvalSchema = z
  .object({
    status: z.enum(APPROVAL_STATUSES),
    date: z.coerce.date().nullable().optional().or(z.literal("").transform(() => null)),
    note: optText(300),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.status === "APPROVED" || v.status === "REJECTED") && !v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Enter the date of the society's decision." });
    if (v.status === "REJECTED" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Add the society's reason." });
  });

/** Monthly equivalent of the maintenance amount (for comparing listings). */
export function monthlyMaintenance(amount: number | null | undefined, frequency: string | null | undefined): number | null {
  if (amount == null || !frequency) return null;
  const months = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }[frequency as (typeof FREQUENCIES)[number]];
  return months ? Math.round((amount / months) * 100) / 100 : null;
}
