import { describe, expect, it } from "vitest";
import {
  bedAssignSchema,
  chargeSchema,
  createPropertySchema,
  duplexFloorsSchema,
  inspectionCreateSchema,
  policiesSchema,
  policyProblems,
  pricingSchema,
  reviewSchema,
  roomSchema,
  statusChangeSchema,
  utilitiesSchema,
  utilityProblems,
} from "../src/properties/schemas";

describe("property creation input", () => {
  it("never accepts an owner, role or code from the client", () => {
    expect(createPropertySchema.safeParse({ propertyTypeKey: "APARTMENT", ownerId: "x" }).success).toBe(false);
    expect(createPropertySchema.safeParse({ propertyTypeKey: "APARTMENT", code: "SR-PROP-000009" }).success).toBe(false);
    expect(createPropertySchema.safeParse({ propertyTypeKey: "APARTMENT", role: "SUPER_ADMIN" }).success).toBe(false);
    expect(createPropertySchema.parse({ propertyTypeKey: "APARTMENT" }).listingType).toBe("RENT");
  });
});

describe("electricity and utility validation", () => {
  it("accepts explicit NOT_APPLICABLE / NOT_DISCLOSED values", () => {
    expect(utilitiesSchema.safeParse({ separateElectricityMeter: "NOT_DISCLOSED", gasConnectionType: "NOT_DISCLOSED", internetAvailable: "NOT_APPLICABLE" }).success).toBe(true);
    expect(utilitiesSchema.safeParse({ separateElectricityMeter: "MAYBE" }).success).toBe(false);
  });

  it("rejects contradictory electricity details", () => {
    expect(utilityProblems({ electricityBillingType: "INCLUDED_IN_RENT", electricityIncludedInRent: "NO" })).toHaveLength(1);
    expect(utilityProblems({ electricityBillingType: "ACTUAL_BILL", electricityIncludedInRent: "YES" })).toHaveLength(1);
    expect(utilityProblems({ electricityBillingType: "INCLUDED_IN_RENT", electricityRatePerUnit: 8 })).toHaveLength(1);
    expect(utilityProblems({ meterNumber: "123", separateElectricityMeter: "NO" })).toHaveLength(1);
    expect(utilityProblems({ meterNumber: "123", separateElectricityMeter: "YES", electricityBillingType: "ACTUAL_BILL", electricityRatePerUnit: 8, electricityIncludedInRent: "NO" })).toEqual([]);
  });

  it("requires an amount for fixed water charges and forbids it otherwise", () => {
    expect(utilityProblems({ waterChargesType: "FIXED_MONTHLY" })).toHaveLength(1);
    expect(utilityProblems({ waterChargesType: "FIXED_MONTHLY", waterChargesAmount: "300.00" })).toEqual([]);
    expect(utilityProblems({ waterChargesType: "INCLUDED_IN_RENT", waterChargesAmount: "300.00" })).toHaveLength(1);
    expect(utilityProblems({ waterChargesType: "NOT_DISCLOSED", waterChargesAmount: "300.00" })).toHaveLength(1);
  });

  it("rejects internet charges when internet is not available", () => {
    expect(utilityProblems({ internetAvailable: "NOT_DISCLOSED", internetCharges: "500.00" })).toHaveLength(1);
    expect(utilityProblems({ internetAvailable: "YES", internetCharges: "500.00" })).toEqual([]);
  });

  it("limits the electricity rate per unit", () => {
    expect(utilitiesSchema.safeParse({ electricityRatePerUnit: 500 }).success).toBe(false);
    expect(utilitiesSchema.safeParse({ electricityRatePerUnit: -1 }).success).toBe(false);
  });
});

describe("guest policy validation", () => {
  it("rejects overnight guests when guests are not allowed", () => {
    expect(policyProblems({ guestsAllowed: "NO", overnightGuestsAllowed: "YES" })).toHaveLength(1);
    expect(policyProblems({ guestsAllowed: "YES", overnightGuestsAllowed: "YES", maximumGuestStayDays: 3 })).toEqual([]);
  });
  it("only allows a maximum stay with overnight guests, and guest charges with an amount", () => {
    expect(policyProblems({ overnightGuestsAllowed: "NOT_DISCLOSED", maximumGuestStayDays: 3 })).toHaveLength(1);
    expect(policyProblems({ guestChargesApplicable: "YES" })).toHaveLength(1);
    expect(policyProblems({ guestChargesApplicable: "NO", guestChargeAmount: "100.00" })).toHaveLength(1);
  });
  it("stores custom restrictions as structured rules", () => {
    expect(policiesSchema.safeParse({ additionalRules: [{ title: "No loud music after 10 PM", description: "Quiet hours 10 PM–7 AM" }] }).success).toBe(true);
    expect(policiesSchema.safeParse({ additionalRules: [{ title: "x" }] }).success).toBe(false);
    expect(policiesSchema.safeParse({ petsAllowed: "SOMETIMES" }).success).toBe(false);
  });
});

