/**
 * Request schemas for the property APIs (pure — unit tested). Every body and query is validated here
 * before it reaches the database. Clients never send owner ids, roles, codes or statuses they are
 * not allowed to change.
 */
import { z } from "zod";
import {
  ACTIVE_STATUSES,
  AVAILABILITY,
  CATEGORIES,
  DISCLOSURE,
  DOCUMENT_TYPES,
  IMAGE_CATEGORIES,
  LISTING_TYPES,
  PUBLICATION_STATUSES,
  SHARING_TYPES,
  VERIFICATION_STATUSES,
} from "./catalog";
import { bigMoneySchema, decimalSchema, moneySchema } from "./fields";

const disclosure = z.enum(DISCLOSURE);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const optInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max).nullable().optional();
const optMoney = moneySchema.nullable().optional();
export const versionField = z.coerce.number().int().min(1).optional();

export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Phone number must be in E.164 format, e.g. +919876543210.");

// ───── Property ─────

export const createPropertySchema = z
  .object({
    propertyTypeKey: z.string().trim().min(2).max(40),
    category: z.enum(CATEGORIES).optional(),
    listingType: z.enum(LISTING_TYPES).default("RENT"),
    title: z.string().trim().min(3).max(150).optional(),
    /** Staff / agents creating a listing for a registered landlord. Ignored for landlords. */
    landlordPhone: phoneSchema.optional(),
  })
  .strict();

export const updatePropertySchema = z
  .object({
    version: versionField,
    listingType: z.enum(LISTING_TYPES).optional(),
    title: z.string().trim().min(3).max(150).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    addressLine: optText(255),
    locality: optText(120),
    city: optText(80),
    state: optText(80),
    country: z.string().trim().min(2).max(60).optional(),
    pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code.").nullable().optional(),
    // Stored with 6 decimals (≈ 10 cm); GPS values with more digits are rounded.
    latitude: decimalSchema(-90, 90).transform((v) => Number(v.toFixed(6))).nullable().optional(),
    longitude: decimalSchema(-180, 180).transform((v) => Number(v.toFixed(6))).nullable().optional(),
    wizardStep: z.coerce.number().int().min(1).max(12).optional(),
    /** Type-specific building fields (validated against the property type definition). */
    building: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const listPropertiesQuery = z.object({
  publicationStatus: z.enum(PUBLICATION_STATUSES).optional(),
  activeStatus: z.enum(ACTIVE_STATUSES).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  propertyType: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  ownerId: z.string().uuid().optional(),
  sort: z.enum(["updated", "created", "title", "completeness"]).default("updated"),
  includeArchived: z.enum(["true", "false"]).optional(),
});

export const browseQuery = z.object({
  city: z.string().trim().max(80).optional(),
  category: z.enum(CATEGORIES).optional(),
  propertyType: z.string().trim().max(40).optional(),
  listingType: z.enum(LISTING_TYPES).optional(),
  minRent: z.coerce.number().min(0).optional(),
  maxRent: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(30).optional(),
  furnishing: z.enum(["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"]).optional(),
  availableOnly: z.enum(["true", "false"]).default("true"),
  sort: z.enum(["newest", "rent_asc", "rent_desc", "completeness"]).default("newest"),
});

export const reviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === "REJECT" && (!v.reason || v.reason.length < 5)) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason (at least 5 characters) when rejecting." });
    }
  });

export const statusChangeSchema = z
  .object({
    activeStatus: z.enum(ACTIVE_STATUSES),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.activeStatus === "SUSPENDED" && (!v.reason || v.reason.length < 5)) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason when suspending a property." });
    }
  });

export const transferOwnershipSchema = z.object({ newOwnerId: z.string().uuid(), reason: z.string().trim().min(5).max(500) }).strict();

// ───── Units ─────

export const duplexFloorSchema = z
  .object({
    floorNumber: z.coerce.number().int().min(-2).max(10),
    label: optText(40),
    bedrooms: z.coerce.number().int().min(0).max(20).default(0),
    bathrooms: z.coerce.number().int().min(0).max(20).default(0),
    kitchens: z.coerce.number().int().min(0).max(5).default(0),
    livingRooms: z.coerce.number().int().min(0).max(10).default(0),
    balconies: z.coerce.number().int().min(0).max(20).default(0),
    additionalDetails: optText(500),
  })
  .strict();

