import type { Request, Response } from "express";
import { OTP, RATE_LIMITS, REASONS, SESSION } from "../config/constants";
import { env } from "../config/env";
import { requestMeta, writeAuditLog } from "../lib/audit";
import { evaluateChallenge, resendWaitMs } from "../lib/challenge";
import { fail } from "../lib/errors";
import { adminAuth } from "../lib/firebaseAdmin";
import { maskEmail } from "../lib/mask";
import { generateOtp, hashOtp, newChallengeId, verifyOtpHash } from "../lib/otp";
import { prisma } from "../lib/prisma";
import { consumeRateLimit, consumeRateLimitTx, throwRateLimited } from "../lib/rateLimit";
import { isSessionValid } from "../lib/session";
import { isAllowedEmailDomain, normalizeEmail, parseInput, passwordResetInputSchema, rebindSessionInputSchema, verifyOtpInputSchema } from "../lib/validation";
import { me as currentUser, requireRecentAuth, signInProvider, syncRoleClaim } from "../middleware/auth";
import { ROLE_INFO, type RoleKey } from "../rbac/catalog";
import { effectivePermissionsFor } from "../rbac/service";
import { z } from "zod";
import { notify } from "../lib/notify";
import { sendEmail } from "../services/email";
import { otpEmail, passwordResetEmail } from "../services/templates";
import { toProfile, toSession } from "./serializers";

const appOrigin = () => env.APP_ORIGIN.split(",")[0].trim();

/**
 * GET /api/auth/me — who am I, my role + effective permissions, and is the second factor complete
 * for this sign-in? Phone users without an account get `registrationRequired: true`.
 * Also completes an approved email change (the user clicked the link sent to pendingEmail).
 */
export async function me(req: Request, res: Response): Promise<void> {
  const token = req.auth!;
  let user = await prisma.user.findUnique({ where: { firebaseUid: token.uid } });

  if (!user) {
    if (signInProvider(req) === "phone") {
      res.json({ registrationRequired: true, phoneNumber: token.phone_number ?? null });
      return;
    }
    fail("permission-denied", REASONS.NOT_AUTHORIZED, "This account is not authorized.");
  }
  if (user.accountStatus !== "ACTIVE") fail("permission-denied", REASONS.ACCOUNT_DISABLED, "This account has been disabled.");

  const authEmail = token.email ? normalizeEmail(token.email) : null;
  if (authEmail && user.pendingEmail && authEmail === user.pendingEmail && authEmail !== user.email) {
    user = await prisma.user.update({ where: { id: user.id }, data: { email: authEmail, pendingEmail: null, emailVerified: true } });
    await writeAuditLog({ action: "account.email.change", outcome: "success", userId: user.id, email: authEmail, ...requestMeta(req) });
  }
  void syncRoleClaim(token.uid, user.role, token.role);

  const session = await prisma.authSession.findUnique({ where: { userId: user.id } });
  const sessionValid = isSessionValid(session, token.auth_time, Date.now());
  res.json({
    registrationRequired: false,
    user: toProfile(user),
    roleInfo: { key: user.role, ...ROLE_INFO[user.role as RoleKey] },
    permissions: sessionValid ? await effectivePermissionsFor(user) : {},
    session: sessionValid && session ? toSession(session) : null,
    secondFactorRequired: !sessionValid,
    signInProvider: signInProvider(req) ?? null,
  });
}

