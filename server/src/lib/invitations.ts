/** Pure helpers for tenant invitation links (unit tested in test/invitations.test.ts). */
import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Only its hash is ever stored. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Tokens are 43 base64url characters; anything else is rejected before touching the database. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function isExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Only the person the invitation was sent to can open it: the signed-in account's phone (or email,
 * when one was given) must match the recipient. Phones are compared in E.164 form.
 */
export function recipientMatches(
  invite: { recipientPhone: string | null; recipientEmail: string | null },
  user: { phoneNumber: string | null; email: string | null },
): boolean {
  if (!invite.recipientPhone && !invite.recipientEmail) return true;
  if (invite.recipientPhone && user.phoneNumber && invite.recipientPhone === user.phoneNumber) return true;
  if (invite.recipientEmail && user.email && invite.recipientEmail.toLowerCase() === user.email.toLowerCase()) return true;
  return false;
}

/** Lease end when the landlord didn't give one: 11 months (the common Indian rental agreement), ending the day before. */
export function leaseEndDate(start: Date, end: Date | null | undefined): Date {
  if (end) return end;
  const d = new Date(start);
  d.setMonth(d.getMonth() + 11);
  d.setDate(d.getDate() - 1);
  return d;
}

export type InviteDecision = { ok: true } | { ok: false; reason: "NOT_PENDING" | "EXPIRED" | "OWN_INVITE" | "WRONG_RECIPIENT" | "STAFF_ACCOUNT" };

/** Can this signed-in user accept (or reject) the invitation right now? */
export function canRespond(
  invite: { status: string; expiresAt: Date; landlordId: string; recipientPhone: string | null; recipientEmail: string | null },
  user: { id: string; phoneNumber: string | null; email: string | null; isStaff: boolean },
  now = new Date(),
): InviteDecision {
  if (invite.status !== "PENDING") return { ok: false, reason: "NOT_PENDING" };
  if (isExpired(invite.expiresAt, now)) return { ok: false, reason: "EXPIRED" };
  if (invite.landlordId === user.id) return { ok: false, reason: "OWN_INVITE" };
  if (!recipientMatches(invite, user)) return { ok: false, reason: "WRONG_RECIPIENT" };
  if (user.isStaff) return { ok: false, reason: "STAFF_ACCOUNT" };
  return { ok: true };
}

export function inviteMessage(p: { tenantName: string; propertyName: string; unitLabel: string | null; url: string }): string {
  const place = p.unitLabel ? `${p.unitLabel}, ${p.propertyName}` : p.propertyName;
  return `Hi ${p.tenantName}, your rental for ${place} is ready on SafeRent. Open this link, sign in with your phone number and accept: ${p.url}`;
}