describe("rent and deposit validation", () => {
  it("accepts a full pricing record with itemised charges", () => {
    const r = pricingSchema.safeParse({
      monthlyRent: 25000,
      securityDeposit: "100000",
      rentDueDay: 5,
      lockInPeriodMonths: 6,
      noticePeriodDays: 30,
      agreementChargesPaidBy: "SHARED",
      charges: [
        { kind: "MAINTENANCE", billing: "FIXED_MONTHLY", amount: 2500 },
        { kind: "ELECTRICITY", billing: "USAGE_BASED" },
        { kind: "WATER", billing: "INCLUDED_IN_RENT" },
        { kind: "PARKING", billing: "NOT_DISCLOSED" },
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.monthlyRent).toBe("25000.00");
  });

  it("rejects zero / negative rent, bad due days and invalid deposits", () => {
    expect(pricingSchema.safeParse({ monthlyRent: 0 }).success).toBe(false);
    expect(pricingSchema.safeParse({ monthlyRent: -5 }).success).toBe(false);
    expect(pricingSchema.safeParse({ securityDeposit: "1,00,000" }).success).toBe(false);
    expect(pricingSchema.safeParse({ rentDueDay: 31 }).success).toBe(false);
    expect(pricingSchema.safeParse({ currency: "USD" }).success).toBe(false);
  });

  it("requires amounts for fixed charges and never mixes amounts into included / undisclosed charges", () => {
    expect(chargeSchema.safeParse({ kind: "MAINTENANCE", billing: "FIXED_MONTHLY" }).success).toBe(false);
    expect(chargeSchema.safeParse({ kind: "MAINTENANCE", billing: "INCLUDED_IN_RENT", amount: 100 }).success).toBe(false);
    expect(chargeSchema.safeParse({ kind: "PARKING", billing: "NOT_DISCLOSED", amount: 100 }).success).toBe(false);
    expect(chargeSchema.safeParse({ kind: "OTHER", label: "Move-in cleaning", billing: "ONE_TIME", amount: 1500, frequency: "MONTHLY" }).success).toBe(false);
  });

  it("rejects the same charge listed twice", () => {
    expect(pricingSchema.safeParse({ charges: [{ kind: "MAINTENANCE", billing: "INCLUDED_IN_RENT" }, { kind: "MAINTENANCE", billing: "NOT_DISCLOSED" }] }).success).toBe(false);
  });
});

describe("workflow inputs", () => {
  it("requires a reason to reject or suspend", () => {
    expect(reviewSchema.safeParse({ decision: "REJECT" }).success).toBe(false);
    expect(reviewSchema.safeParse({ decision: "REJECT", reason: "Photos do not match the address." }).success).toBe(true);
    expect(reviewSchema.safeParse({ decision: "APPROVE" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ activeStatus: "SUSPENDED" }).success).toBe(false);
  });
  it("validates duplex floors and PG rooms", () => {
    expect(duplexFloorsSchema.safeParse({ floors: [{ floorNumber: 0, bedrooms: 1 }, { floorNumber: 0, bedrooms: 2 }] }).success).toBe(false);
    expect(duplexFloorsSchema.safeParse({ floors: [{ floorNumber: 0, bedrooms: 1, kitchens: 1 }, { floorNumber: 1, bedrooms: 2 }] }).success).toBe(true);
    expect(roomSchema.safeParse({ roomNumber: "203", sharingType: "CUSTOM" }).success).toBe(false);
    expect(roomSchema.safeParse({ roomNumber: "203", sharingType: "TRIPLE", rentPerBed: 7000 }).success).toBe(true);
    expect(bedAssignSchema.safeParse({ tenantId: "not-a-uuid" }).success).toBe(false);
  });
  it("ties move-in / move-out inspections to a lease", () => {
    expect(inspectionCreateSchema.safeParse({ type: "MOVE_IN", scheduledAt: "2026-12-01T10:00:00Z" }).success).toBe(false);
    expect(inspectionCreateSchema.safeParse({ type: "ROUTINE", scheduledAt: "2026-12-01T10:00:00Z" }).success).toBe(true);
  });
});
