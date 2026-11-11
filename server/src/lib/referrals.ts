/**
 * Referral & rewards rules (pure — unit tested in test/referrals.test.ts).
 *
 *  TENANT_TO_TENANT      tenant's link → new tenant signs up and finishes onboarding → ₹ credit to referrer
 *  LANDLORD_TO_TENANT    landlord's tenant invitation accepted → lease ACTIVE → ₹ credit to landlord
 *  LANDLORD_TO_LANDLORD  landlord's link → new landlord verified (identity + document + approved property)
 *                        → referrer gets N months of the highest landlord plan free
 *
 * Credits are promotional: never cash, never withdrawable or transferable, never usable as rent.
 */
import { randomInt } from "node:crypto";

export type ReferralType = "TENANT_TO_TENANT" | "LANDLORD_TO_TENANT" | "LANDLORD_TO_LANDLORD";
export type CodeKind = "TENANT" | "LANDLORD";

/* ─── Codes ─── */

// No 0/O/1/I/L — easy to read out over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newReferralCode(kind: CodeKind): string {
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${kind === "TENANT" ? "SR-TEN" : "SR-LAND"}-${s}`;
}

export function isWellFormedCode(code: unknown): code is string {
  return typeof code === "string" && /^SR-(TEN|LAND)-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(code);
}

export function kindOfCode(code: string): CodeKind {
  return code.startsWith("SR-TEN-") ? "TENANT" : "LANDLORD";
}

/** Which referral a sign-up through a link creates. A tenant link used by a new landlord (or vice versa) earns nothing. */
export function referralTypeFor(codeKind: CodeKind, newUserRole: string): ReferralType | null {
  if (codeKind === "TENANT" && newUserRole === "TENANT") return "TENANT_TO_TENANT";
  if (codeKind === "LANDLORD" && newUserRole === "LANDLORD") return "LANDLORD_TO_LANDLORD";
  return null;
}

/* ─── Campaigns ─── */

export interface Campaign {
  type: ReferralType;
  enabled: boolean;
  rewardAmount: number | null; // ₹ for credit campaigns
  durationMonths: number | null; // for the subscription campaign
  maxRewardsPerUser: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  codeExpiryDays: number | null;
  rewardExpiryDays: number | null;
  /** TENANT_TO_TENANT only: what "onboarding complete" means. */
  tenantEligibility?: "PROFILE_COMPLETE" | "ACTIVE_LEASE";
}

export const DEFAULT_CAMPAIGNS: Record<ReferralType, Omit<Campaign, "type">> = {
  TENANT_TO_TENANT: { enabled: true, rewardAmount: 50, durationMonths: null, maxRewardsPerUser: 50, startsAt: null, endsAt: null, codeExpiryDays: null, rewardExpiryDays: 365, tenantEligibility: "PROFILE_COMPLETE" },
  LANDLORD_TO_TENANT: { enabled: true, rewardAmount: 50, durationMonths: null, maxRewardsPerUser: 100, startsAt: null, endsAt: null, codeExpiryDays: null, rewardExpiryDays: 365 },
  LANDLORD_TO_LANDLORD: { enabled: true, rewardAmount: null, durationMonths: 1, maxRewardsPerUser: 12, startsAt: null, endsAt: null, codeExpiryDays: null, rewardExpiryDays: null },
};

export function campaignOpen(c: Pick<Campaign, "enabled" | "startsAt" | "endsAt">, now = new Date()): boolean {
  if (!c.enabled) return false;
  if (c.startsAt && now < c.startsAt) return false;
  if (c.endsAt && now > c.endsAt) return false;
  return true;
}

/* ─── Attribution (at registration) ─── */

export type AttributionResult = { ok: true; type: ReferralType } | { ok: false; reason: "INVALID" | "REVOKED" | "EXPIRED" | "SELF" | "INACTIVE_REFERRER" | "ROLE_MISMATCH" | "CAMPAIGN_CLOSED" };

/**
 * Checked on the server while the new account is created, so attribution is locked from the start.
 * Existing accounts never reach this (registration refuses them).
 */
export function checkAttribution(
  code: { status: string; expiresAt: Date | null; ownerId: string; kind: CodeKind } | null,
  p: { newUserId: string; newUserRole: string; referrerActive: boolean; referrerHasRole: boolean; campaign: Pick<Campaign, "enabled" | "startsAt" | "endsAt"> | null; now?: Date },
): AttributionResult {
  const now = p.now ?? new Date();
  if (!code) return { ok: false, reason: "INVALID" };
  if (code.status !== "ACTIVE") return { ok: false, reason: "REVOKED" };
  if (code.expiresAt && code.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (code.ownerId === p.newUserId) return { ok: false, reason: "SELF" };
  if (!p.referrerActive || !p.referrerHasRole) return { ok: false, reason: "INACTIVE_REFERRER" };
  const type = referralTypeFor(code.kind, p.newUserRole);
  if (!type) return { ok: false, reason: "ROLE_MISMATCH" };
  if (!p.campaign || !campaignOpen(p.campaign, now)) return { ok: false, reason: "CAMPAIGN_CLOSED" };
  return { ok: true, type };
}

/* ─── Eligibility ─── */

export interface Step {
  key: string;
  label: string;
  done: boolean;
}

export function tenantSteps(t: { phoneVerified: boolean; occupation: string | null; currentCity: string | null; hasActiveLease: boolean }, rule: "PROFILE_COMPLETE" | "ACTIVE_LEASE" = "PROFILE_COMPLETE"): Step[] {
  const steps: Step[] = [
    { key: "registered", label: "Signed up", done: true },
    { key: "phone", label: "Phone verified", done: t.phoneVerified },
  ];
  if (rule === "ACTIVE_LEASE") steps.push({ key: "lease", label: "Rented a home on SafeRent", done: t.hasActiveLease });
  else steps.push({ key: "profile", label: "Profile completed (occupation and city) or rented a home", done: t.hasActiveLease || (!!t.occupation?.trim() && !!t.currentCity?.trim()) });
  return steps;
}

export function landlordSteps(l: { phoneVerified: boolean; kycApproved: boolean; approvedDocuments: number; verifiedProperties: number }): Step[] {
  return [
    { key: "registered", label: "Signed up", done: true },
    { key: "phone", label: "Phone verified", done: l.phoneVerified },
    { key: "identity", label: "Identity verified by SafeRent", done: l.kycApproved },
    { key: "document", label: "A property document verified", done: l.approvedDocuments > 0 },
    { key: "property", label: "A property approved by SafeRent", done: l.verifiedProperties > 0 },
  ];
}

export const allDone = (steps: Step[]) => steps.every((s) => s.done);

/** Lifecycle status shown while the referred user is still on the way (reward status is tracked separately). */
export function progressStatus(steps: Step[]): "PHONE_VERIFIED" | "ONBOARDING_PENDING" | "VERIFICATION_PENDING" | "ELIGIBLE" | "REGISTERED" {
  if (allDone(steps)) return "ELIGIBLE";
  const phone = steps.find((s) => s.key === "phone");
  if (phone && !phone.done) return "REGISTERED";
  if (steps.some((s) => ["identity", "document", "property"].includes(s.key) && !s.done)) return "VERIFICATION_PENDING";
  return "ONBOARDING_PENDING";
}

/* ─── Subscription reward ─── */

/** The highest landlord plan right now: the most expensive active one (ties → name). Never hard-coded. */
export function highestPlan<P extends { id: string; name: string; audience: string; priceMonthly: number | string | { toString(): string }; active: boolean }>(plans: P[], audience = "LANDLORD"): P | null {
  const eligible = plans.filter((p) => p.active && p.audience === audience);
  eligible.sort((a, b) => Number(b.priceMonthly.toString()) - Number(a.priceMonthly.toString()) || a.name.localeCompare(b.name));
  return eligible[0] ?? null;
}

/** Calendar months, clamped to month end: 31 Jan + 1 → 28/29 Feb. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/**
 * Where the free months go, without touching what the landlord already has:
 *  - nothing active → a new promotional period starting now;
 *  - an active period with an end date → starts right after it (extension);
 *  - an open-ended paid plan → kept as a credit for the next billing cycle (never shortens or replaces it).
 */
export function promoPeriod(active: Array<{ endsAt: Date | null }>, months: number, now = new Date()): { mode: "NEW" | "EXTENSION" | "NEXT_BILLING"; startsAt: Date | null; endsAt: Date | null } {
  if (active.some((s) => s.endsAt === null)) return { mode: "NEXT_BILLING", startsAt: null, endsAt: null };
  const latest = active.reduce<Date | null>((m, s) => (s.endsAt && s.endsAt > now && (!m || s.endsAt > m) ? s.endsAt : m), null);
  const startsAt = latest ?? now;
  return { mode: latest ? "EXTENSION" : "NEW", startsAt, endsAt: addMonths(startsAt, months) };
}

/* ─── Promotional wallet ─── */

export interface CreditLot {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

const paise = (n: number) => Math.round(n * 100);

/** Spends credits oldest-first, skipping expired ones. Returns the allocation, or null when the balance isn't enough. */
export function allocate(lots: CreditLot[], amount: number, now = new Date()): Array<{ id: string; take: number }> | null {
  let need = paise(amount);
  const usable = lots.filter((l) => l.remaining > 0 && (!l.expiresAt || l.expiresAt > now)).sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime());
  const out: Array<{ id: string; take: number }> = [];
  for (const l of usable) {
    if (need <= 0) break;
    const take = Math.min(paise(l.remaining), need);
    out.push({ id: l.id, take: take / 100 });
    need -= take;
  }
  return need > 0 ? null : out;
}

export function expiredLots(lots: CreditLot[], now = new Date()): CreditLot[] {
  return lots.filter((l) => l.remaining > 0 && l.expiresAt && l.expiresAt <= now);
}

/** One reward per referral, ever — the ledger's unique idempotency key enforces it. */
export const rewardKey = (referralId: string) => `referral:${referralId}:reward`;
export const reversalKey = (referralId: string) => `referral:${referralId}:reversal`;

/** Wallet operations that are not allowed for promotional credit — kept explicit so nobody adds them by accident. */
export const FORBIDDEN_WALLET_OPERATIONS = ["WITHDRAW", "TRANSFER", "PAY_RENT"] as const;