/** POST /api/auth/email-otp/request — step 3 of email login: send a 6-digit code. */
export async function requestEmailOtp(req: Request, res: Response): Promise<void> {
  const meta = requestMeta(req);
  const user = currentUser(req);
  const token = req.auth!;

  if (signInProvider(req) !== "password") {
    fail("failed-precondition", REASONS.WRONG_SIGN_IN_METHOD, "Sign in with your email and password first.");
  }
  requireRecentAuth(req, 15 * 60);

  // Email + password login is for SafeRent staff. The domain is an eligibility filter only —
  // authorization comes from the role stored in MySQL.
  if (!ROLE_INFO[user.role as RoleKey].isStaff || !user.email || !isAllowedEmailDomain(user.email)) {
    fail("permission-denied", REASONS.INVALID_DOMAIN, "This account is not authorized.");
  }
  if (!token.email || normalizeEmail(token.email) !== user.email) {
    await writeAuditLog({ action: "auth.otp.request", outcome: "failure", userId: user.id, reason: REASONS.ACCOUNT_MISMATCH, ...meta });
    fail("permission-denied", REASONS.ACCOUNT_MISMATCH, "This account is not authorized.");
  }

  const now = Date.now();
  const challengeId = newChallengeId();
  const code = generateOtp();

  const outcome = await prisma.$transaction(async (tx) => {
    const existing = await tx.otpChallenge.findUnique({ where: { userId: user.id } });
    const waitMs = resendWaitMs(
      existing ? { resendAvailableAtMs: existing.resendAvailableAt.getTime(), consumed: existing.consumed, authTime: existing.authTime } : null,
      token.auth_time,
      now,
    );
    if (waitMs > 0) return { kind: "cooldown" as const, waitMs };

    const limit = await consumeRateLimitTx(tx, `otp-send:${user.id}`, OTP.MAX_SENDS_PER_WINDOW, OTP.SEND_WINDOW_MS);
    if (!limit.allowed) return { kind: "rate_limited" as const, waitMs: limit.retryAfterMs };

    const data = {
      challengeId,
      otpHash: hashOtp(code, challengeId, user.id, env.OTP_PEPPER),
      authTime: token.auth_time,
      attempts: 0,
      maxAttempts: OTP.MAX_VERIFY_ATTEMPTS,
      consumed: false,
      consumedAt: null,
      expiresAt: new Date(now + OTP.TTL_MS),
      resendAvailableAt: new Date(now + OTP.RESEND_COOLDOWN_MS),
      createdAt: new Date(now),
    };
    // Upsert on the single per-user row: any previous challenge is invalidated.
    await tx.otpChallenge.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    return { kind: "issued" as const };
  });

  if (outcome.kind === "cooldown") {
    fail("resource-exhausted", REASONS.RESEND_COOLDOWN, "Please wait before requesting a new code.", {
      retryAfterSeconds: Math.ceil(outcome.waitMs / 1000),
    });
  }
  if (outcome.kind === "rate_limited") {
    await writeAuditLog({ action: "auth.otp.request", outcome: "failure", userId: user.id, email: user.email, reason: REASONS.RATE_LIMITED, ...meta });
    throwRateLimited(outcome.waitMs);
  }

  const email = user.email;
  try {
    await sendEmail(email, otpEmail({ code, minutes: OTP.TTL_MS / 60_000 }));
  } catch (error) {
    console.error("[otp] Email delivery failed", error);
    await prisma.otpChallenge.delete({ where: { userId: user.id } }).catch(() => undefined);
    await writeAuditLog({ action: "auth.otp.request", outcome: "failure", userId: user.id, email: user.email, reason: REASONS.EMAIL_DELIVERY_FAILED, ...meta });
    fail("unavailable", REASONS.EMAIL_DELIVERY_FAILED, "We couldn't send the verification code. Please try again.");
  }

  await writeAuditLog({ action: "auth.otp.request", outcome: "success", userId: user.id, email: user.email, ...meta });
  res.json({
    challengeId,
    maskedEmail: maskEmail(email),
    expiresAt: now + OTP.TTL_MS,
    resendAvailableAt: now + OTP.RESEND_COOLDOWN_MS,
  });
}

