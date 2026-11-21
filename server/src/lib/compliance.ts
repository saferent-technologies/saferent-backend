import { z } from "zod";

/** India compliance details: pure schemas and helpers (unit tested in test/compliance.test.ts). */

export const OWNERSHIP_DECLARATION = {
  version: "v1",
  text: "I declare that I am the legal owner of this property, or I am authorized by the owner to rent it out, and that the details and documents I have given are true. I understand that false information can lead to the listing being removed and to legal action.",
} as const;

export const TAX_STATUSES = ["PAID", "PENDING", "NOT_APPLICABLE"] as const;
export const AGREEMENT_TYPES = ["REGISTERED", "NOTARIZED", "E_STAMP", "UNREGISTERED"] as const;
export const POLICE_STATUSES = ["NOT_STARTED", "SUBMITTED", "VERIFIED", "NOT_REQUIRED"] as const;

/** Documents that matter for compliance, and when they apply. */
export const COMPLIANCE_DOCUMENTS = [
  { docType: "PROPERTY_TAX_RECEIPT", label: "Property tax receipt", applies: "ALL" },
  { docType: "BUILDING_PERMISSION", label: "Building approval", applies: "BUILDINGS" },
  { docType: "OCCUPANCY_CERTIFICATE", label: "Occupancy certificate", applies: "BUILDINGS" },
  { docType: "FIRE_NOC", label: "Fire NOC", applies: "BUILDINGS" },
  { docType: "TRADE_LICENSE", label: "Trade license", applies: "COMMERCIAL" },
  { docType: "SOCIETY_NOC", label: "Society NOC / permission", applies: "SOCIETY" },
] as const;

const optText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal("").transform(() => null));
const fy = z.string().trim().regex(/^\d{4}-\d{2}$/, "Use the financial year like 2025-26.").refine((v) => Number(v.slice(5)) === (Number(v.slice(2, 4)) + 1) % 100, "Use the financial year like 2025-26.");
const pastDate = z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86_400_000, "The date can't be in the future.");

/** PUT /properties/:id/compliance (send the whole object). */
export const complianceSchema = z
  .object({
    assessmentNumber: optText(60),
    propertyTaxStatus: z.enum(TAX_STATUSES).nullable().optional(),
    propertyTaxPaidYear: fy.nullable().optional().or(z.literal("").transform(() => null)),
    propertyTaxAmount: z.coerce.number().min(0).max(100_000_000).nullable().optional(),
    buildingApprovalNumber: optText(80),
    buildingApprovalAuthority: optText(120),
    buildingApprovalDate: pastDate.nullable().optional().or(z.literal("").transform(() => null)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.propertyTaxStatus === "PAID" && !v.propertyTaxPaidYear) ctx.addIssue({ code: "custom", path: ["propertyTaxPaidYear"], message: "Enter the year the tax was paid for (like 2025-26)." });
    if (v.propertyTaxStatus !== "PAID" && (v.propertyTaxPaidYear || v.propertyTaxAmount != null)) ctx.addIssue({ code: "custom", path: ["propertyTaxStatus"], message: "Choose Paid to add the year and amount." });
    if ((v.buildingApprovalAuthority || v.buildingApprovalDate) && !v.buildingApprovalNumber) ctx.addIssue({ code: "custom", path: ["buildingApprovalNumber"], message: "Enter the approval / permit number." });
  });

export const declarationSchema = z.object({ accepted: z.literal(true, { message: "Tick the declaration to continue." }), version: z.literal(OWNERSHIP_DECLARATION.version, { message: "The declaration text changed. Reload and read it again." }) }).strict();

/** Agreement details (landlord side) and police verification (landlord or tenant) on a lease. */
export const leaseComplianceSchema = z
  .object({
    agreementType: z.enum(AGREEMENT_TYPES).nullable().optional(),
    agreementRegistrationNumber: optText(80),
    agreementOffice: optText(120),
    agreementDate: pastDate.nullable().optional().or(z.literal("").transform(() => null)),
    stampDutyAmount: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
    policeVerificationStatus: z.enum(POLICE_STATUSES).nullable().optional(),
    policeVerificationRef: optText(80),
    policeVerificationSubmittedOn: pastDate.nullable().optional().or(z.literal("").transform(() => null)),
    policeVerificationVerifiedOn: pastDate.nullable().optional().or(z.literal("").transform(() => null)),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.agreementType === "REGISTERED" && !v.agreementRegistrationNumber) issue("agreementRegistrationNumber", "Enter the registration (document) number.");
    if (v.agreementType === "E_STAMP" && !v.agreementRegistrationNumber) issue("agreementRegistrationNumber", "Enter the e-stamp certificate number.");
    if (v.policeVerificationStatus === "VERIFIED" && !v.policeVerificationVerifiedOn) issue("policeVerificationVerifiedOn", "Enter the date it was verified.");
    if (v.policeVerificationSubmittedOn && v.policeVerificationVerifiedOn && v.policeVerificationVerifiedOn < v.policeVerificationSubmittedOn) issue("policeVerificationVerifiedOn", "Verified date must be after the submitted date.");
  });
export const POLICE_FIELDS = ["policeVerificationStatus", "policeVerificationRef", "policeVerificationSubmittedOn", "policeVerificationVerifiedOn"] as const;

/** Which compliance documents apply to a property. */
export function applicableDocuments(category: string, structure: string) {
  return COMPLIANCE_DOCUMENTS.filter((d) => {
    if (d.applies === "ALL") return true;
    if (d.applies === "COMMERCIAL") return category === "COMMERCIAL";
    // Apartments / societies (several flats, PG buildings).
    if (d.applies === "SOCIETY") return category === "RESIDENTIAL" && (structure === "MULTI_UNIT" || structure === "ROOMS_BEDS");
    // Building approval, OC, fire NOC: any built property except land.
    return category !== "LAND";
  });
}

/** Expiry state of a document on a day. */
export function expiryState(expiry: Date | null | undefined, now = new Date()): "VALID" | "EXPIRING" | "EXPIRED" | null {
  if (!expiry) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.floor((expiry.getTime() - today) / 86_400_000);
  return days < 0 ? "EXPIRED" : days <= 30 ? "EXPIRING" : "VALID";
}
