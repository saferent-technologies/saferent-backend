import { describe, expect, it } from "vitest";
import { aadhaarLast4, compareNames, kycStage } from "../src/lib/kyc";

describe("owner verification", () => {
  it("matches names regardless of order, case, punctuation and titles", () => {
    expect(compareNames("Shaik Shabeer", "SHABEER SHAIK")).toBe("EXACT");
    expect(compareNames("Mr. Shaik  Shabeer", "shaik shabeer")).toBe("EXACT");
    expect(compareNames("S Shabeer", "Shaik Shabeer")).toBe("PARTIAL");
    expect(compareNames("Shabeer", "Shaik Shabeer")).toBe("PARTIAL");
    expect(compareNames("Ravi Kumar", "Shaik Shabeer")).toBe("MISMATCH");
    expect(compareNames("Ravi Shabeer", "Shaik Shabeer")).toBe("MISMATCH");
    expect(compareNames("", "Shaik Shabeer")).toBe("MISMATCH");
  });
  it("keeps only the last 4 Aadhaar digits", () => {
    expect(aadhaarLast4("xxxxxxxx1234")).toBe("1234");
    expect(aadhaarLast4("XXXX XXXX 9876")).toBe("9876");
    expect(aadhaarLast4("xx")).toBeNull();
    expect(aadhaarLast4(null)).toBeNull();
  });
  it("derives the stage", () => {
    expect(kycStage(null, false, false)).toBe("NOT_STARTED");
    expect(kycStage({ kycStatus: "PENDING", kycSubmittedAt: null }, true, false)).toBe("IN_PROGRESS");
    expect(kycStage({ kycStatus: "PENDING", kycSubmittedAt: new Date() }, true, true)).toBe("SUBMITTED");
    expect(kycStage({ kycStatus: "REJECTED", kycSubmittedAt: null }, true, true)).toBe("REJECTED");
    expect(kycStage({ kycStatus: "APPROVED", kycSubmittedAt: null }, true, true)).toBe("APPROVED");
  });
});
