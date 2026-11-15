import { describe, expect, it } from "vitest";
import { addMonthsClamped, periodOf, rentDueDates } from "../src/lib/rentSchedule";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("rent schedule (due on the join date, from the next month)", () => {
  it("formats the current month as YYYY-MM", () => {
    expect(periodOf(new Date(2026, 0, 31))).toBe("2026-01");
    expect(periodOf(new Date(2026, 10, 1))).toBe("2026-11");
  });

  it("has no due in the joining month", () => {
    expect(rentDueDates(d(2026, 11, 15), d(2027, 11, 14), new Date(2026, 10, 20))).toEqual([]);
  });

  it("first due is the same date next month, visible from the 1st of that month", () => {
    const dues = rentDueDates(d(2026, 11, 15), d(2027, 11, 14), new Date(2026, 11, 2));
    expect(dues.map((x) => [x.period, iso(x.dueDate)])).toEqual([["2026-12", "2026-12-15"]]);
  });

  it("keeps the same day every month and across the year end", () => {
    const dues = rentDueDates(d(2026, 11, 15), d(2027, 11, 14), new Date(2027, 1, 20));
    expect(dues.map((x) => iso(x.dueDate))).toEqual(["2026-12-15", "2027-01-15", "2027-02-15"]);
  });

  it("clamps 31st to the month's last day without drifting", () => {
    expect(iso(addMonthsClamped(d(2027, 1, 31), 1))).toBe("2027-02-28");
    expect(iso(addMonthsClamped(d(2027, 1, 31), 2))).toBe("2027-03-31");
  });

  it("bills 12 months for a one-year lease and nothing after it ends", () => {
    const dues = rentDueDates(d(2026, 11, 15), d(2027, 11, 14), new Date(2028, 5, 1));
    expect(dues).toHaveLength(12);
    expect(iso(dues[11].dueDate)).toBe("2027-11-15");
  });

  it("bills nothing for a lease that starts in the future", () => {
    expect(rentDueDates(d(2027, 1, 1), d(2027, 12, 31), new Date(2026, 10, 10))).toEqual([]);
  });
});
