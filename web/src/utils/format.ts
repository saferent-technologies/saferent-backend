const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Formats an ISO date string from the API. */
export function formatTimestamp(iso: string | null | undefined, fallback = "—"): string {
  return iso ? dateTime.format(new Date(iso)) : fallback;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  return rtf.format(-Math.round(seconds / 86400), "day");
}

/** "Super Admin" -> "SA" */
export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "S") + (parts[1]?.[0] ?? "A")).toUpperCase();
}

/** "PENDING_REVIEW" -> "Pending review" */
export function labelize(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.replace(/[_.]/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** ₹12,500 — accepts numbers or the decimal strings returned by the API. */
export function formatMoney(value: number | string | null | undefined): string {
  return inr.format(Number(value ?? 0));
}

const dateOnly = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function formatDate(iso: string | null | undefined, fallback = "—"): string {
  return iso ? dateOnly.format(new Date(iso)) : fallback;
}

export function toOptions(values: readonly string[]): Array<{ value: string; label: string }> {
  return values.map((v) => ({ value: v, label: labelize(v) }));
}
