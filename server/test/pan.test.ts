import { describe, expect, it } from "vitest";
import { canAskAgain, maskPan, normalizePan, panSharedFor } from "../src/lib/pan";

describe("landlord PAN", () => {
  it("normalises and validates", () => {
    expect(normalizePan(" abcde 1234 f ")).toBe("ABCDE1234F");
    expect(normalizePan("ABCDE12345")).toBeNull();
    expect(normalizePan("")).toBeNull();
  });
  it("masks", () => {
    expect(maskPan("ABCDE1234F")).toBe("AB******4F");
  });
  it("is shared only with consent", () => {
    const p = { pan: "ABCDE1234F", panShareAll: false };
    expect(panSharedFor(p, null)).toBe(false);
    expect(panSharedFor(p, { status: "PENDING" })).toBe(false);
    expect(panSharedFor(p, { status: "REVOKED" })).toBe(false);
    expect(panSharedFor(p, { status: "APPROVED" })).toBe(true);
    expect(panSharedFor({ ...p, panShareAll: true }, null)).toBe(true);
    expect(panSharedFor({ pan: null, panShareAll: true }, { status: "APPROVED" })).toBe(false);
  });
  it("throttles re-asking after a no", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(canAskAgain(null, now)).toBe(true);
    expect(canAskAgain({ status: "PENDING", decidedAt: null }, now)).toBe(false);
    expect(canAskAgain({ status: "DENIED", decidedAt: new Date("2026-11-08T00:00:00Z") }, now)).toBe(false);
    expect(canAskAgain({ status: "DENIED", decidedAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(true);
    expect(canAskAgain({ status: "REVOKED", decidedAt: new Date("2026-11-09T00:00:00Z") }, now)).toBe(true);
  });
});
