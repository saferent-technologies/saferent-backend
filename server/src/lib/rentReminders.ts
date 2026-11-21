import { z } from "zod";

/** Smart rent reminder rules (pure; unit tested in test/rentReminders.test.ts). */

export const reminderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Days before the due date (e.g. [3, 1]). */
    beforeDays: z.array(z.number().int().min(1).max(10)).max(3).default([3, 1]),
    /** Days after the due date while unpaid (e.g. [1, 3, 7]). */
    overdueDays: z.array(z.number().int().min(1).max(30)).max(4).default([1, 3, 7]),
    /** Tenants who paid late before get an extra reminder 5 days ahead. */
    smartEarly: z.boolean().default(true),
  })
  .strict()
  .transform((v) => ({ ...v, beforeDays: [...new Set(v.beforeDays)].sort((a, b) => b - a), overdueDays: [...new Set(v.overdueDays)].sort((a, b) => a - b) }));
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;
export const DEFAULT_SETTINGS: ReminderSettings = { enabled: true, beforeDays: [3, 1], overdueDays: [1, 3, 7], smartEarly: true };

/** Whole days from `today` to `due` (both YYYY-MM-DD, India dates). */
export function daysBetween(today: string, due: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Paid late = paid after the due date (India day). */
export function isLatePayer(history: Array<{ dueDate: string; paidOn: string | null; overdueNow: boolean }>): boolean {
  return history.filter((h) => h.overdueNow || (h.paidOn != null && h.paidOn > h.dueDate)).length >= 2;
}

/**
 * The reminder to send now for one unpaid due, or null. `sent` = kinds already sent for it.
 * Missed runs never send several at once: only the latest step is sent and the earlier ones are skipped.
 * Returns { kind, skip } — `skip` = earlier kinds to mark as done.
 */
export function nextReminder(s: ReminderSettings, daysToDue: number, latePayer: boolean, sent: Set<string>): { kind: string; skip: string[] } | null {
  if (!s.enabled) return null;
  if (daysToDue > 0) {
    const steps = [...s.beforeDays, ...(s.smartEarly && latePayer ? [5] : [])].sort((a, b) => b - a).map((d) => ({ d, kind: `BEFORE_${d}` }));
    const due = steps.filter((x) => daysToDue <= x.d);
    if (!due.length) return null;
    const latest = due[due.length - 1]!;
    if (sent.has(latest.kind)) return null;
    return { kind: latest.kind, skip: due.slice(0, -1).map((x) => x.kind).filter((k) => !sent.has(k)) };
  }
  if (daysToDue < 0) {
    const late = -daysToDue;
    const due = s.overdueDays.filter((d) => late >= d).map((d) => `OVERDUE_${d}`);
    if (!due.length) return null;
    const latest = due[due.length - 1]!;
    if (sent.has(latest)) return null;
    return { kind: latest, skip: due.slice(0, -1).filter((k) => !sent.has(k)) };
  }
  return null; // the due day itself is handled by the existing "Rent due today" notification
}

/** Only between 9 AM and 8 PM India time. */
export function inSendingHours(now: Date): boolean {
  const h = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return h >= 9 * 60 && h < 20 * 60;
}
