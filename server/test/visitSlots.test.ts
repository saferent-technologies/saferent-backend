import { describe, expect, it } from "vitest";
import { findSlot, slotsFor, visitSettingsSchema } from "../src/lib/visitSlots";

// Saturday 2026-11-21, 08:00 IST = 02:30 UTC
const now = new Date("2026-11-21T02:30:00Z");
const s = visitSettingsSchema.parse({ enabled: true, slotMinutes: 30, capacityPerSlot: 1, minNoticeHours: 2, maxDaysAhead: 7, weekly: [{ day: 6, start: "10:00", end: "12:00" }, { day: 0, start: "16:00", end: "17:00" }] });

describe("visit slots", () => {
  it("settings: times must fit a slot and not overlap; enabled needs a time", () => {
    expect(visitSettingsSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(visitSettingsSchema.safeParse({ enabled: true, weekly: [{ day: 1, start: "10:00", end: "10:15" }] }).success).toBe(false);
    expect(visitSettingsSchema.safeParse({ enabled: true, weekly: [{ day: 1, start: "10:00", end: "12:00" }, { day: 1, start: "11:00", end: "13:00" }] }).success).toBe(false);
    expect(visitSettingsSchema.safeParse({ enabled: false }).success).toBe(true);
  });
  it("IST slots, minimum notice, other days", () => {
    const days = slotsFor(s, now, "2026-11-21", 2, new Map());
    expect(days.map((d) => d.date)).toEqual(["2026-11-21", "2026-11-22"]);
    // Saturday: 10:00 IST (04:30Z) onwards; 10:00 is exactly 2h after 08:00 → allowed
    expect(days[0]!.slots.map((x) => x.start)).toEqual(["2026-11-21T04:30:00.000Z", "2026-11-21T05:00:00.000Z", "2026-11-21T05:30:00.000Z", "2026-11-21T06:00:00.000Z"]);
    expect(days[1]!.slots).toHaveLength(2);
  });
  it("full and blocked slots are hidden; findSlot", () => {
    const booked = new Map([["2026-11-21T04:30:00.000Z", 1]]);
    expect(slotsFor(s, now, "2026-11-21", 1, booked)[0]!.slots).toHaveLength(3);
    expect(slotsFor({ ...s, blockedDates: ["2026-11-21"] }, now, "2026-11-21", 1, new Map())).toEqual([]);
    expect(findSlot(s, now, new Date("2026-11-21T05:00:00Z"))).not.toBeNull();
    expect(findSlot(s, now, new Date("2026-11-21T05:10:00Z"))).toBeNull();
    expect(findSlot(s, new Date("2026-11-21T04:00:00Z"), new Date("2026-11-21T05:00:00Z"))).toBeNull();
  });
});
