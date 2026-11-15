/** Pure rent-schedule helpers (unit tested in test/rent.test.ts). */

/** Calendar month (server local time) as YYYY-MM — used for "this month". */
export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** YYYY-MM of a DB date (`@db.Date` values are UTC midnight). */
export function datePeriod(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Same day-of-month, `months` later; clamped to the month's last day (31 Jan + 1 → 28/29 Feb). UTC date. */
export function addMonthsClamped(start: Date, months: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(start.getUTCDate(), lastDay)));
}

const DAY = 86_400_000;

/**
 * Rent is due on the same date as the tenant's join date, every month, starting the month AFTER they
 * joined (joined 15 Nov → first rent due 15 Dec, then 15 Jan …). The joining month itself has no due.
 * A due appears from the 1st of its month (so the landlord sees it as "expected"), and only while the
 * lease runs: the last one falls on or just after the lease end (rent for the final month).
 */
export function rentDueDates(start: Date, end: Date, now: Date): Array<{ period: string; dueDate: Date }> {
  const out: Array<{ period: string; dueDate: Date }> = [];
  const thisMonth = periodOf(now);
  const lastAllowed = end.getTime() + DAY;
  for (let k = 1; k <= 600; k++) {
    const dueDate = addMonthsClamped(start, k);
    if (dueDate.getTime() > lastAllowed) break;
    const period = datePeriod(dueDate);
    if (period > thisMonth) break;
    out.push({ period, dueDate });
  }
  return out;
}

/** Back-compat: just the periods of rentDueDates. */
export function billingPeriods(start: Date, end: Date, until: Date): string[] {
  return rentDueDates(start, end, until).map((d) => d.period);
}
