import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, daysBetween, inSendingHours, isLatePayer, nextReminder, reminderSettingsSchema } from "../src/lib/rentReminders";

describe("smart rent reminders", () => {
  it("settings are sorted and de-duplicated", () => {
    expect(reminderSettingsSchema.parse({ enabled: true, beforeDays: [1, 3, 3], overdueDays: [7, 1] })).toMatchObject({ beforeDays: [3, 1], overdueDays: [1, 7] });
  });
  it("before the due date: one at a time, missed runs skip", () => {
    expect(nextReminder(DEFAULT_SETTINGS, 4, false, new Set())).toBeNull();
    expect(nextReminder(DEFAULT_SETTINGS, 3, false, new Set())).toEqual({ kind: "BEFORE_3", skip: [] });
    expect(nextReminder(DEFAULT_SETTINGS, 2, false, new Set(["BEFORE_3"]))).toBeNull();
    expect(nextReminder(DEFAULT_SETTINGS, 1, false, new Set())).toEqual({ kind: "BEFORE_1", skip: ["BEFORE_3"] });
    expect(nextReminder(DEFAULT_SETTINGS, 5, true, new Set())).toEqual({ kind: "BEFORE_5", skip: [] });
    expect(nextReminder({ ...DEFAULT_SETTINGS, smartEarly: false }, 5, true, new Set())).toBeNull();
  });
  it("overdue and off", () => {
    expect(nextReminder(DEFAULT_SETTINGS, -1, false, new Set())).toEqual({ kind: "OVERDUE_1", skip: [] });
    expect(nextReminder(DEFAULT_SETTINGS, -4, false, new Set(["OVERDUE_1"]))).toEqual({ kind: "OVERDUE_3", skip: [] });
    expect(nextReminder(DEFAULT_SETTINGS, 0, false, new Set())).toBeNull();
    expect(nextReminder({ ...DEFAULT_SETTINGS, enabled: false }, 1, false, new Set())).toBeNull();
  });
  it("helpers", () => {
    expect(daysBetween("2026-11-21", "2026-11-24")).toBe(3);
    expect(isLatePayer([{ dueDate: "2026-09-05", paidOn: "2026-09-08", overdueNow: false }, { dueDate: "2026-10-05", paidOn: null, overdueNow: true }])).toBe(true);
    expect(isLatePayer([{ dueDate: "2026-09-05", paidOn: "2026-09-05", overdueNow: false }])).toBe(false);
    expect(inSendingHours(new Date("2026-11-21T04:00:00Z"))).toBe(true); // 9:30 AM IST
    expect(inSendingHours(new Date("2026-11-21T16:00:00Z"))).toBe(false); // 9:30 PM IST
  });
});
