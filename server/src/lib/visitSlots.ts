import { z } from "zod";

/*
 * Property visit availability → bookable slots. Times are India time (IST, UTC+5:30, no daylight saving).
 * Pure functions (unit tested in test/visitSlots.test.ts).
 */

const IST_MIN = 330;
const DAY_MS = 86_400_000;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const visitSettingsSchema = z
  .object({
    enabled: z.boolean(),
    approvalMode: z.enum(["AUTO", "MANUAL"]).default("MANUAL"),
    slotMinutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).default(30),
    capacityPerSlot: z.coerce.number().int().min(1).max(10).default(1),
    minNoticeHours: z.coerce.number().int().min(0).max(72).default(4),
    maxDaysAhead: z.coerce.number().int().min(1).max(60).default(14),
    weekly: z.array(z.object({ day: z.number().int().min(0).max(6), start: hhmm, end: hhmm }).strict()).max(21).default([]),
    blockedDates: z.array(ymd).max(60).default([]),
    hostId: z.string().uuid().nullable().optional(),
    instructions: z.string().trim().max(300).nullable().optional().or(z.literal("").transform(() => null)),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.enabled && v.weekly.length === 0) ctx.addIssue({ code: "custom", path: ["weekly"], message: "Add at least one visiting time." });
    v.weekly.forEach((w, i) => {
      if (toMin(w.end) - toMin(w.start) < v.slotMinutes) ctx.addIssue({ code: "custom", path: ["weekly", i, "end"], message: `End must be at least ${v.slotMinutes} minutes after start.` });
    });
    for (let a = 0; a < v.weekly.length; a++)
      for (let b = a + 1; b < v.weekly.length; b++) {
        const x = v.weekly[a]!, y = v.weekly[b]!;
        if (x.day === y.day && toMin(x.start) < toMin(y.end) && toMin(y.start) < toMin(x.end)) ctx.addIssue({ code: "custom", path: ["weekly", b], message: "Visiting times on the same day overlap." });
      }
  });
export type VisitSettings = z.infer<typeof visitSettingsSchema>;

/** Today's date in India (YYYY-MM-DD). */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_MIN * 60_000).toISOString().slice(0, 10);
}

/** UTC instant of an India-time date + minutes after midnight. */
function istInstant(date: string, minutes: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - IST_MIN) * 60_000);
}

export interface Slot { start: string; end: string; remaining: number }
export interface SlotDay { date: string; weekday: number; slots: Slot[] }

/**
 * Bookable slots from `fromDate` for `days` days. `booked` = active bookings per slot start (ISO).
 * Slots before now + minimum notice, after now + maxDaysAhead, on blocked dates, or full are left out.
 */
export function slotsFor(s: Pick<VisitSettings, "enabled" | "slotMinutes" | "capacityPerSlot" | "minNoticeHours" | "maxDaysAhead" | "weekly" | "blockedDates">, now: Date, fromDate: string, days: number, booked: Map<string, number>): SlotDay[] {
  if (!s.enabled) return [];
  const earliest = now.getTime() + s.minNoticeHours * 3_600_000;
  const latest = now.getTime() + s.maxDaysAhead * DAY_MS;
  const out: SlotDay[] = [];
  const blocked = new Set(s.blockedDates);
  for (let i = 0; i < Math.min(days, 60); i++) {
    const date = new Date(Date.parse(`${fromDate}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (blocked.has(date)) continue;
    const slots: Slot[] = [];
    for (const w of s.weekly.filter((x) => x.day === weekday).sort((a, b) => toMin(a.start) - toMin(b.start))) {
      for (let m = toMin(w.start); m + s.slotMinutes <= toMin(w.end); m += s.slotMinutes) {
        const start = istInstant(date, m);
        if (start.getTime() < earliest || start.getTime() > latest) continue;
        const iso = start.toISOString();
        const remaining = s.capacityPerSlot - (booked.get(iso) ?? 0);
        if (remaining > 0) slots.push({ start: iso, end: new Date(start.getTime() + s.slotMinutes * 60_000).toISOString(), remaining });
      }
    }
    if (slots.length) out.push({ date, weekday, slots });
  }
  return out;
}

/** The slot starting at `start` if it is bookable now (ignoring capacity: checked under a lock). */
export function findSlot(s: Parameters<typeof slotsFor>[0], now: Date, start: Date): Slot | null {
  const date = istDate(start);
  const day = slotsFor(s, now, date, 1, new Map())[0];
  return day?.slots.find((x) => x.start === start.toISOString()) ?? null;
}

export const bookingSchema = z
  .object({
    start: z.coerce.date(),
    unitId: z.string().uuid().optional(),
    bedId: z.string().uuid().optional(),
    visitors: z.coerce.number().int().min(1).max(10).default(1),
    note: z.string().trim().max(300).optional().or(z.literal("").transform(() => undefined)),
  })
  .strict();

export const reasonSchema = z.object({ reason: z.string().trim().min(3, "Tell us why (at least 3 characters).").max(300) }).strict();

export const feedbackSchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    interested: z.boolean(),
    comment: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  })
  .strict();
