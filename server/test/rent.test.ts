import { describe, expect, it } from "vitest";
import { billingPeriods, periodOf } from "../src/lib/rentSchedule";

describe("rent schedule", () => {
  it("formats billing periods as YYYY-MM", () => {
    expect(periodOf(new Date(2026, 0, 31))).toBe("2026-01");
    expect(periodOf(new Date(2026, 10, 1))).toBe("2026-11");
  });

  it("creates one due per month from lease start up to today", () => {
    expect(billingPeriods(new Date(2026, 8, 15), new Date(2027, 7, 14), new Date(2026, 10, 10))).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("never bills past the lease end", () => {
    expect(billingPeriods(new Date(2026, 0, 1), new Date(2026, 2, 31), new Date(2026, 11, 1))).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("bills nothing for a lease that starts in the future", () => {
    expect(billingPeriods(new Date(2027, 0, 1), new Date(2027, 11, 31), new Date(2026, 10, 10))).toEqual([]);
  });

  it("handles year boundaries", () => {
    expect(billingPeriods(new Date(2026, 10, 20), new Date(2027, 10, 19), new Date(2027, 1, 1))).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});
