/**
 * Information completeness score and submission readiness (pure — unit tested).
 *
 * The score measures how much information has been DISCLOSED. It is not a verification badge:
 * landlord-provided information is never treated as verified, and NOT_DISCLOSED values count as missing.
 * NOT_APPLICABLE counts as disclosed (the landlord answered the question).
 */
import { DEFAULT_COMPLETENESS_WEIGHTS, OWNERSHIP_DOCUMENTS, type CompletenessWeights, type PropertyTypeDef } from "./catalog";
import { isEmpty, missingRequired } from "./fields";

export interface CompletenessInput {
  type: PropertyTypeDef;
  listingType: "RENT" | "LEASE" | "SALE";
  property: {
    title?: string | null;
    description?: string | null;
    addressLine?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    latitude?: unknown;
    longitude?: unknown;
  };
  /** Building values: columns + attributes, flattened. */
  building: Record<string, unknown>;
  imageCount: number;
  units: Array<{ id: string; values: Record<string, unknown>; floorCount: number }>;
  rooms: Array<{ bedCount: number; rentPerBed?: unknown; securityDeposit?: unknown }>;
  bedsWithRent: number;
  utility: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  amenityCount: number;
  /** Property-level pricing and unit-level pricing records. */
  pricing: Array<{ unitId?: string | null; values: Record<string, unknown>; charges: Array<{ kind: string; billing: string }> }>;
  documents: Array<{ docType: string; status: string }>;
}

export interface SectionScore {
  key: keyof CompletenessWeights;
  label: string;
  weight: number;
  /** 0..1 */
  ratio: number;
  points: number;
  missing: string[];
}

export interface CompletenessResult {
  score: number;
  sections: SectionScore[];
  note: string;
}

const disclosed = (v: unknown) => !isEmpty(v) && v !== "NOT_DISCLOSED";

const UTILITY_FIELDS: Record<string, Array<[string, string]>> = {
  BUILT: [
    ["separateElectricityMeter", "Separate electricity meter"],
    ["separateWaterMeter", "Separate water meter"],
    ["gasConnectionType", "Gas connection"],
    ["internetAvailable", "Internet"],
    ["powerBackup", "Power backup"],
    ["generatorAvailable", "Generator"],
    ["sewageFacilities", "Sewage"],
    ["wasteCollection", "Waste collection"],
  ],
  LAND: [
    ["separateElectricityMeter", "Electricity connection / meter"],
    ["separateWaterMeter", "Water connection / meter"],
    ["sewageFacilities", "Sewage"],
  ],
};

const POLICY_FIELDS: Record<string, Array<[string, string]>> = {
  RESIDENTIAL: [
    ["guestsAllowed", "Guests allowed"],
    ["overnightGuestsAllowed", "Overnight guests"],
    ["guestRegistrationRequired", "Guest registration"],
    ["landlordApprovalRequired", "Landlord approval for guests"],
    ["guestParkingAvailable", "Guest parking"],
    ["guestChargesApplicable", "Guest charges"],
    ["petsAllowed", "Pets"],
    ["smokingAllowed", "Smoking"],
    ["partiesAllowed", "Parties"],
    ["cookingAllowed", "Cooking"],
    ["sublettingAllowed", "Subletting"],
    ["workFromHomeAllowed", "Work from home"],
  ],
  COMMERCIAL: [
    ["smokingAllowed", "Smoking"],
    ["cookingAllowed", "Cooking"],
    ["sublettingAllowed", "Subletting"],
    ["landlordApprovalRequired", "Landlord approval for changes"],
  ],
  LAND: [["sublettingAllowed", "Subletting / sub-lease"]],
};

function fraction(checks: Array<[boolean, string]>): { ratio: number; missing: string[] } {
  if (checks.length === 0) return { ratio: 1, missing: [] };
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { ratio: (checks.length - missing.length) / checks.length, missing };
}

function priceDisclosed(input: CompletenessInput): boolean {
  if (input.listingType === "SALE") return input.pricing.some((p) => !isEmpty(p.values.salePrice));
  if (input.type.structure === "ROOMS_BEDS") return input.rooms.some((r) => !isEmpty(r.rentPerBed)) || input.bedsWithRent > 0 || input.pricing.some((p) => !isEmpty(p.values.monthlyRent));
  const property = input.pricing.find((p) => !p.unitId);
  if (property && !isEmpty(property.values.monthlyRent)) return true;
  return input.units.length > 0 && input.units.every((u) => input.pricing.some((p) => p.unitId === u.id && !isEmpty(p.values.monthlyRent)));
}

