import { createHmac } from "node:crypto";
import type { User } from "@prisma/client";
import type { DecodedIdToken } from "firebase-admin/auth";
import { appConfig } from "../appConfig/service";
import { REASONS } from "../config/constants";
import { env } from "../config/env";
import { AppError } from "./errors";
import { prisma } from "./prisma";

/**
 * Sign-in for accounts that aren't ACTIVE.
 * Every signed-in API (phone/complete, /auth/me, protected routes) answers 403 with
 *   errorCode ACCOUNT_DELETED   — the account was deleted by SafeRent (the phone number can't sign up again)
 *   errorCode ACCOUNT_DISABLED  — suspended or deactivated (can be re-activated by staff)
 * and `details` the app shows on its "account unavailable" screen (status, reason, date, support contacts).
 */

/** Keyed hash of a phone number (E.164): lets us recognise a deleted account's number without storing it. */
export function phoneHash(phone: string): string {
  return createHmac("sha256", env.OTP_PEPPER).update(`deleted-phone:${phone}`).digest("hex");
}

/** The most recently deleted account that used this phone number, if any. */
export async function deletedAccountFor(phone: string | null | undefined) {
  if (!phone) return null;
  return prisma.user.findFirst({
    where: { accountStatus: "DELETED", deletedPhoneHash: phoneHash(phone) },
    orderBy: { deletedAt: "desc" },
    select: { accountStatus: true, deletionReason: true, deletedAt: true },
  });
}

type Blockable = Pick<User, "accountStatus"> & Partial<Pick<User, "deletionReason" | "deletedAt" | "statusReason" | "statusChangedAt">>;

const MESSAGES = {
  DELETED: { title: "Account deleted", message: "This account has been deleted by SafeRent and can no longer be used." },
  DEACTIVATED: { title: "Account deactivated", message: "This account has been deactivated. Contact support to get it back." },
  SUSPENDED: { title: "Account suspended", message: "This account is temporarily suspended. Contact support for help." },
} as const;

/** The 403 error for a blocked account, with what the app needs to explain it. */
export async function accountBlockedError(user: Blockable): Promise<AppError> {
  const status = user.accountStatus === "ACTIVE" ? "DEACTIVATED" : user.accountStatus;
  const deleted = status === "DELETED";
  const support = await appConfig()
    .then((c) => ({ email: c.support.email || null, phone: c.support.phone || null, whatsapp: c.support.whatsapp || null, helpCenterUrl: c.support.helpCenterUrl || null }))
    .catch(() => null);
  const text = MESSAGES[status];
  return new AppError("permission-denied", deleted ? REASONS.ACCOUNT_DELETED : REASONS.ACCOUNT_DISABLED, text.message, {
    accountStatus: status,
    title: text.title,
    reason: (deleted ? user.deletionReason : user.statusReason) ?? null,
    at: ((deleted ? user.deletedAt : user.statusChangedAt) ?? null)?.toISOString() ?? null,
    support,
  });
}

/** Throws the blocked-account error unless the account is ACTIVE. */
export async function assertActive(user: Blockable): Promise<void> {
  if (user.accountStatus !== "ACTIVE") throw await accountBlockedError(user);
}

/** For a phone sign-in with no account: refuse when the number belongs to a deleted account. */
export async function assertPhoneNotDeleted(phone: string | null | undefined): Promise<void> {
  const deleted = await deletedAccountFor(phone);
  if (deleted) throw await accountBlockedError(deleted);
}

/**
 * The account-status gate, run by `authenticate` right after the token is verified — before any route
 * logic and before any other auth error. Returns the account row (or null when there's none yet) and the
 * 403 to send when the account isn't ACTIVE.
 *  1. Account for this Firebase uid → its status.
 *  2. No account for the uid but a phone sign-in (e.g. the Firebase user was purged and re-created) →
 *     a non-active account that has this phone number in our DB, then a deleted account's phone hash.
 */
export async function accountGate(token: DecodedIdToken): Promise<{ row: User | null; blocked: AppError | null }> {
  const row = await prisma.user.findUnique({ where: { firebaseUid: token.uid } });
  if (row) return { row, blocked: row.accountStatus === "ACTIVE" ? null : await accountBlockedError(row) };
  const phone = token.phone_number;
  if (!phone) return { row: null, blocked: null };
  const byPhone = await prisma.user.findFirst({ where: { phoneNumber: phone }, orderBy: { updatedAt: "desc" } });
  if (byPhone) return { row: null, blocked: byPhone.accountStatus === "ACTIVE" ? null : await accountBlockedError(byPhone) };
  const deleted = await deletedAccountFor(phone);
  return { row: null, blocked: deleted ? await accountBlockedError(deleted) : null };
}
