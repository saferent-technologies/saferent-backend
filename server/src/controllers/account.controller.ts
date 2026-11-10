import type { Request, Response } from "express";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { env } from "../config/env";
import { requestMeta, writeAuditLog } from "../lib/audit";
import { fail } from "../lib/errors";
import { adminAuth } from "../lib/firebaseAdmin";
import { maskEmail, maskPhone } from "../lib/mask";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { changePasswordInputSchema, emailChangeInputSchema, parseInput } from "../lib/validation";
import { me, requireRecentAuth } from "../middleware/auth";
import { ROLE_INFO, type RoleKey } from "../rbac/catalog";
import { sendEmail } from "../services/email";
import { emailChangeNoticeEmail, emailChangeVerificationEmail } from "../services/templates";

/**
 * POST /api/account/password — server applies the password policy, changes the Firebase password,
 * signs the account out everywhere and clears the "must change password" flag.
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const token = req.auth!;
  if (!ROLE_INFO[user.role as RoleKey].isStaff || !user.email) {
    fail("failed-precondition", REASONS.INVALID_INPUT, "Your account signs in with a phone number and has no password.");
  }
  requireRecentAuth(req);
  const { newPassword } = parseInput(changePasswordInputSchema, req.body);
  await consumeRateLimit(`pw-change:${user.id}`, RATE_LIMITS.PASSWORD_CHANGE.limit, RATE_LIMITS.PASSWORD_CHANGE.windowMs);

  await adminAuth.updateUser(token.uid, { password: newPassword });
  await adminAuth.revokeRefreshTokens(token.uid);

  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false, passwordChangedAt: now } }),
    prisma.authSession.updateMany({ where: { userId: user.id }, data: { revoked: true, revokedAt: now } }),
  ]);

  await writeAuditLog({ action: "account.password.change", outcome: "success", userId: user.id, email: user.email, ...requestMeta(req) });
  res.json({ ok: true, reSignInRequired: true });
}

/**
 * POST /api/account/email — sends a verify-and-change link to the new address (+ a notice to the
 * old one). MySQL is updated when the admin next signs in with the confirmed address (GET /me).
 */
export async function requestEmailChange(req: Request, res: Response): Promise<void> {
  const user = me(req);
  requireRecentAuth(req);
  const { newEmail } = parseInput(emailChangeInputSchema, req.body);
  if (!user.email) fail("failed-precondition", REASONS.INVALID_INPUT, "Email changes are available for staff accounts only.");
  const currentEmail = user.email;

  if (newEmail === currentEmail) fail("invalid-argument", REASONS.INVALID_INPUT, "This is already your email address.");
  const inFirebase = await adminAuth.getUserByEmail(newEmail).then(() => true).catch(() => false);
  const inDb = await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } });
  if (inFirebase || inDb) fail("already-exists", REASONS.EMAIL_IN_USE, "This email address is already in use.");

  await consumeRateLimit(`email-change:${user.id}`, RATE_LIMITS.EMAIL_CHANGE.limit, RATE_LIMITS.EMAIL_CHANGE.windowMs);

  try {
    const link = await adminAuth.generateVerifyAndChangeEmailLink(currentEmail, newEmail, {
      url: `${env.APP_ORIGIN.split(",")[0].trim()}/login`,
    });
    await sendEmail(newEmail, emailChangeVerificationEmail({ link, newEmail }));
    await sendEmail(currentEmail, emailChangeNoticeEmail({ newEmailMasked: maskEmail(newEmail) }));
  } catch (error) {
    console.error("[email-change] failed", error);
    fail("unavailable", REASONS.EMAIL_DELIVERY_FAILED, "We couldn't send the confirmation email. Please try again.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { pendingEmail: newEmail } });
  await writeAuditLog({
    action: "account.email.change_requested",
    outcome: "success",
    userId: user.id,
    email: user.email,
    metadata: { newEmail: maskEmail(newEmail) },
    ...requestMeta(req),
  });
  res.json({ ok: true, maskedEmail: maskEmail(newEmail) });
}

/**
 * POST /api/account/phone/sync — after the browser verified and linked a new phone in Firebase,
 * record it as the authorized admin phone (only possible with a verified session).
 */
export async function syncPhoneNumber(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const token = req.auth!;
  requireRecentAuth(req, 10 * 60);

  const record = await adminAuth.getUser(token.uid);
  if (!record.phoneNumber) fail("failed-precondition", REASONS.INVALID_INPUT, "No verified phone number was found on this account.");

  const taken = await prisma.user.findFirst({ where: { phoneNumber: record.phoneNumber, NOT: { id: user.id } }, select: { id: true } });
  if (taken) fail("already-exists", REASONS.INVALID_INPUT, "This phone number is already in use.");

  await prisma.user.update({ where: { id: user.id }, data: { phoneNumber: record.phoneNumber, phoneVerified: true } });
  await writeAuditLog({
    action: "account.phone.change",
    outcome: "success",
    userId: user.id,
    email: user.email,
    metadata: { from: user.phoneNumber ? maskPhone(user.phoneNumber) : null, to: maskPhone(record.phoneNumber) },
    ...requestMeta(req),
  });
  res.json({ ok: true, maskedPhone: maskPhone(record.phoneNumber) });
}