export function computeCompleteness(input: CompletenessInput, weights: CompletenessWeights = DEFAULT_COMPLETENESS_WEIGHTS): CompletenessResult {
  const t = input.type;
  const sections: SectionScore[] = [];
  const add = (key: keyof CompletenessWeights, label: string, r: { ratio: number; missing: string[] }) => {
    const weight = weights[key] ?? 0;
    sections.push({ key, label, weight, ratio: Number(r.ratio.toFixed(4)), points: weight * r.ratio, missing: r.missing });
  };

  // Basic information
  add(
    "basic",
    "Basic property information",
    fraction([
      [!isEmpty(input.property.title), "Title"],
      [(input.property.description ?? "").trim().length >= 50, "Description (at least 50 characters)"],
      [t.buildingFields.filter((fd) => fd.required).every((fd) => !isEmpty(input.building[fd.key])), "Required property details"],
    ]),
  );

  // Location & images (images: 3 photos for full marks)
  const loc = fraction([
    [!isEmpty(input.property.addressLine), "Address"],
    [!isEmpty(input.property.city), "City"],
    [!isEmpty(input.property.state), "State"],
    [!isEmpty(input.property.pincode), "PIN code"],
    [!isEmpty(input.property.latitude) && !isEmpty(input.property.longitude), "Map location"],
  ]);
  const imageRatio = Math.min(input.imageCount, 3) / 3;
  add("locationImages", "Location and images", {
    ratio: loc.ratio * (5 / 6) + imageRatio * (1 / 6),
    missing: [...loc.missing, ...(input.imageCount < 3 ? [`Photos (${input.imageCount}/3)`] : [])],
  });

  // Units / rooms / beds
  if (t.structure === "ROOMS_BEDS") {
    add(
      "units",
      "Rooms and beds",
      fraction([
        [input.rooms.length > 0, "At least one room"],
        [input.rooms.length > 0 && input.rooms.every((r) => r.bedCount > 0), "Beds for every room"],
      ]),
    );
  } else {
    const missing: string[] = [];
    if (input.units.length === 0) missing.push(`At least one ${t.unitLabel?.toLowerCase() ?? "unit"}`);
    let unitRatio = 0;
    if (input.units.length > 0) {
      const ratios = input.units.map((u) => {
        const required = t.unitFields.filter((fd) => fd.required);
        const m = missingRequired(t.unitFields, u.values);
        const floorsOk = t.floorWise ? (u.floorCount > 0 ? 1 : 0) : 1;
        if (t.floorWise && u.floorCount === 0) missing.push("Floor-wise details");
        m.forEach((label) => missing.includes(label) || missing.push(label));
        const base = required.length ? (required.length - Math.min(m.length, required.length)) / required.length : 1;
        return t.floorWise ? base * 0.8 + floorsOk * 0.2 : base;
      });
      unitRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }
    add("units", `${t.unitLabel ?? "Unit"} details`, { ratio: unitRatio, missing });
  }

  // Utilities
  const utilFields = UTILITY_FIELDS[t.category === "LAND" ? "LAND" : "BUILT"];
  add("utilities", "Utilities", fraction(utilFields.map(([key, label]) => [disclosed(input.utility?.[key]), label])));

  // Policies
  const policyFields = POLICY_FIELDS[t.category];
  add("policies", "Guest policies and restrictions", fraction(policyFields.map(([key, label]) => [disclosed(input.policy?.[key]), label])));

  // Amenities
  const target = t.category === "LAND" ? 2 : 3;
  add("amenities", "Amenities", {
    ratio: Math.min(input.amenityCount, target) / target,
    missing: input.amenityCount < target ? [`Amenities (${input.amenityCount}/${target})`] : [],
  });

  // Financial
  const main = input.pricing.find((p) => !p.unitId) ?? input.pricing[0];
  const v = main?.values ?? {};
  const charges = input.pricing.flatMap((p) => p.charges);
  const chargeDisclosed = (kind: string, utilKey?: string) =>
    charges.some((c) => c.kind === kind && c.billing !== "NOT_DISCLOSED") || (utilKey ? disclosed(input.utility?.[utilKey]) : false);
  const rental = input.listingType !== "SALE";
  const checks: Array<[boolean, string]> = [[priceDisclosed(input), input.listingType === "SALE" ? "Sale price" : "Rent"]];
  if (rental) {
    checks.push(
      [!isEmpty(v.securityDeposit) || input.pricing.some((p) => p.unitId && !isEmpty(p.values.securityDeposit)) || input.rooms.some((r) => !isEmpty(r.securityDeposit)), "Security deposit"],
      [chargeDisclosed("MAINTENANCE"), "Maintenance charges"],
    );
    // Flats / rooms don't ask lease terms at the property level (rent and deposit are per unit).
    const perUnit = t.structure === "MULTI_UNIT" || t.structure === "ROOMS_BEDS";
    if (!perUnit) {
      checks.push(
        [!isEmpty(v.noticePeriodDays), "Notice period"],
        [!isEmpty(v.lockInPeriodMonths), "Lock-in period"],
        [disclosed(v.agreementChargesPaidBy), "Who pays agreement charges"],
      );
    }
    if (t.category !== "LAND") {
      checks.push([chargeDisclosed("ELECTRICITY", "electricityBillingType"), "Electricity charges"], [chargeDisclosed("WATER", "waterChargesType"), "Water charges"]);
    }
    if (input.listingType === "RENT" && !perUnit) checks.push([!isEmpty(v.rentDueDay), "Rent due day"]);
  }
  add("financial", "Rent and financial details", fraction(checks));

  // Documents & verification
  const ownership = input.documents.filter((d) => (OWNERSHIP_DOCUMENTS as readonly string[]).includes(d.docType));
  const verified = ownership.some((d) => d.status === "APPROVED");
  add("documents", "Documents and verification", {
    ratio: verified ? 1 : ownership.some((d) => d.status === "PENDING") ? 0.5 : 0,
    missing: verified ? [] : ownership.length ? ["Ownership document verification by SafeRent"] : ["Ownership document"],
  });

  const totalWeight = sections.reduce((a, s) => a + s.weight, 0) || 1;
  const score = Math.round((sections.reduce((a, s) => a + s.points, 0) / totalWeight) * 100);
  return {
    score: Math.max(0, Math.min(100, score)),
    sections: sections.map((s) => ({ ...s, points: Number(s.points.toFixed(2)) })),
    note: "Completeness shows how much information is disclosed. It is not a verification badge.",
  };
}

