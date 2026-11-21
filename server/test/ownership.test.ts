import { describe, expect, it } from "vitest";
import { ownerDetailsSchema, ownershipSchema } from "../src/lib/ownership";

const ok = (v: unknown) => ownershipSchema.safeParse(v).success;
const rep = { name: "Suresh Rao", phone: "+919876543210", relation: "Son", authorityType: "POWER_OF_ATTORNEY" };

describe("property ownership", () => {
  it("individual owner is sole, no co-owners", () => {
    expect(ok({ ownerType: "INDIVIDUAL", ownershipType: "SOLE" })).toBe(true);
    expect(ok({ ownerType: "INDIVIDUAL", ownershipType: "JOINT" })).toBe(false);
    expect(ok({ ownerType: "INDIVIDUAL", ownershipType: "SOLE", coOwners: [{ name: "A B", sharePercent: 50 }] })).toBe(false);
  });
  it("joint owners: shares add up to 100", () => {
    expect(ok({ ownerType: "JOINT", ownershipType: "JOINT", ownerSharePercent: 50, coOwners: [{ name: "Lakshmi", sharePercent: 50 }] })).toBe(true);
    expect(ok({ ownerType: "JOINT", ownershipType: "JOINT", ownerSharePercent: 33.33, coOwners: [{ name: "A A", sharePercent: 33.33 }, { name: "B B", sharePercent: 33.34 }] })).toBe(true);
    expect(ok({ ownerType: "JOINT", ownershipType: "JOINT", ownerSharePercent: 60, coOwners: [{ name: "Lakshmi", sharePercent: 50 }] })).toBe(false);
    expect(ok({ ownerType: "JOINT", ownershipType: "JOINT", ownerSharePercent: 100 })).toBe(false);
  });
  it("company needs a name and an authorized representative", () => {
    expect(ok({ ownerType: "COMPANY", ownershipType: "SOLE", companyName: "Rao Estates Pvt Ltd", representative: { ...rep, authorityType: "BOARD_RESOLUTION" } })).toBe(true);
    expect(ok({ ownerType: "COMPANY", ownershipType: "SOLE", companyName: "Rao Estates Pvt Ltd" })).toBe(false);
    expect(ok({ ownerType: "COMPANY", ownershipType: "SOLE", representative: rep })).toBe(false);
  });
  it("owner details: language, contact method, phones", () => {
    expect(ownerDetailsSchema.safeParse({ preferredLanguage: "te", preferredContactMethod: "WHATSAPP", alternatePhone: "98765 43210", emergencyContactPhone: "+919876543210" }).success).toBe(true);
    expect(ownerDetailsSchema.safeParse({ preferredLanguage: "xx" }).success).toBe(false);
    expect(ownerDetailsSchema.safeParse({ alternatePhone: "123" }).success).toBe(false);
    expect(ownerDetailsSchema.safeParse({ unknownField: 1 }).success).toBe(false);
  });
});
