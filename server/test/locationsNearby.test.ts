import { describe, expect, it } from "vitest";
import { cleanPlace, locationKey, placesOf } from "../src/properties/locations";
import { boundingBox, distanceMeters, DUPLICATE_RADIUS_M } from "../src/properties/nearby";

describe("search locations from property addresses", () => {
  it("cleans place names", () => {
    expect(cleanPlace("  hitech   city ")).toBe("Hitech City");
    expect(cleanPlace("")).toBeNull();
    expect(cleanPlace(null)).toBeNull();
  });

  it("an address gives state, city and locality places", () => {
    expect(placesOf({ state: "telangana", city: "hyderabad", locality: "madhapur" })).toEqual([
      { kind: "STATE", name: "Telangana", city: null, state: null },
      { kind: "CITY", name: "Hyderabad", city: null, state: "Telangana" },
      { kind: "LOCALITY", name: "Madhapur", city: "Hyderabad", state: "Telangana" },
    ]);
  });

  it("skips a locality that is the city itself, and a locality without a city", () => {
    expect(placesOf({ city: "Hanumakonda", locality: "hanumakonda" }).map((p) => p.kind)).toEqual(["CITY"]);
    expect(placesOf({ locality: "Madhapur" })).toEqual([]);
  });

  it("keys are case-insensitive and keep same-named places in different cities apart", () => {
    expect(locationKey("CITY", "Hyderabad", null, "Telangana")).toBe(locationKey("CITY", "HYDERABAD", null, "telangana"));
    expect(locationKey("LOCALITY", "Kothapet", "Hyderabad", "Telangana")).not.toBe(locationKey("LOCALITY", "Kothapet", "Guntur", "Andhra Pradesh"));
  });
});

describe("possible duplicates within 40 m", () => {
  it("measures distance in metres", () => {
    expect(distanceMeters(17.4483, 78.3915, 17.4483, 78.3915)).toBe(0);
    const d = distanceMeters(17.4483, 78.3915, 17.44866, 78.3915); // ≈ 40 m north
    expect(d).toBeGreaterThanOrEqual(38);
    expect(d).toBeLessThanOrEqual(42);
  });

  it("the bounding box contains every point within the radius", () => {
    const box = boundingBox(17.4483, 78.3915, DUPLICATE_RADIUS_M);
    const north = 17.4483 + DUPLICATE_RADIUS_M / 111_320;
    expect(north).toBeLessThanOrEqual(box.maxLat);
    expect(distanceMeters(17.4483, 78.3915, 17.4483, box.maxLng)).toBeGreaterThanOrEqual(DUPLICATE_RADIUS_M - 1);
  });
});