/** Problems that block submitting a property for verification. */
export function submissionProblems(input: CompletenessInput): string[] {
  const t = input.type;
  const problems: string[] = [];
  if (isEmpty(input.property.title)) problems.push("Add a title.");
  if ((input.property.description ?? "").trim().length < 30) problems.push("Add a description of at least 30 characters.");
  for (const [key, label] of [["addressLine", "address"], ["city", "city"], ["state", "state"], ["pincode", "PIN code"]] as const) {
    if (isEmpty(input.property[key])) problems.push(`Add the ${label}.`);
  }
  for (const label of missingRequired(t.buildingFields, input.building)) problems.push(`Property details: ${label} is required.`);
  if (!t.listingTypes.includes(input.listingType)) problems.push(`${t.label} cannot be listed for ${input.listingType.toLowerCase()}.`);

  if (t.structure === "ROOMS_BEDS") {
    if (input.rooms.length === 0) problems.push("Add at least one room.");
    else if (!input.rooms.every((r) => r.bedCount > 0)) problems.push("Every room needs at least one bed.");
  } else if (input.units.length === 0) {
    problems.push(`Add at least one ${t.unitLabel?.toLowerCase() ?? "unit"}.`);
  } else {
    input.units.forEach((u, i) => {
      const m = missingRequired(t.unitFields, u.values);
      if (m.length) problems.push(`${t.unitLabel ?? "Unit"} ${String(u.values.unitNumber ?? i + 1)}: ${m.join(", ")} required.`);
      if (t.floorWise && u.floorCount === 0) problems.push(`${t.unitLabel ?? "Unit"} ${String(u.values.unitNumber ?? i + 1)}: add floor-wise details.`);
    });
  }
  if (input.imageCount === 0) problems.push("Add at least one photo.");
  if (!priceDisclosed(input)) problems.push(input.listingType === "SALE" ? "Add the sale price." : "Add the rent.");
  return problems;
}

/** Validates admin-configured weights: non-negative numbers for every section, summing to 100. */
export function parseWeights(raw: unknown): CompletenessWeights {
  const keys = Object.keys(DEFAULT_COMPLETENESS_WEIGHTS) as Array<keyof CompletenessWeights>;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_COMPLETENESS_WEIGHTS };
  const out = {} as CompletenessWeights;
  for (const k of keys) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ...DEFAULT_COMPLETENESS_WEIGHTS };
    out[k] = v;
  }
  return Math.round(keys.reduce((a, k) => a + out[k], 0)) === 100 ? out : { ...DEFAULT_COMPLETENESS_WEIGHTS };
}
