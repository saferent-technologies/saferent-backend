import { describe, expect, it } from "vitest";
import { DEFAULT_COMPLETENESS_WEIGHTS, propertyTypeDef } from "../src/properties/catalog";
import { computeCompleteness, parseWeights, submissionProblems, type CompletenessInput } from "../src/properties/completeness";
import { costBreakdown } from "../src/properties/costs";

const apartment = propertyTypeDef("APARTMENT")!;

function flat(id: string, unitNumber: string, extra: Record<string, unknown> = {}) {
  return { id, floorCount: 0, values: { unitNumber, floorNumber: 1, bhkType: "2BHK", bedrooms: 2, bathrooms: 2, furnishing: "SEMI_FURNISHED", availabilityStatus: "AVAILABLE", ...extra } };
}

function emptyApartment(): CompletenessInput {
  return {
    type: apartment,
    listingType: "RENT",
    property: {},
    building: {},
    imageCount: 0,
    units: [],
    rooms: [],
    bedsWithRent: 0,
    utility: null,
    policy: null,
    amenityCount: 0,
    pricing: [],
    documents: [],
  };
}

function completeApartment(): CompletenessInput {
  return {
    ...emptyApartment(),
    property: { title: "2BHK flats in Green Valley Apartments", description: "Spacious, well-ventilated flats close to the Madhapur metro station and IT parks.", addressLine: "Plot 12, Road 5", city: "Hyderabad", state: "Telangana", pincode: "500081", latitude: 17.44, longitude: 78.39 },
    building: { name: "Green Valley Apartments", totalFloors: 5, totalUnits: 40 },
    imageCount: 5,
    units: [flat("u1", "101"), flat("u2", "102"), flat("u3", "201", { bhkType: "3BHK", bedrooms: 3 })],
    utility: Object.fromEntries(
      ["separateElectricityMeter", "electricityBillingType", "meterPaymentType", "electricityIncludedInRent", "separateWaterMeter", "waterSupplyType", "waterChargesType", "waterIncludedInRent", "gasConnectionType", "internetAvailable", "powerBackup", "generatorAvailable", "sewageFacilities", "wasteCollection"].map((k) => [k, "NOT_APPLICABLE"]),
    ),
    policy: Object.fromEntries(
      ["guestsAllowed", "overnightGuestsAllowed", "guestRegistrationRequired", "landlordApprovalRequired", "guestParkingAvailable", "guestChargesApplicable", "petsAllowed", "smokingAllowed", "partiesAllowed", "cookingAllowed", "sublettingAllowed", "workFromHomeAllowed"].map((k) => [k, "NO"]),
    ),
    amenityCount: 6,
    pricing: [
      { unitId: null, values: { monthlyRent: "25000.00", securityDeposit: "100000.00", rentDueDay: 5, noticePeriodDays: 30, lockInPeriodMonths: 6, agreementChargesPaidBy: "SHARED" }, charges: [{ kind: "MAINTENANCE", billing: "FIXED_MONTHLY" }] },
    ],
    documents: [{ docType: "OWNERSHIP_PROOF", status: "APPROVED" }],
  };
}

describe("completeness score", () => {
  it("is 0 for an empty draft and 100 for a fully disclosed, verified apartment with several flats", () => {
    expect(computeCompleteness(emptyApartment()).score).toBeLessThan(10);
    const full = computeCompleteness(completeApartment());
    expect(full.score).toBe(100);
    expect(full.sections.every((s) => s.missing.length === 0)).toBe(true);
    expect(full.note).toMatch(/not a verification badge/i);
  });

  it("counts NOT_DISCLOSED as missing but NOT_APPLICABLE as disclosed", () => {
    const input = completeApartment();
    input.utility = { ...input.utility!, powerBackup: "NOT_DISCLOSED" };
    const r = computeCompleteness(input);
    const utilities = r.sections.find((s) => s.key === "utilities")!;
    expect(utilities.missing).toEqual(["Power backup"]);
    expect(r.score).toBeLessThan(100);
  });

  it("does not treat an uploaded (unverified) document as verified", () => {
    const input = completeApartment();
    input.documents = [{ docType: "OWNERSHIP_PROOF", status: "PENDING" }];
    const docs = computeCompleteness(input).sections.find((s) => s.key === "documents")!;
    expect(docs.ratio).toBe(0.5);
  });

  it("uses configurable weights (and falls back to defaults when invalid)", () => {
    const weights = { ...DEFAULT_COMPLETENESS_WEIGHTS, basic: 20, documents: 0 } as const;
    expect(parseWeights(weights)).toEqual(weights);
    expect(parseWeights({ ...DEFAULT_COMPLETENESS_WEIGHTS, basic: 99 })).toEqual(DEFAULT_COMPLETENESS_WEIGHTS);
    expect(parseWeights({ basic: -1 })).toEqual(DEFAULT_COMPLETENESS_WEIGHTS);
    const input = completeApartment();
    input.documents = [];
    expect(computeCompleteness(input, weights).score).toBe(100);
  });

  it("scores PG rooms and beds from the actual bed records", () => {
    const pg: CompletenessInput = { ...emptyApartment(), type: propertyTypeDef("PG")!, rooms: [{ bedCount: 3, rentPerBed: "7000.00" }, { bedCount: 0 }] };
    const units = computeCompleteness(pg).sections.find((s) => s.key === "units")!;
    expect(units.missing).toContain("Beds for every room");
  });
});

