import type { NextFunction, Request, RequestHandler, Response } from "express";
import { REASONS, SESSION } from "../config/constants";
import { writeAuditLog } from "../lib/audit";
import { AppError, fail } from "../lib/errors";
import { adminAuth } from "../lib/firebaseAdmin";
import { prisma } from "../lib/prisma";
import { isSessionValid, secondsSince } from "../lib/session";
import type { PermissionKey, Scope } from "../rbac/catalog";
import { hasPermission } from "../rbac/policy";
import { effectivePermissionsFor } from "../rbac/service";
import type { AuthedUser } from "../types/express";
import { verifyAppCheck } from "./appCheck";

/**
 * Verifies the Firebase ID token sent as `Authorization: Bearer <token>`.
 * checkRevoked=true rejects disabled users and tokens revoked by a password change / session revoke.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next(new AppError("unauthenticated", REASONS.UNAUTHENTICATED, "Please sign in to continue."));
  try {
    req.auth = await adminAuth.verifyIdToken(token, true);
    next();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-disabled") return next(new AppError("permission-denied", REASONS.ACCOUNT_DISABLED, "This account has been disabled."));
    next(new AppError("unauthenticated", REASONS.SESSION_REQUIRED, "Your session has expired. Please sign in again."));
  }
}

/**
 * Loads the SafeRent account for the Firebase user (MySQL is the source of truth for roles)
 * and computes the effective permissions (role permissions + individual overrides).
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.auth;
  if (!token) return next(new AppError("unauthenticated", REASONS.UNAUTHENTICATED, "Please sign in to continue."));

  const user = await prisma.user.findUnique({ where: { firebaseUid: token.uid } });
  if (!user) {
    const phone = token.firebase?.sign_in_provider === "phone";
    return next(
      phone
        ? new AppError("permission-denied", REASONS.REGISTRATION_REQUIRED, "Please complete your registration.")
        : new AppError("permission-denied", REASONS.NOT_AUTHORIZED, "This account is not authorized."),
    );
  }
  if (user.accountStatus !== "ACTIVE") {
    return next(new AppError("permission-denied", REASONS.ACCOUNT_DISABLED, "This account has been disabled."));
  }
  req.user = { ...user, permissions: await effectivePermissionsFor(user) };
  next();
}

/** The second factor (email OTP for staff, phone OTP for others) is complete for the CURRENT sign-in. */
export async function requireSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  const token = req.auth;
  if (!user || !token) return next(new AppError("unauthenticated", REASONS.UNAUTHENTICATED, "Please sign in to continue."));
  const session = await prisma.authSession.findUnique({ where: { userId: user.id } });
  if (!session || !isSessionValid(session, token.auth_time, Date.now())) {
    return next(new AppError("permission-denied", REASONS.SESSION_REQUIRED, "Your session has expired. Please sign in again."));
  }
  req.authSession = session;
  next();
}

/** Requires ALL listed permissions (any scope). Resource-level scope is applied in the handler. */
export function requirePermission(...permissions: PermissionKey[]): RequestHandler {
  return async (req, _res, next) => {
    const user = req.user;
    const missing = permissions.filter((p) => !user || !hasPermission(user.permissions, p));
    if (missing.length === 0) return next();
    await writeAuditLog({
      action: "authz.denied",
      outcome: "failure",
      userId: user?.id,
      reason: REASONS.PERMISSION_DENIED,
      ip: req.ip ?? null,
      metadata: { route: `${req.method} ${req.baseUrl}${req.route?.path ?? ""}`, missing },
    });
    next(new AppError("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that."));
  };
}

/** Requires at least ONE of the listed permissions. */
export function requireAnyPermission(...permissions: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user && permissions.some((p) => hasPermission(req.user!.permissions, p))) return next();
    next(new AppError("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that."));
  };
}

/**
 * Standard protection chain for business APIs:
 *   App Check → Firebase token → active SafeRent account → verified session → permissions
 */
export function protect(...permissions: PermissionKey[]): RequestHandler[] {
  const chain: RequestHandler[] = [verifyAppCheck, authenticate, loadUser, requireSession];
  if (permissions.length) chain.push(requirePermission(...permissions));
  return chain;
}

/** Sensitive operations require a sign-in or password re-confirmation within the last few minutes. */
export function requireRecentAuth(req: Request, maxAgeSeconds: number = SESSION.RECENT_AUTH_MAX_AGE_S): void {
  if (!req.auth || secondsSince(req.auth.auth_time, Date.now()) > maxAgeSeconds) {
    fail("failed-precondition", REASONS.RECENT_LOGIN_REQUIRED, "Please confirm your password to continue.");
  }
}

export function signInProvider(req: Request): string | undefined {
  return req.auth?.firebase?.sign_in_provider;
}

/** The authenticated user inside a handler (after loadUser). */
export function me(req: Request): AuthedUser {
  if (!req.user) throw new AppError("unauthenticated", REASONS.UNAUTHENTICATED, "Please sign in to continue.");
  return req.user;
}

export function can(req: Request, permission: PermissionKey, scope?: Scope): boolean {
  return !!req.user && hasPermission(req.user.permissions, permission, scope);
}

/** Keeps the Firebase custom claim in sync with the MySQL role (informational; MySQL is authoritative). */
export async function syncRoleClaim(firebaseUid: string, role: string, current?: unknown): Promise<void> {
  if (current === role) return;
  try {
    await adminAuth.setCustomUserClaims(firebaseUid, { role });
  } catch (error) {
    console.error("[claims] could not sync role claim", error);
  }
}