export const duplexFloorsSchema = z
  .object({ version: versionField, floors: z.array(duplexFloorSchema).min(1).max(10) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<number>();
    v.floors.forEach((fl, i) => {
      if (seen.has(fl.floorNumber)) ctx.addIssue({ code: "custom", path: ["floors", i, "floorNumber"], message: `Floor ${fl.floorNumber} is listed twice.` });
      seen.add(fl.floorNumber);
    });
  });

// ───── PG rooms & beds ─────

export const roomSchema = z
  .object({
    version: versionField,
    roomNumber: z.string().trim().min(1).max(30),
    floorNumber: optInt(-5, 200),
    sharingType: z.enum(SHARING_TYPES),
    customSharing: optInt(1, 50),
    attachedBathroom: disclosure.optional(),
    acAvailable: disclosure.optional(),
    rentPerBed: optMoney,
    securityDeposit: optMoney,
    availabilityStatus: z.enum(AVAILABILITY).optional(),
    /** Create this many beds (B1, B2 …) together with the room. Defaults to the sharing type. */
    createBeds: optInt(0, 50),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.sharingType === "CUSTOM" && !v.customSharing) ctx.addIssue({ code: "custom", path: ["customSharing"], message: "Enter the number of people sharing for a custom room." });
  });

export const roomUpdateSchema = z
  .object({
    version: versionField,
    roomNumber: z.string().trim().min(1).max(30).optional(),
    floorNumber: optInt(-5, 200),
    sharingType: z.enum(SHARING_TYPES).optional(),
    customSharing: optInt(1, 50),
    attachedBathroom: disclosure.optional(),
    acAvailable: disclosure.optional(),
    rentPerBed: optMoney,
    securityDeposit: optMoney,
    availabilityStatus: z.enum(AVAILABILITY).optional(),
    activeStatus: z.enum(ACTIVE_STATUSES).optional(),
  })
  .strict();

export const SHARING_BEDS: Record<(typeof SHARING_TYPES)[number], number> = { SINGLE: 1, DOUBLE: 2, TRIPLE: 3, FOUR_SHARING: 4, CUSTOM: 0 };