describe("submission readiness", () => {
  it("lists what blocks submission", () => {
    const problems = submissionProblems(emptyApartment());
    expect(problems).toEqual(expect.arrayContaining(["Add a title.", "Add at least one flat.", "Add at least one photo.", "Add the rent."]));
  });
  it("passes for a complete apartment", () => {
    expect(submissionProblems(completeApartment())).toEqual([]);
  });
  it("requires floor-wise details for a duplex and a sale price for SALE listings", () => {
    const duplex: CompletenessInput = {
      ...completeApartment(),
      type: propertyTypeDef("DUPLEX_HOUSE")!,
      building: {},
      units: [{ id: "d1", floorCount: 0, values: { unitNumber: "7", configuration: "G+1", totalFloors: 2, furnishing: "UNFURNISHED", availabilityStatus: "AVAILABLE" } }],
    };
    expect(submissionProblems(duplex).some((p) => p.includes("floor-wise"))).toBe(true);
    const sale: CompletenessInput = { ...completeApartment(), listingType: "SALE" };
    expect(submissionProblems(sale)).toContain("Add the sale price.");
  });
  it("rejects listing types the property type does not support", () => {
    const pg: CompletenessInput = { ...completeApartment(), type: propertyTypeDef("PG")!, building: {}, listingType: "SALE", rooms: [{ bedCount: 2 }] };
    expect(submissionProblems(pg).some((p) => p.includes("cannot be listed for sale"))).toBe(true);
  });
});

describe("tenant cost transparency", () => {
  it("separates included, fixed, usage-based, one-time and undisclosed charges", () => {
    const b = costBreakdown({ monthlyRent: "20000", securityDeposit: "60000" }, [
      { kind: "MAINTENANCE", label: "Maintenance", billing: "FIXED_MONTHLY", amount: "3000", frequency: "QUARTERLY" },
      { kind: "WATER", label: "Water", billing: "INCLUDED_IN_RENT" },
      { kind: "ELECTRICITY", label: "Electricity", billing: "USAGE_BASED" },
      { kind: "OTHER", label: "Agreement", billing: "ONE_TIME", amount: "2000" },
      { kind: "PARKING", label: "Parking", billing: "NOT_DISCLOSED" },
    ]);
    expect(b.includedInRent.map((l) => l.kind)).toEqual(["WATER"]);
    expect(b.fixed[0]!.monthlyEquivalent).toBe("1000.00");
    expect(b.usageBased.map((l) => l.kind)).toEqual(["ELECTRICITY"]);
    expect(b.oneTime[0]!.amount).toBe("2000.00");
    expect(b.notDisclosed.map((l) => l.kind)).toEqual(["PARKING"]);
    expect(b.estimate).toEqual({ monthly: "21000.00", isEstimate: true, basis: expect.any(String), excludes: ["Electricity (usage-based)"] });
  });

  it("gives no estimate when a recurring charge is not disclosed (never assumes zero)", () => {
    const b = costBreakdown({ monthlyRent: "20000" }, [{ kind: "WATER", label: "Water", billing: "INCLUDED_IN_RENT" }]);
    expect(b.estimate).toBeNull();
    expect(b.notDisclosed.map((l) => l.kind)).toEqual(expect.arrayContaining(["MAINTENANCE", "ELECTRICITY"]));
    expect(b.estimateUnavailableReason).toMatch(/Maintenance/);
  });

  it("uses utility details for electricity and water when no explicit charge exists", () => {
    const b = costBreakdown({ monthlyRent: "10000" }, [{ kind: "MAINTENANCE", label: "Maintenance", billing: "INCLUDED_IN_RENT" }], {
      electricityBillingType: "ACTUAL_BILL",
      electricityRatePerUnit: "8",
      waterChargesType: "FIXED_MONTHLY",
      waterChargesAmount: "250",
    });
    expect(b.usageBased[0]!.notes).toBe("₹8.00 per unit");
    expect(b.estimate?.monthly).toBe("10250.00");
  });

  it("returns no estimate without a rent", () => {
    expect(costBreakdown(null, []).estimateUnavailableReason).toMatch(/rent/i);
  });
});
