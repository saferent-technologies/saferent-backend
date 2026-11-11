import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPAIGNS,
  addMonths,
  allDone,
  allocate,
  campaignOpen,
  checkAttribution,
  expiredLots,
  highestPlan,
  isWellFormedCode,
  kindOfCode,
  landlordSteps,
  newReferralCode,
  progressStatus,
  promoPeriod,
  referralTypeFor,
  rewardKey,
  tenantSteps,
} from "../src/lib/referrals";

const now = new Date(2026, 10, 10, 12);
const code = { status: "ACTIVE", expiresAt: null, ownerId: "A", kind: "TENANT" as const };
const ok = { newUserId: "B", newUserRole: "TENANT", referrerActive: true, referrerHasRole: true, campaign: DEFAULT_CAMPAIGNS.TENANT_TO_TENANT, now };

describe("referral codes", () => {
  it("look like SR-TEN-XXXXX / SR-LAND-XXXXX and are random", () => {
    const a = newReferralCode("TENANT");
    expect(a).toMatch(/^SR-TEN-[A-Z2-9]{5}$/);
    expect(newReferralCode("LANDLORD")).toMatch(/^SR-LAND-/);
    expect(isWellFormedCode(a)).toBe(true);
    expect(kindOfCode(a)).toBe("TENANT");
    expect(new Set(Array.from({ length: 200 }, () => newReferralCode("TENANT"))).size).toBeGreaterThan(195);
  });
  it("rejects malformed codes", () => {
    for (const bad of ["", "SR-TEN-1234", "SR-TEN-ABCDE0", "sr-ten-abcde", "SR-XYZ-ABCDE", "SR-TEN-ABCD1"]) expect(isWellFormedCode(bad)).toBe(false);
  });
});