/** POST /api/auth/email-otp/verify — verifies the code on the server; creates the bound session. */
export async function verifyEmailOtp(req: Request, res: Response): Promise<void> {
  const meta = requestMeta(req);
  const user = currentUser(req);
  const token = req.auth!;
  const { challengeId, code } = parseInput(verifyOtpInputSchema, req.body);

  const challenge = await prisma.otpChallenge.findUnique({ where: { userId: user.id } });
  const result = evaluateChallenge({
    challenge: challenge
      ? {
          challengeId: challenge.challengeId,
          otpHash: challenge.otpHash,
          authTime: challenge.authTime,
          expiresAtMs: challenge.expiresAt.getTime(),
          resendAvailableAtMs: challenge.resendAvailableAt.getTime(),
          attempts: challenge.attempts,
          maxAttempts: challenge.maxAttempts,
          consumed: challenge.consumed,
        }
      : null,
    challengeId,
    authTime: token.auth_time,
    code,
    nowMs: Date.now(),
    verify: (submitted, hash) => verifyOtpHash(submitted, hash, challengeId, user.id, env.OTP_PEPPER),
  });

  if (!result.ok) {
    if (result.incrementAttempts) {
      // Atomic: only counts while attempts are still below the limit.
      await prisma.otpChallenge.updateMany({
        where: { userId: user.id, challengeId, attempts: { lt: OTP.MAX_VERIFY_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
    }
    await writeAuditLog({ action: "auth.otp.verify", outcome: "failure", userId: user.id, email: user.email, reason: result.reason, ...meta });
    const errorCode = result.reason === "OTP_EXPIRED" || result.reason === "CHALLENGE_NOT_FOUND" ? "deadline-exceeded" : "permission-denied";
    fail(errorCode, result.reason, "Verification failed.", { attemptsRemaining: result.attemptsRemaining ?? null });
  }

  const now = Date.now();
  await prisma.$transaction(async (tx) => {
    // Atomic consume: two parallel requests with the same code cannot both succeed (no replay).
    const consumed = await tx.otpChallenge.updateMany({
      where: { userId: user.id, challengeId, consumed: false, attempts: { lt: OTP.MAX_VERIFY_ATTEMPTS } },
      data: { consumed: true, consumedAt: new Date(now) },
    });
    if (consumed.count !== 1) fail("permission-denied", REASONS.OTP_ALREADY_USED, "Verification failed.");

    const session = {
      authTime: token.auth_time,
      method: "EMAIL_OTP" as const,
      verifiedAt: new Date(now),
      expiresAt: new Date(now + SESSION.TTL_MS),
      revoked: false,
      revokedAt: null,
      ip: meta.ip,
      userAgent: meta.userAgent,
    };
    await tx.authSession.upsert({ where: { userId: user.id }, create: { userId: user.id, ...session }, update: session });
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(now), emailVerified: true } });
  });

  void syncRoleClaim(token.uid, user.role, token.role);
  await writeAuditLog({ action: "auth.login", outcome: "success", userId: user.id, email: user.email, metadata: { method: "email_otp" }, ...meta });
  res.json({ ok: true, mustChangePassword: user.mustChangePassword });
}

function phoneSessionData(authTime: number, meta: { ip: string | null; userAgent: string | null }) {
  const now = Date.now();
  return {
    authTime,
    method: "PHONE_OTP" as const,
    verifiedAt: new Date(now),
    expiresAt: new Date(now + SESSION.TTL_MS),
    revoked: false,
    revokedAt: null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

/**
 * POST /api/auth/phone/complete — after Firebase Phone Auth succeeds.
 * Existing account → the phone must match the registered number → verified session.
 * No account yet → { registrationRequired: true } (landlords and tenants can sign up).
 */
export async function completePhoneLogin(req: Request, res: Response): Promise<void> {
  const meta = requestMeta(req);
  const token = req.auth!;

  if (signInProvider(req) !== "phone") {
    fail("failed-precondition", REASONS.WRONG_SIGN_IN_METHOD, "Sign in with your phone number first.");
  }
  requireRecentAuth(req, 15 * 60);

  const user = await prisma.user.findUnique({ where: { firebaseUid: token.uid } });
  if (!user) {
    res.json({ ok: true, registrationRequired: true });
    return;
  }
  if (user.accountStatus !== "ACTIVE") fail("permission-denied", REASONS.ACCOUNT_DISABLED, "This account has been disabled.");
  if (!user.phoneNumber || token.phone_number !== user.phoneNumber) {
    await writeAuditLog({ action: "auth.login", outcome: "failure", userId: user.id, reason: REASONS.ACCOUNT_MISMATCH, metadata: { method: "phone_otp" }, ...meta });
    fail("permission-denied", REASONS.ACCOUNT_MISMATCH, "This phone number is not authorized.");
  }

  await consumeRateLimit(`phone-login:${user.id}`, RATE_LIMITS.PHONE_LOGIN.limit, RATE_LIMITS.PHONE_LOGIN.windowMs);
  const session = phoneSessionData(token.auth_time, meta);
  await prisma.$transaction([
    prisma.authSession.upsert({ where: { userId: user.id }, create: { userId: user.id, ...session }, update: session }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), phoneVerified: true } }),
  ]);
  void syncRoleClaim(token.uid, user.role, token.role);

  await writeAuditLog({ action: "auth.login", outcome: "success", userId: user.id, email: user.email, metadata: { method: "phone_otp" }, ...meta });
  res.json({ ok: true, registrationRequired: false, mustChangePassword: user.mustChangePassword });
}

