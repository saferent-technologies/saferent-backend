import { describe, expect, it } from "vitest";
import { AMENITIES, CATEGORIES, PROPERTY_TYPES, maxUnits, propertyTypeDef, unitPrefix } from "../src/properties/catalog";
import { fieldsSchema, mergeAttributes, missingRequired, moneySchema, splitValues } from "../src/properties/fields";

describe("property type catalog", () => {
  it("covers every requested category and type exactly once", () => {
    const keys = PROPERTY_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        "APARTMENT", "VILLA", "INDIVIDUAL_HOUSE", "DUPLEX_HOUSE", "PG", "HOSTEL", "FARMHOUSE",
        "OFFICE_SPACE", "SHOP", "SHOWROOM", "WAREHOUSE", "INDUSTRIAL_PROPERTY", "COWORKING_SPACE",
        "RESIDENTIAL_PLOT", "COMMERCIAL_PLOT", "AGRICULTURAL_LAND", "INDUSTRIAL_LAND",
      ]),
    );
    for (const c of CATEGORIES) expect(PROPERTY_TYPES.some((t) => t.category === c)).toBe(true);
  });

  it("every unit-based type has a unit kind and unit fields; PG / hostel use rooms and beds", () => {
    for (const t of PROPERTY_TYPES) {
      if (t.structure === "ROOMS_BEDS") {
        expect(t.unitFields).toHaveLength(0);
      } else {
        expect(t.unitKind).toBeTruthy();
        expect(t.unitFields.length).toBeGreaterThan(0);
        expect(t.unitFields.some((f) => f.key === "availabilityStatus")).toBe(true);
      }
      const fieldKeys = [...t.buildingFields, ...t.unitFields].map((f) => f.key);
      expect(new Set(t.buildingFields.map((f) => f.key)).size).toBe(t.buildingFields.length);
      expect(new Set(t.unitFields.map((f) => f.key)).size).toBe(t.unitFields.length);
      expect(fieldKeys.length).toBeGreaterThan(0);
    }
  });

  it("enforces the unit limits per structure", () => {
    expect(maxUnits(propertyTypeDef("APARTMENT")!, {})).toBeNull();
    expect(maxUnits(propertyTypeDef("INDIVIDUAL_HOUSE")!, {})).toBe(1);
    expect(maxUnits(propertyTypeDef("PG")!, {})).toBe(0);
    expect(maxUnits(propertyTypeDef("VILLA")!, { villaListing: "STANDALONE" })).toBe(1);
    expect(maxUnits(propertyTypeDef("VILLA")!, { villaListing: "COMMUNITY" })).toBeNull();
  });

  it("uses SR-VILLA ids for villas and SR-UNIT for other units", () => {
    expect(unitPrefix("VILLA")).toBe("SR-VILLA");
    expect(unitPrefix("FLAT")).toBe("SR-UNIT");
  });

  it("has the requested amenities", () => {
    const labels = AMENITIES.map((a) => a.key);
    for (const k of ["LIFT", "COVERED_PARKING", "OPEN_PARKING", "SECURITY", "CCTV", "GYM", "SWIMMING_POOL", "GARDEN", "CHILDRENS_PLAY_AREA", "CLUBHOUSE", "POWER_BACKUP", "WATER_SUPPLY", "HOUSEKEEPING", "WASTE_COLLECTION", "INTERNET", "WASHING_MACHINE", "FURNISHED_KITCHEN", "AIR_CONDITIONING"]) {
      expect(labels).toContain(k);
    }
  });
});

describe("field validation (dynamic forms)", () => {
  const apartment = propertyTypeDef("APARTMENT")!;
  const villa = propertyTypeDef("VILLA")!;

  it("accepts valid flat values and rejects unknown keys", () => {
    const schema = fieldsSchema(apartment.unitFields);
    expect(schema.safeParse({ unitNumber: "101", floorNumber: 1, bhkType: "2BHK", bedrooms: 2, bathrooms: 2, furnishing: "SEMI_FURNISHED", availabilityStatus: "AVAILABLE" }).success).toBe(true);
    expect(schema.safeParse({ unitNumber: "101", landlordId: "x" }).success).toBe(false);
  });

  it("rejects invalid types and ranges", () => {
    const schema = fieldsSchema(apartment.unitFields);
    expect(schema.safeParse({ bedrooms: -1 }).success).toBe(false);
    expect(schema.safeParse({ bedrooms: 2.5 }).success).toBe(false);
    expect(schema.safeParse({ bhkType: "9BHK" }).success).toBe(false);
    expect(schema.safeParse({ furnishing: "MAYBE" }).success).toBe(false);
    expect(schema.safeParse({ builtUpArea: "abc" }).success).toBe(false);
  });

  it("allows drafts with missing fields but reports required ones", () => {
    expect(fieldsSchema(apartment.unitFields).safeParse({}).success).toBe(true);
    const missing = missingRequired(apartment.unitFields, { unitNumber: "101" });
    expect(missing).toEqual(expect.arrayContaining(["Floor number", "BHK type", "Bedrooms", "Bathrooms", "Furnishing", "Availability"]));
  });

  it("requires a custom configuration only when CUSTOM is chosen (villa)", () => {
    const base = { unitNumber: "V1", bedrooms: 4, bathrooms: 4, furnishing: "UNFURNISHED", availabilityStatus: "AVAILABLE" };
    expect(missingRequired(villa.unitFields, { ...base, configuration: "G+1" })).toEqual([]);
    expect(missingRequired(villa.unitFields, { ...base, configuration: "CUSTOM" })).toEqual(["Custom configuration"]);
    expect(missingRequired(villa.unitFields, { ...base, configuration: "CUSTOM", customConfiguration: "B+G+2" })).toEqual([]);
    expect(fieldsSchema(villa.unitFields).safeParse({ configuration: "G+9" }).success).toBe(false);
  });

  it("splits columns from type-specific attributes and merges attribute updates", () => {
    const { columns, attributes } = splitValues({ unitNumber: "V1", gardenAvailable: "YES", basementAvailable: "NOT_DISCLOSED", bedrooms: 3 }, ["unitNumber", "bedrooms"]);
    expect(columns).toEqual({ unitNumber: "V1", bedrooms: 3 });
    expect(attributes).toEqual({ gardenAvailable: "YES", basementAvailable: "NOT_DISCLOSED" });
    expect(mergeAttributes({ a: 1, b: 2 }, { b: null, c: 3 })).toEqual({ a: 1, c: 3 });
  });

  it("validates money as non-negative amounts with at most 2 decimals", () => {
    expect(moneySchema.parse("15000")).toBe("15000.00");
    expect(moneySchema.parse(15000.5)).toBe("15000.50");
    expect(moneySchema.safeParse("-1").success).toBe(false);
    expect(moneySchema.safeParse("12.345").success).toBe(false);
    expect(moneySchema.safeParse("1e5").success).toBe(false);
    expect(moneySchema.safeParse("abc").success).toBe(false);
  });
});
