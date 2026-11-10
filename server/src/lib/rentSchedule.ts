/** Pure rent-schedule helpers (unit tested in test/rent.test.ts). */

export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Billing periods from lease start up to (and including) `until`, capped at lease end. */
export function billingPeriods(start: Date, end: Date, until: Date): string[] {
  const periods: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(Math.min(end.getTime(), until.getTime()));
  while (cursor <= last) {
    periods.push(periodOf(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return periods;
}