const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  role: z.enum(["LANDLORD", "TENANT"]),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * POST /api/auth/register — self sign-up for LANDLORD / TENANT only, with a phone number that
 * Firebase has just verified. Reuses the Firebase account (no duplicates) and never allows
 * choosing a staff role.
 */
export async function register(req: Request, res: Response): Promise<void> {
  const meta = requestMeta(req);
  const token = req.auth!;
  if (signInProvider(req) !== "phone" || !token.phone_number) {
    fail("failed-precondition", REASONS.WRONG_SIGN_IN_METHOD, "Verify your phone number first.");
  }
  requireRecentAuth(req, 15 * 60);
  const input = parseInput(registerSchema, req.body);
  await consumeRateLimit(`register:${token.uid}`, RATE_LIMITS.REGISTRATION.limit, RATE_LIMITS.REGISTRATION.windowMs);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ firebaseUid: token.uid }, { phoneNumber: token.phone_number }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true, firebaseUid: true, email: true },
  });
  if (existing) {
    const emailTaken = input.email && existing.email === input.email && existing.firebaseUid !== token.uid;
    fail("already-exists", emailTaken ? REASONS.EMAIL_IN_USE : REASONS.ALREADY_REGISTERED, emailTaken ? "This email address is already in use." : "This account is already registered.");
  }

  const role = input.role as RoleKey;
  const session = phoneSessionData(token.auth_time, meta);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        firebaseUid: token.uid,
        fullName: input.fullName,
        email: input.email ?? null,
        phoneNumber: token.phone_number!,
        role,
        phoneVerified: true,
        lastLoginAt: new Date(),
      },
    });
    if (role === "LANDLORD") await tx.landlordProfile.create({ data: { userId: created.id } });
    else await tx.tenantProfile.create({ data: { userId: created.id } });
    await tx.authSession.create({ data: { userId: created.id, ...session } });
    return created;
  });
  await syncRoleClaim(token.uid, role);

  await writeAuditLog({ action: "auth.register", outcome: "success", userId: user.id, metadata: { role }, ...meta });
  await notify(user.id, `Welcome to SafeRent, ${user.fullName.split(" ")[0]}!`, role === "LANDLORD" ? "Add your first property to start receiving tenant applications." : "Browse verified rental properties and apply in a few taps.", role === "LANDLORD" ? "/properties/new" : "/browse");
  res.status(201).json({ ok: true });
}

