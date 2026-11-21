import { describe, expect, it } from "vitest";
import { applicableDocuments, complianceSchema, declarationSchema, expiryState, leaseComplianceSchema } from "../src/lib/compliance";

describe("india compliance", () => {
  it("property tax and approvals", () => {
    expect(complianceSchema.safeParse({ assessmentNumber: "1234-567-890", propertyTaxStatus: "PAID", propertyTaxPaidYear: "2025-26", propertyTaxAmount: 4200 }).success).toBe(true);
    expect(complianceSchema.safeParse({ propertyTaxStatus: "PAID" }).success).toBe(false);
    expect(complianceSchema.safeParse({ propertyTaxStatus: "PAID", propertyTaxPaidYear: "2025-27" }).success).toBe(false);
    expect(complianceSchema.safeParse({ propertyTaxStatus: "PENDING", propertyTaxAmount: 10 }).success).toBe(false);
    expect(complianceSchema.safeParse({ buildingApprovalAuthority: "GHMC" }).success).toBe(false);
  });
  it("declaration must be ticked with the current version", () => {
    expect(declarationSchema.safeParse({ accepted: true, version: "v1" }).success).toBe(true);
    expect(declarationSchema.safeParse({ accepted: false, version: "v1" }).success).toBe(false);
    expect(declarationSchema.safeParse({ accepted: true, version: "v0" }).success).toBe(false);
  });
  it("agreement and police verification", () => {
    expect(leaseComplianceSchema.safeParse({ agreementType: "REGISTERED", agreementRegistrationNumber: "1234/2026", agreementOffice: "SRO Madhapur" }).success).toBe(true);
    expect(leaseComplianceSchema.safeParse({ agreementType: "REGISTERED" }).success).toBe(false);
    expect(leaseComplianceSchema.safeParse({ policeVerificationStatus: "VERIFIED" }).success).toBe(false);
    expect(leaseComplianceSchema.safeParse({ policeVerificationStatus: "VERIFIED", policeVerificationSubmittedOn: "2026-11-10", policeVerificationVerifiedOn: "2026-11-01" }).success).toBe(false);
  });
  it("applicable documents and expiry", () => {
    expect(applicableDocuments("COMMERCIAL", "MULTI_UNIT").map((d) => d.docType)).toContain("TRADE_LICENSE");
    expect(applicableDocuments("RESIDENTIAL", "SINGLE_UNIT").map((d) => d.docType)).not.toContain("SOCIETY_NOC");
    expect(applicableDocuments("LAND", "SINGLE_UNIT").map((d) => d.docType)).toEqual(["PROPERTY_TAX_RECEIPT"]);
    const now = new Date("2026-11-21T10:00:00Z");
    expect(expiryState(new Date("2026-11-20"), now)).toBe("EXPIRED");
    expect(expiryState(new Date("2026-12-01"), now)).toBe("EXPIRING");
    expect(expiryState(null, now)).toBeNull();
  });
});