describe("attribution at sign-up", () => {
  it("tenant link + new tenant → TENANT_TO_TENANT", () => {
    expect(checkAttribution(code, ok)).toEqual({ ok: true, type: "TENANT_TO_TENANT" });
  });
  it("landlord link + new landlord → LANDLORD_TO_LANDLORD", () => {
    expect(checkAttribution({ ...code, kind: "LANDLORD" }, { ...ok, newUserRole: "LANDLORD", campaign: DEFAULT_CAMPAIGNS.LANDLORD_TO_LANDLORD })).toEqual({ ok: true, type: "LANDLORD_TO_LANDLORD" });
  });
  it("self-referral is rejected", () => {
    expect(checkAttribution(code, { ...ok, newUserId: "A" })).toEqual({ ok: false, reason: "SELF" });
  });
  it("expired and revoked links are rejected", () => {
    expect(checkAttribution({ ...code, expiresAt: new Date(now.getTime() - 1) }, ok)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(checkAttribution({ ...code, status: "REVOKED" }, ok)).toEqual({ ok: false, reason: "REVOKED" });
  });
  it("unknown code, inactive referrer, role mismatch and closed campaign earn nothing", () => {
    expect(checkAttribution(null, ok)).toEqual({ ok: false, reason: "INVALID" });
    expect(checkAttribution(code, { ...ok, referrerActive: false })).toEqual({ ok: false, reason: "INACTIVE_REFERRER" });
    expect(checkAttribution(code, { ...ok, newUserRole: "LANDLORD" })).toEqual({ ok: false, reason: "ROLE_MISMATCH" });
    expect(checkAttribution(code, { ...ok, campaign: { ...DEFAULT_CAMPAIGNS.TENANT_TO_TENANT, enabled: false } })).toEqual({ ok: false, reason: "CAMPAIGN_CLOSED" });
    expect(referralTypeFor("LANDLORD", "TENANT")).toBeNull();
  });
  it("respects campaign dates", () => {
    expect(campaignOpen({ enabled: true, startsAt: new Date(now.getTime() + 1000), endsAt: null }, now)).toBe(false);
    expect(campaignOpen({ enabled: true, startsAt: null, endsAt: new Date(now.getTime() - 1000) }, now)).toBe(false);
    expect(campaignOpen({ enabled: true, startsAt: null, endsAt: null }, now)).toBe(true);
  });
});

describe("eligibility", () => {
  it("a tenant who only signed up is not yet eligible", () => {
    const s = tenantSteps({ phoneVerified: true, occupation: null, currentCity: null, hasActiveLease: false });
    expect(allDone(s)).toBe(false);
    expect(progressStatus(s)).toBe("ONBOARDING_PENDING");
  });
  it("a tenant with a completed profile, or an active lease, is eligible", () => {
    expect(allDone(tenantSteps({ phoneVerified: true, occupation: "Engineer", currentCity: "Hyderabad", hasActiveLease: false }))).toBe(true);
    expect(allDone(tenantSteps({ phoneVerified: true, occupation: null, currentCity: null, hasActiveLease: true }))).toBe(true);
    expect(allDone(tenantSteps({ phoneVerified: true, occupation: "x", currentCity: "y", hasActiveLease: false }, "ACTIVE_LEASE"))).toBe(false);
  });
  it("an unverified landlord does not trigger the reward", () => {
    const s = landlordSteps({ phoneVerified: true, kycApproved: false, approvedDocuments: 1, verifiedProperties: 1 });
    expect(allDone(s)).toBe(false);
    expect(progressStatus(s)).toBe("VERIFICATION_PENDING");
  });
  it("a landlord without an approved property (e.g. rejected) does not trigger the reward", () => {
    expect(allDone(landlordSteps({ phoneVerified: true, kycApproved: true, approvedDocuments: 1, verifiedProperties: 0 }))).toBe(false);
  });
  it("a fully verified landlord is eligible", () => {
    const s = landlordSteps({ phoneVerified: true, kycApproved: true, approvedDocuments: 2, verifiedProperties: 1 });
    expect(progressStatus(s)).toBe("ELIGIBLE");
  });
});

describe("free subscription month", () => {
  const plans = [
    { id: "s", name: "Starter", audience: "LANDLORD", priceMonthly: "199.00", active: true },
    { id: "b", name: "Business", audience: "LANDLORD", priceMonthly: "999.00", active: true },
    { id: "p", name: "Professional", audience: "LANDLORD", priceMonthly: "499.00", active: true },
    { id: "x", name: "Enterprise", audience: "LANDLORD", priceMonthly: "4999.00", active: false },
    { id: "t", name: "Tenant Plus", audience: "TENANT", priceMonthly: "9999.00", active: true },
  ];
  it("picks the highest active landlord plan at grant time (not hard-coded)", () => {
    expect(highestPlan(plans)?.name).toBe("Business");
    expect(highestPlan(plans.filter((p) => p.id !== "b"))?.name).toBe("Professional");
    expect(highestPlan([])).toBeNull();
  });
  it("starts now with no active plan", () => {
    const p = promoPeriod([], 1, now);
    expect(p.mode).toBe("NEW");
    expect(p.endsAt?.getMonth()).toBe(11);
  });
  it("extends after the current period instead of overlapping it", () => {
    const end = new Date(2026, 11, 20);
    const p = promoPeriod([{ endsAt: end }], 1, now);
    expect(p).toMatchObject({ mode: "EXTENSION", startsAt: end });
    expect([p.endsAt!.getFullYear(), p.endsAt!.getMonth(), p.endsAt!.getDate()]).toEqual([2027, 0, 20]);
  });
  it("never changes an open-ended paid plan; keeps the month for the next billing cycle", () => {
    expect(promoPeriod([{ endsAt: null }], 1, now)).toEqual({ mode: "NEXT_BILLING", startsAt: null, endsAt: null });
  });
  it("handles month ends", () => {
    const d = addMonths(new Date(2027, 0, 31), 1);
    expect([d.getMonth(), d.getDate()]).toEqual([1, 28]);
  });
});

describe("promotional wallet", () => {
  const lots = [
    { id: "old", remaining: 50, expiresAt: new Date(2027, 0, 1), createdAt: new Date(2026, 0, 1) },
    { id: "new", remaining: 50, expiresAt: new Date(2027, 6, 1), createdAt: new Date(2026, 6, 1) },
    { id: "gone", remaining: 50, expiresAt: new Date(2026, 5, 1), createdAt: new Date(2025, 5, 1) },
  ];
  it("spends oldest-expiring credit first and skips expired credit", () => {
    expect(allocate(lots, 70, now)).toEqual([{ id: "old", take: 50 }, { id: "new", take: 20 }]);
  });
  it("refuses when the balance isn't enough (no overdraft)", () => {
    expect(allocate(lots, 150, now)).toBeNull();
  });
  it("finds expired credit to write off", () => {
    expect(expiredLots(lots, now).map((l) => l.id)).toEqual(["gone"]);
  });
  it("uses one idempotency key per referral reward", () => {
    expect(rewardKey("r1")).toBe(rewardKey("r1"));
    expect(rewardKey("r1")).not.toBe(rewardKey("r2"));
  });
});