/**
 * POST /api/auth/session/rebind — after the password is re-confirmed, Firebase issues a new
 * auth_time. The browser proves it held the verified session by sending its previous ID token.
 */
export async function rebindSession(req: Request, res: Response): Promise<void> {
  const user = currentUser(req);
  const token = req.auth!;
  const { previousIdToken } = parseInput(rebindSessionInputSchema, req.body);
  requireRecentAuth(req, 2 * 60);

  const previous = await adminAuth.verifyIdToken(previousIdToken, true).catch(() => null);
  if (!previous || previous.uid !== token.uid || previous.auth_time >= token.auth_time) {
    fail("permission-denied", REASONS.SESSION_REQUIRED, "Your session has expired. Please sign in again.");
  }

  const session = await prisma.authSession.findUnique({ where: { userId: user.id } });
  if (!isSessionValid(session, previous.auth_time, Date.now())) {
    fail("permission-denied", REASONS.SESSION_REQUIRED, "Your session has expired. Please sign in again.");
  }
  // Conditional update guards against a concurrent rebind.
  const updated = await prisma.authSession.updateMany({
    where: { userId: user.id, authTime: previous.auth_time, revoked: false },
    data: { authTime: token.auth_time },
  });
  if (updated.count !== 1) fail("permission-denied", REASONS.SESSION_REQUIRED, "Your session has expired. Please sign in again.");

  await writeAuditLog({ action: "auth.reauthenticate", outcome: "success", userId: user.id, ...requestMeta(req) });
  res.json({ ok: true });
}

/** POST /api/auth/logout — revokes the verified session server-side. */
export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.auth!;
  const user = await prisma.user.findUnique({ where: { firebaseUid: token.uid }, select: { id: true } });
  if (user) {
    await prisma.authSession.updateMany({ where: { userId: user.id }, data: { revoked: true, revokedAt: new Date() } });
    await writeAuditLog({ action: "auth.logout", outcome: "success", userId: user.id, ...requestMeta(req) });
  }
  res.json({ ok: true });
}

/**
 * POST /api/auth/password-reset — sends a reset link ONLY to active Super Admins.
 * Always returns the same response so it can't be used to discover which emails exist.
 */
export async function requestPasswordReset(req: Request, res: Response): Promise<void> {
  const meta = requestMeta(req);
  const { email } = parseInput(passwordResetInputSchema, req.body);
  const generic = { ok: true };

  if (meta.ip) {
    await consumeRateLimit(`pwreset-ip:${meta.ip}`, RATE_LIMITS.PASSWORD_RESET_PER_IP.limit, RATE_LIMITS.PASSWORD_RESET_PER_IP.windowMs);
  }
  await consumeRateLimit(`pwreset-email:${email}`, RATE_LIMITS.PASSWORD_RESET_PER_EMAIL.limit, RATE_LIMITS.PASSWORD_RESET_PER_EMAIL.windowMs);

  if (!isAllowedEmailDomain(email)) {
    res.json(generic);
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  // Password reset is only for staff (email + password) accounts.
  if (!user || !ROLE_INFO[user.role as RoleKey].isStaff || user.accountStatus !== "ACTIVE") {
    if (user) await writeAuditLog({ action: "auth.password_reset.request", outcome: "failure", userId: user.id, email, reason: "NOT_ELIGIBLE", ...meta });
    res.json(generic);
    return;
  }

  try {
    const link = await adminAuth.generatePasswordResetLink(email, { url: `${appOrigin()}/login` });
    await sendEmail(email, passwordResetEmail({ link }));
    await writeAuditLog({ action: "auth.password_reset.request", outcome: "success", userId: user.id, email, ...meta });
  } catch (error) {
    console.error("[password-reset] failed", error);
    await writeAuditLog({ action: "auth.password_reset.request", outcome: "failure", userId: user.id, email, reason: "DELIVERY_FAILED", ...meta });
  }
  res.json(generic);
}
