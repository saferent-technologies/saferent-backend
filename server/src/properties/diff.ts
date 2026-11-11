/** Audit helpers (pure — unit tested). */
import { Prisma } from "@prisma/client";

const SENSITIVE = /(password|otp|token|secret|pepper|authorization)/i;

/** JSON-safe copy without secrets (Decimals → strings, Dates → ISO). */
export function sanitize(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return JSON.parse(
    JSON.stringify(value, (key, v) => {
      if (key && SENSITIVE.test(key)) return undefined;
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  ) as Prisma.InputJsonValue;
}

/** Only the fields that actually changed (pure). */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): { old: Record<string, unknown>; new: Record<string, unknown> } {
  const norm = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v ?? null)));
  const out = { old: {} as Record<string, unknown>, new: {} as Record<string, unknown> };
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const a = norm(before[key]);
    const b = norm(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.old[key] = a;
      out.new[key] = b;
    }
  }
  return out;
}
