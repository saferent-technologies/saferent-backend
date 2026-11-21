import { describe, expect, it } from "vitest";
import { extinguisherState, safetySchema, safetyScore } from "../src/lib/safety";

describe("property safety", () => {
  it("extinguisher details need an extinguisher and an expiry", () => {
    expect(safetySchema.safeParse({ fireExtinguisher: true, fireExtinguisherExpiry: "2027-03-01", fireExtinguisherCount: 2 }).success).toBe(true);
    expect(safetySchema.safeParse({ fireExtinguisher: true }).success).toBe(false);
    expect(safetySchema.safeParse({ fireExtinguisher: false, fireExtinguisherCount: 2 }).success).toBe(false);
    expect(safetySchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
  it("contacts and places", () => {
    expect(safetySchema.safeParse({ emergencyContacts: [{ label: "Fire", phone: "101" }, { label: "Office", phone: "+91 98765 43210" }], nearestHospital: { name: "City Hospital", distanceKm: 1.2 } }).success).toBe(true);
    expect(safetySchema.safeParse({ securityPhone: "+919876543210" }).success).toBe(false);
  });
  it("extinguisher state", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    expect(extinguisherState(true, new Date("2026-11-20"), now)).toBe("EXPIRED");
    expect(extinguisherState(true, new Date("2026-12-10"), now)).toBe("EXPIRING");
    expect(extinguisherState(true, new Date("2027-06-01"), now)).toBe("VALID");
    expect(extinguisherState(false, new Date("2027-06-01"), now)).toBeNull();
  });
  it("score", () => {
    expect(safetyScore(null)).toBe(0);
    expect(safetyScore({ fireExtinguisher: true, smokeDetectors: false })).toBe(20);
  });
});
