/*
 * Landlord PAN — privacy rules.
 * Tenants need the owner's PAN for HRA once annual rent crosses ₹1 lakh (Form 124, earlier 12BB),
 * but the PAN is the owner's personal data: it is shared only with the owner's consent —
 * either for all their tenants (panShareAll) or for one lease (an APPROVED PanShareRequest).
 */

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** "abcde 1234 f" → "ABCDE1234F"; null when it isn't a valid PAN. */
export function normalizePan(raw: string): string | null {
  const v = raw.replace(/\s+/g, "").toUpperCase();
  return PAN_RE.test(v) ? v : null;
}

/** ABCDE1234F → AB******4F (enough to recognise, not to use). */
export function maskPan(pan: string): string {
  if (pan.length < 4) return "****";
  return `${pan.slice(0, 2)}${"*".repeat(pan.length - 4)}${pan.slice(-2)}`;
}

/** May this lease's tenant see the owner's full PAN? */
export function panSharedFor(profile: { pan: string | null; panShareAll: boolean } | null, request: { status: string } | null): boolean {
  if (!profile?.pan) return false;
  return profile.panShareAll || request?.status === "APPROVED";
}

/** Days a tenant waits before asking again after the owner said no. */
export const PAN_REASK_DAYS = 7;

export function canAskAgain(request: { status: string; decidedAt: Date | null } | null, now = new Date()): boolean {
  if (!request) return true;
  if (request.status === "PENDING" || request.status === "APPROVED") return false;
  if (request.status === "DENIED" && request.decidedAt) return now.getTime() - request.decidedAt.getTime() >= PAN_REASK_DAYS * 86_400_000;
  return true;
}