export const bedSchema = z
  .object({
    bedNumber: z.string().trim().min(1).max(20),
    rent: optMoney,
    availabilityStatus: z.enum(["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "NOT_AVAILABLE"]).optional(),
  })
  .strict();

export const bedUpdateSchema = z
  .object({
    version: versionField,
    bedNumber: z.string().trim().min(1).max(20).optional(),
    rent: optMoney,
    /** OCCUPIED is set only through tenant assignment. */
    availabilityStatus: z.enum(["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "NOT_AVAILABLE"]).optional(),
    activeStatus: z.enum(ACTIVE_STATUSES).optional(),
  })
  .strict();

export const bedAssignSchema = z.object({ tenantId: z.string().uuid(), leaseId: z.string().uuid().optional() }).strict();

// ───── Utilities ─────

export const utilitiesSchema = z
  .object({
    separateElectricityMeter: disclosure.optional(),
    meterNumber: optText(40),
    electricityBillingType: z.enum(["ACTUAL_BILL", "FIXED", "INCLUDED_IN_RENT", "NOT_APPLICABLE", "NOT_DISCLOSED"]).optional(),
    electricityRatePerUnit: decimalSchema(0, 100).nullable().optional(),
    meterPaymentType: z.enum(["PREPAID", "POSTPAID", "NOT_APPLICABLE", "NOT_DISCLOSED"]).optional(),
    electricityIncludedInRent: disclosure.optional(),
    meterReadingAtHandover: decimalSchema(0, 100_000_000).nullable().optional(),
    meterReadingImageId: z.string().uuid().nullable().optional(),
    separateWaterMeter: disclosure.optional(),
    waterSupplyType: z.enum(["MUNICIPAL", "BOREWELL", "TANKER", "MIXED", "NOT_APPLICABLE", "NOT_DISCLOSED"]).optional(),
    waterChargesType: z.enum(["INCLUDED_IN_RENT", "FIXED_MONTHLY", "USAGE_BASED", "ONE_TIME", "NOT_APPLICABLE", "NOT_DISCLOSED"]).optional(),
    waterChargesAmount: optMoney,
    waterIncludedInRent: disclosure.optional(),
    waterAvailability: optText(120),
    gasConnectionType: z.enum(["PIPED", "CYLINDER", "NONE", "NOT_DISCLOSED"]).optional(),
    internetAvailable: disclosure.optional(),
    internetCharges: optMoney,
    powerBackup: disclosure.optional(),
    generatorAvailable: disclosure.optional(),
    sewageFacilities: disclosure.optional(),
    wasteCollection: disclosure.optional(),
    notes: optText(1000),
  })
  .strict();

export type UtilitiesInput = z.infer<typeof utilitiesSchema>;

/**
 * Cross-field rules, applied to the MERGED record (stored values + update) so a partial update cannot
 * leave contradictory utility details. Returns human-readable problems.
 */
export function utilityProblems(u: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const billing = u.electricityBillingType;
  if (billing === "INCLUDED_IN_RENT" && u.electricityIncludedInRent === "NO") problems.push("Electricity is billed as included in rent, but 'included in rent' is set to NO.");
  if (u.electricityIncludedInRent === "YES" && (billing === "ACTUAL_BILL" || billing === "FIXED")) problems.push("Electricity cannot be both included in rent and billed separately.");
  if (u.electricityRatePerUnit !== null && u.electricityRatePerUnit !== undefined && billing !== "ACTUAL_BILL" && billing !== "FIXED") {
    problems.push("A per-unit electricity rate only applies when electricity is billed on actual usage or at a fixed rate.");
  }
  if (u.meterNumber && u.separateElectricityMeter !== "YES") problems.push("A meter number can only be given when there is a separate electricity meter.");
  if (u.meterPaymentType && u.meterPaymentType !== "NOT_DISCLOSED" && u.meterPaymentType !== "NOT_APPLICABLE" && u.separateElectricityMeter === "NO") {
    problems.push("Prepaid / postpaid only applies to a separate electricity meter.");
  }
  const water = u.waterChargesType;
  const hasWaterAmount = u.waterChargesAmount !== null && u.waterChargesAmount !== undefined;
  if ((water === "FIXED_MONTHLY" || water === "ONE_TIME") && !hasWaterAmount) problems.push("Enter the water charge amount for a fixed water charge.");
  if (hasWaterAmount && (water === "INCLUDED_IN_RENT" || water === "NOT_APPLICABLE" || water === "NOT_DISCLOSED" || water === undefined)) {
    problems.push("A water charge amount can only be given for fixed or usage-based water charges.");
  }
  if (water === "INCLUDED_IN_RENT" && u.waterIncludedInRent === "NO") problems.push("Water is charged as included in rent, but 'included in rent' is set to NO.");
  if (u.internetCharges !== null && u.internetCharges !== undefined && u.internetAvailable !== "YES") problems.push("Internet charges can only be given when internet is available.");
  return problems;
}

// ───── Policies ─────

export const policiesSchema = z
  .object({
    guestsAllowed: disclosure.optional(),
    overnightGuestsAllowed: disclosure.optional(),
    maximumGuestStayDays: optInt(1, 365),
    guestRegistrationRequired: disclosure.optional(),
    visitorTimingRestrictions: optText(255),
    landlordApprovalRequired: disclosure.optional(),
    guestParkingAvailable: disclosure.optional(),
    guestChargesApplicable: disclosure.optional(),
    guestChargeAmount: optMoney,
    petsAllowed: disclosure.optional(),
    smokingAllowed: disclosure.optional(),
    partiesAllowed: disclosure.optional(),
    loudMusicPolicy: optText(255),
    cookingAllowed: disclosure.optional(),
    sublettingAllowed: disclosure.optional(),
    workFromHomeAllowed: disclosure.optional(),
    additionalRules: z
      .array(z.object({ title: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default("") }).strict())
      .max(30)
      .nullable()
      .optional(),
  })
  .strict();

export function policyProblems(p: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (p.overnightGuestsAllowed === "YES" && p.guestsAllowed === "NO") problems.push("Overnight guests cannot be allowed when guests are not allowed.");
  if (p.maximumGuestStayDays !== null && p.maximumGuestStayDays !== undefined && p.overnightGuestsAllowed !== "YES") problems.push("A maximum guest stay only applies when overnight guests are allowed.");
  if (p.guestChargeAmount !== null && p.guestChargeAmount !== undefined && p.guestChargesApplicable !== "YES") problems.push("A guest charge amount needs 'guest charges applicable' set to YES.");
  if (p.guestChargesApplicable === "YES" && (p.guestChargeAmount === null || p.guestChargeAmount === undefined)) problems.push("Enter the guest charge amount.");
  return problems;
}

// ───── Amenities ─────

export const amenitiesSchema = z
  .object({
    unitId: z.string().uuid().optional(),
    items: z.array(z.object({ key: z.string().trim().min(2).max(40), status: disclosure.default("YES"), notes: optText(255) }).strict()).max(60).default([]),
    custom: z.array(z.object({ label: z.string().trim().min(2).max(60), status: disclosure.default("YES"), notes: optText(255) }).strict()).max(20).default([]),
  })
  .strict();

// ───── Pricing ─────

export const CHARGE_KINDS = ["MAINTENANCE", "ELECTRICITY", "WATER", "GAS", "PARKING", "INTERNET", "OTHER"] as const;
export const CHARGE_BILLING = ["INCLUDED_IN_RENT", "FIXED_MONTHLY", "USAGE_BASED", "ONE_TIME", "NOT_APPLICABLE", "NOT_DISCLOSED"] as const;
export const CHARGE_FREQUENCY = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY", "ONE_TIME"] as const;

export const chargeSchema = z
  .object({
    kind: z.enum(CHARGE_KINDS),
    label: z.string().trim().min(2).max(80).optional(),
    billing: z.enum(CHARGE_BILLING),
    amount: optMoney,
    frequency: z.enum(CHARGE_FREQUENCY).nullable().optional(),
    notes: optText(255),
  })
  .strict()
  .superRefine((c, ctx) => {
    const hasAmount = c.amount !== null && c.amount !== undefined;
    if ((c.billing === "FIXED_MONTHLY" || c.billing === "ONE_TIME") && !hasAmount) ctx.addIssue({ code: "custom", path: ["amount"], message: `Enter the amount for ${c.label ?? c.kind.toLowerCase()}.` });
    if (hasAmount && (c.billing === "INCLUDED_IN_RENT" || c.billing === "NOT_APPLICABLE" || c.billing === "NOT_DISCLOSED")) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: `${c.label ?? c.kind}: an amount cannot be given when the charge is ${c.billing.replace(/_/g, " ").toLowerCase()}.` });
    }
    if (c.billing === "ONE_TIME" && c.frequency && c.frequency !== "ONE_TIME") ctx.addIssue({ code: "custom", path: ["frequency"], message: "A one-time charge cannot have a recurring frequency." });
    if (c.billing === "FIXED_MONTHLY" && c.frequency === "ONE_TIME") ctx.addIssue({ code: "custom", path: ["frequency"], message: "Use billing ONE_TIME for one-time charges." });
  });

export const pricingSchema = z
  .object({
    currency: z.literal("INR").default("INR"),
    monthlyRent: optMoney,
    salePrice: bigMoneySchema.nullable().optional(),
    securityDeposit: optMoney,
    advanceRentMonths: optInt(0, 24),
    rentDueDay: optInt(1, 28),
    lateFeePolicy: optText(500),
    lockInPeriodMonths: optInt(0, 120),
    noticePeriodDays: optInt(0, 365),
    rentIncreasePolicy: optText(500),
    agreementCharges: optMoney,
    agreementChargesPaidBy: z.enum(["LANDLORD", "TENANT", "SHARED", "NOT_APPLICABLE", "NOT_DISCLOSED"]).optional(),
    refundPolicy: optText(5000),
    otherTerms: optText(5000),
    rentNegotiable: disclosure.optional(),
    /** Replaces the full list of charges when sent. */
    charges: z.array(chargeSchema).max(30).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.monthlyRent !== null && p.monthlyRent !== undefined && Number(p.monthlyRent) <= 0) ctx.addIssue({ code: "custom", path: ["monthlyRent"], message: "Monthly rent must be more than zero." });
    if (p.agreementCharges && p.agreementChargesPaidBy === "NOT_APPLICABLE") ctx.addIssue({ code: "custom", path: ["agreementChargesPaidBy"], message: "Say who pays the agreement charges." });
    const seen = new Set<string>();
    (p.charges ?? []).forEach((c, i) => {
      const key = `${c.kind}:${(c.label ?? c.kind).toLowerCase()}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["charges", i], message: `${c.label ?? c.kind} is listed twice.` });
      seen.add(key);
    });
  });

export type PricingInput = z.infer<typeof pricingSchema>;

// ───── Images, documents, inspections ─────

export const imageUploadSchema = z
  .object({
    category: z.enum(IMAGE_CATEGORIES).default("OTHER"),
    unitId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    /** Room number within the category (Bedroom 1, Bedroom 2 …). */
    slot: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict();

export const imageUpdateSchema = z
  .object({ category: z.enum(IMAGE_CATEGORIES).optional(), displayOrder: z.coerce.number().int().min(0).max(1000).optional() })
  .strict();

export const documentUploadSchema = z.object({ docType: z.enum(DOCUMENT_TYPES), unitId: z.string().uuid().optional() }).strict();

export const documentVerifySchema = z
  .object({ status: z.enum(["APPROVED", "REJECTED"]), rejectionReason: z.string().trim().max(500).optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === "REJECTED" && (!v.rejectionReason || v.rejectionReason.length < 5)) ctx.addIssue({ code: "custom", path: ["rejectionReason"], message: "Give a reason for rejecting the document." });
  });

const condition = z.enum(["GOOD", "FAIR", "POOR", "NOT_APPLICABLE", "NOT_INSPECTED"]);

export const inspectionCreateSchema = z
  .object({
    type: z.enum(["MOVE_IN", "MOVE_OUT", "ROUTINE", "VERIFICATION"]).default("ROUTINE"),
    scheduledAt: z.coerce.date(),
    unitId: z.string().uuid().optional(),
    roomId: z.string().uuid().optional(),
    bedId: z.string().uuid().optional(),
    leaseId: z.string().uuid().optional(),
    notes: optText(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.type === "MOVE_IN" || v.type === "MOVE_OUT") && !v.leaseId) ctx.addIssue({ code: "custom", path: ["leaseId"], message: "Move-in and move-out inspections belong to a lease." });
  });

export const inspectionUpdateSchema = z
  .object({
    status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
    inspectionDate: z.coerce.date().nullable().optional(),
    propertyCondition: condition.optional(),
    wallCondition: condition.optional(),
    doorsAndWindows: condition.optional(),
    electricalCondition: condition.optional(),
    plumbingCondition: condition.optional(),
    furnitureInventory: z
      .array(z.object({ item: z.string().trim().min(1).max(80), quantity: z.coerce.number().int().min(0).max(1000), condition: condition.default("NOT_INSPECTED") }).strict())
      .max(200)
      .nullable()
      .optional(),
    existingDamages: optText(5000),
    handoverMeterReading: decimalSchema(0, 100_000_000).nullable().optional(),
    keysHandedOver: optInt(0, 100),
    result: z.enum(["PASSED", "NEEDS_REPAIRS", "FAILED"]).nullable().optional(),
    notes: optText(5000),
  })
  .strict();

export const assignmentSchema = z.object({ userId: z.string().uuid(), type: z.enum(["MANAGER", "AGENT"]) }).strict();

export const applySchema = z
  .object({
    unitId: z.string().uuid().optional(),
    bedId: z.string().uuid().optional(),
    message: z.string().trim().max(1000).optional(),
    proposedMoveIn: z.coerce.date(),
    occupants: z.coerce.number().int().min(1).max(20).default(1),
  })
  .strict();
