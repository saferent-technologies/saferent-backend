import { describe, expect, it } from "vitest";
import { canRespond, hashInviteToken, isExpired, isWellFormedToken, leaseEndDate, newInviteToken, recipientMatches } from "../src/lib/invitations";

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 1000);
const invite = { status: "PENDING", expiresAt: future, landlordId: "landlord-1", recipientPhone: "+917995153536", recipientEmail: null };
const tenant = { id: "tenant-1", phoneNumber: "+917995153536", email: null, isStaff: false };

describe("invitation tokens", () => {
  it("are random, URL-safe and 43 characters", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("are stored only as a SHA-256 hash", () => {
    const t = newInviteToken();
    expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(t)).toBe(hashInviteToken(t));
    expect(hashInviteToken(t)).not.toContain(t);
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const bad of ["", "abc", "x".repeat(44), "../../etc/passwd", "a b".padEnd(43, "c"), 42, null]) expect(isWellFormedToken(bad)).toBe(false);
  });
});

describe("who can respond to an invitation", () => {
  it("the invited tenant can accept a pending invitation", () => {
    expect(canRespond(invite, tenant)).toEqual({ ok: true });
  });

  it("a different phone number cannot claim it", () => {
    expect(canRespond(invite, { ...tenant, id: "someone-else", phoneNumber: "+919999999999" })).toEqual({ ok: false, reason: "WRONG_RECIPIENT" });
  });

  it("it can't be reused after acceptance, revocation or rejection", () => {
    for (const status of ["ACCEPTED", "REVOKED", "REJECTED", "EXPIRED"]) expect(canRespond({ ...invite, status }, tenant)).toEqual({ ok: false, reason: "NOT_PENDING" });
  });

  it("expired links don't work", () => {
    expect(canRespond({ ...invite, expiresAt: past }, tenant)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(isExpired(past)).toBe(true);
    expect(isExpired(future)).toBe(false);
  });

  it("the landlord can't accept their own invitation", () => {
    expect(canRespond(invite, { ...tenant, id: "landlord-1" })).toEqual({ ok: false, reason: "OWN_INVITE" });
  });

  it("staff accounts can't become tenants", () => {
    expect(canRespond(invite, { ...tenant, isStaff: true })).toEqual({ ok: false, reason: "STAFF_ACCOUNT" });
  });

  it("matches by email when one was given", () => {
    expect(recipientMatches({ recipientPhone: "+911111111111", recipientEmail: "Ravi@Example.com" }, { phoneNumber: null, email: "ravi@example.com" })).toBe(true);
    expect(recipientMatches({ recipientPhone: "+911111111111", recipientEmail: null }, { phoneNumber: null, email: "ravi@example.com" })).toBe(false);
  });
});

describe("lease end date", () => {
  it("uses the landlord's end date when given", () => {
    const end = new Date(2027, 5, 30);
    expect(leaseEndDate(new Date(2026, 11, 1), end)).toBe(end);
  });

  it("defaults to 11 months, ending the day before", () => {
    const end = leaseEndDate(new Date(2026, 11, 1), null);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2027, 9, 31]);
  });
});
