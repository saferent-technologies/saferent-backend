/*
 * Owner verification — pure rules (no DB), unit-tested in test/kyc.test.ts.
 *   1. Phone OTP            (sign-in)
 *   2. DigiLocker identity  (govt-issued name/photo — can't be faked)
 *   3. Live selfie          (staff compare it with the DigiLocker photo)
 *   4. Ownership proof      (per property: sale deed / tax receipt / power bill, verified by staff)
 * Staff approve 2+3 → "Owner verified". A property is approved only with a verified ownership proof.
 */

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "shri", "sri", "smt", "kumari", "md", "mohd", "mohammed", "mohammad", "muhammad"]);

/** "Shaik  Shabeer." → ["shabeer","shaik"] — lowercased, punctuation/titles removed, sorted. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TITLES.has(t))
    .sort();
}

export type NameMatch = "EXACT" | "PARTIAL" | "MISMATCH";

/**
 * Compares the profile name with the DigiLocker name. Order and initials don't matter
 * ("S Shabeer" vs "Shaik Shabeer" → PARTIAL). Anything not EXACT is shown to staff for a closer look.
 */
export function compareNames(a: string, b: string): NameMatch {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return "MISMATCH";
  if (x.join(" ") === y.join(" ")) return "EXACT";
  const full = (ts: string[]) => ts.filter((t) => t.length > 1);
  const [fx, fy] = [full(x), full(y)];
  const shared = fx.filter((t) => fy.includes(t));
  if (!shared.length) return "MISMATCH";
  // Every remaining token on the shorter side must be a shared word or an initial of the other side.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const ok = short.every((t) => long.includes(t) || (t.length === 1 && long.some((l) => l.startsWith(t))));
  return ok ? "PARTIAL" : "MISMATCH";
}

/** Last 4 digits from "xxxxxxxx1234" / "XXXX XXXX 1234"; null if unusable. Never keeps more. */
export function aadhaarLast4(masked: string | null | undefined): string | null {
  const digits = (masked ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export type KycStage = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "REJECTED";

export function kycStage(p: { kycStatus: string; kycSubmittedAt: Date | null } | null, hasIdentity: boolean, hasSelfie: boolean): KycStage {
  if (!p) return "NOT_STARTED";
  if (p.kycStatus === "APPROVED") return "APPROVED";
  if (p.kycStatus === "REJECTED" && !p.kycSubmittedAt) return "REJECTED";
  if (p.kycSubmittedAt) return "SUBMITTED";
  return hasIdentity || hasSelfie ? "IN_PROGRESS" : "NOT_STARTED";
}

/** Owners may start at most this many DigiLocker sessions a day (each one costs money). */
export const DIGILOCKER_DAILY_LIMIT = 5;
