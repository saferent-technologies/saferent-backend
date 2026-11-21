import { Prisma } from "@prisma/client";
import { sameName } from "../lib/nameLock";
import { kycHistoryOf, kycRemovalState } from "./referrals.controller";
import { landlordUserLookup } from "./tenantLookup.controller";
import type { Request, Response } from "express";
import { z } from "zod";
import { phoneHash } from "../lib/accountBlock";
import { REASONS } from "../config/constants";
import { env } from "../config/env";
import { logActivity } from "../lib/activity";
import { requestMeta, writeAuditLog } from "../lib/audit";
import { fail } from "../lib/errors";
import { adminAuth } from "../lib/firebaseAdmin";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { companyEmailSchema, parseInput, passwordSchema, phoneE164Schema } from "../lib/validation";
import { can, hasRole, me, syncRoleClaim } from "../middleware/auth";
import { ROLES, ROLE_INFO, type RoleKey } from "../rbac/catalog";
import {
  ADDITIONAL_ROLES,
  canAddRole,
  canAssignRole,
  canCreateUserWithRole,
  canDeactivateUser,
  canDeleteUser,
  canManageUser,
  canRemoveRole,
  canSetUserPermissions,
  type Decision,
} from "../rbac/policy";
import { effectivePermissionsFor } from "../rbac/service";
import { sendEmail } from "../services/email";
import { staffInviteEmail } from "../services/templates";
import { shredTenantDocuments } from "./idVault.controller";
import { deleteHomeAlertFor } from "./homeAlerts.controller";
import { clearUserArea } from "./userArea.controller";
import { toAuditEntry, toProfile } from "./serializers";

function enforce(decision: Decision): void {
  if (!decision.allowed) fail("permission-denied", REASONS.PERMISSION_DENIED, decision.reason);
}

function actorOf(req: Request) {
  const user = me(req);
  return { id: user.id, role: user.role as RoleKey, roles: user.roles, isFounder: user.isFounder, permissions: user.permissions };
}

async function loadTarget(req: Request) {
  const user = found(await prisma.user.findUnique({ where: { id: idParam(req) }, include: { extraRoles: { select: { role: true } } } }), "User");
  const { extraRoles, ...rest } = user;
  return { ...rest, roles: [user.role as RoleKey, ...extraRoles.map((r) => r.role as RoleKey).filter((r) => r !== user.role)] };
}

/** Names of the staff who deleted accounts, by user id. */
async function namesById(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
  return new Map(rows.map((r) => [r.id, r.fullName]));
}

type DeletedSnapshot = { fullName?: string; role?: string; phone?: string | null; email?: string | null };

/** Deletion details for staff: when, by whom, why, and who the account was. Null unless deleted. */
function deletionOf(
  u: { accountStatus: string; deletedAt: Date | null; deletedById: string | null; deletionReason: string | null; deletedSnapshot: Prisma.JsonValue | null },
  names: Map<string, string>,
) {
  if (u.accountStatus !== "DELETED") return null;
  const snap = (u.deletedSnapshot ?? {}) as DeletedSnapshot;
  return {
    deletedAt: u.deletedAt?.toISOString() ?? null,
    deletedBy: u.deletedById ? { id: u.deletedById, fullName: names.get(u.deletedById) ?? "Unknown" } : null,
    reason: u.deletionReason,
    formerName: snap.fullName ?? null,
    formerPhone: snap.phone ?? null,
    formerEmail: snap.email ?? null,

  };
}

/** Accounts deleted by the first version of delete had their details erased — they can't be restored. */
function isLegacyErased(u: { firebaseUid: string }): boolean {
  return u.firebaseUid.startsWith("deleted:");
}

/** Owner verification status for the user page: status, note, who / when, manual or not, and what's done. */
async function landlordKycView(
  userId: string,
  l: { kycStatus: string; kycNote: string | null; kycReviewedAt: Date | null; kycReviewedById: string | null; kycManual: boolean; selfiePath: string | null },
) {
  const [digilocker, reviewer] = await Promise.all([
    prisma.identityVerification.count({ where: { userId, status: "COMPLETED" } }),
    l.kycReviewedById ? prisma.user.findUnique({ where: { id: l.kycReviewedById }, select: { fullName: true } }) : null,
  ]);
  return {
    ...(await kycRemovalState(userId, l.kycStatus)),
    // Every verify / reject / remove / restore: who, when, why.
    history: await kycHistoryOf(userId),
    kycStatus: l.kycStatus,
    kycNote: l.kycNote,
    kycReviewedAt: l.kycReviewedAt,
    reviewedBy: reviewer?.fullName ?? null,
    manual: l.kycManual,
    digilockerDone: digilocker > 0,
    selfieDone: !!l.selfiePath,
  };
}

function targetOf(t: { id: string; role: string; roles: RoleKey[]; isFounder: boolean }) {
  return { id: t.id, role: t.role as RoleKey, roles: t.roles, isFounder: t.isFounder };
}

/** Prisma filter: users holding `role` as primary OR additional role. */
export function hasRoleWhere(role: RoleKey): Prisma.UserWhereInput {
  return { OR: [{ role }, { extraRoles: { some: { role } } }] };
}

/** Creates the role's profile row if it does not exist yet. */
export async function ensureRoleProfile(tx: Prisma.TransactionClient, userId: string, role: RoleKey): Promise<void> {
  if (role === "LANDLORD") await tx.landlordProfile.upsert({ where: { userId }, create: { userId }, update: {} });
  if (role === "TENANT") await tx.tenantProfile.upsert({ where: { userId }, create: { userId }, update: {} });
  if (role === "PROPERTY_AGENT") await tx.agentProfile.upsert({ where: { userId }, create: { userId }, update: {} });
  if (role === "SERVICE_PROVIDER") await tx.serviceProviderProfile.upsert({ where: { userId }, create: { userId }, update: {} });
}

/** GET /api/users — search, filter by role/status, paginate. */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const role = enumQuery(req, "role", ROLES);
  const status = enumQuery(req, "status", ["ACTIVE", "SUSPENDED", "DEACTIVATED", "DELETED"] as const);
  const base: Prisma.UserWhereInput[] = [
    role ? hasRoleWhere(role) : {},
    p.q
      ? {
          OR: [
            { fullName: { contains: p.q } },
            { email: { contains: p.q } },
            { phoneNumber: { contains: p.q } },
            // Deleted accounts are found by their former name.
            { deletedSnapshot: { path: "$.fullName", string_contains: p.q } },
          ],
        }
      : {},
  ];
  // Deleted accounts only show on their own tab (?status=DELETED); "All" means every account that isn't deleted.
  const where: Prisma.UserWhereInput = { AND: [...base, status ? { accountStatus: status } : { accountStatus: { not: "DELETED" } }] };
  const [items, total, byStatus] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: status === "DELETED" ? { deletedAt: "desc" } : { createdAt: "desc" },
      skip: p.skip,
      take: p.take,
      include: { extraRoles: { select: { role: true } } },
    }),
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ["accountStatus"], where: { AND: base }, _count: { _all: true } }),
  ]);
  const counts = { ALL: 0, ACTIVE: 0, SUSPENDED: 0, DEACTIVATED: 0, DELETED: 0 };
  for (const row of byStatus) {
    counts[row.accountStatus] = row._count._all;
    if (row.accountStatus !== "DELETED") counts.ALL += row._count._all;
  }
  const deleters = await namesById(items.map((u) => u.deletedById));
  res.json({
    ...paged(items.map(({ extraRoles, ...u }) => ({ ...toProfile(u), roles: [u.role, ...extraRoles.map((r) => r.role)], deletion: deletionOf(u, deleters) })), total, p),
    counts,
  });
}

/** GET /api/users/:id — profile, effective permissions and individual overrides. */
export async function getUser(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  const [permissions, overrides, session, landlord] = await Promise.all([
    effectivePermissionsFor(target, target.roles),
    prisma.userPermission.findMany({ where: { userId: target.id } }),
    prisma.authSession.findUnique({ where: { userId: target.id } }),
    prisma.landlordProfile.findUnique({ where: { userId: target.id }, select: { kycStatus: true, kycNote: true, kycReviewedAt: true, kycReviewedById: true, kycManual: true, selfiePath: true, address: true, city: true, state: true, pincode: true, alternatePhone: true, preferredLanguage: true, preferredContactMethod: true, emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelation: true } }),
  ]);
  const actor = actorOf(req);
  const t = targetOf(target);
  // Finance / support staff without users.view get the profile only — no permissions or session details.
  if (!can(req, "users.view")) {
    res.json({ user: { ...toProfile(target), roles: target.roles }, permissions: null, overrides: [], session: null, landlordKyc: null, can: { manage: false, deactivate: false, delete: false, restore: false, assignRole: false, setPermissions: false, addRoles: [], removeRoles: [] } });
    return;
  }
  res.json({
    user: { ...toProfile(target), roles: target.roles, deletion: deletionOf(target, await namesById([target.deletedById])) },
    permissions,
    overrides: overrides.map((o) => ({ permissionKey: o.permissionKey, granted: o.granted, scope: o.scope })),
    // Landlord identity verification (unlocks referral rewards).
    landlordKyc: target.roles.includes("LANDLORD") && landlord ? await landlordKycView(target.id, landlord) : null,
    // Owner contact details (communication address, alternate number, preferences, emergency contact).
    ownerDetails:
      target.roles.includes("LANDLORD") && landlord
        ? {
            address: landlord.address,
            city: landlord.city,
            state: landlord.state,
            pincode: landlord.pincode,
            alternatePhone: landlord.alternatePhone,
            preferredLanguage: landlord.preferredLanguage,
            preferredContactMethod: landlord.preferredContactMethod,
            emergencyContactName: landlord.emergencyContactName,
            emergencyContactPhone: landlord.emergencyContactPhone,
            emergencyContactRelation: landlord.emergencyContactRelation,
          }
        : null,
    session: session ? { method: session.method, verifiedAt: session.verifiedAt.toISOString(), expiresAt: session.expiresAt.toISOString(), revoked: session.revoked } : null,
    // "Reset profile" history: who, when and why (newest first).
    profileResets: await profileResetsOf(target.id),
    can: {
      manage: canManageUser(actor, t).allowed && target.accountStatus !== "DELETED",
      resetProfile: canManageUser(actor, t).allowed && target.accountStatus !== "DELETED",
      deactivate: canDeactivateUser(actor, t).allowed && target.accountStatus !== "DELETED",
      delete: canDeleteUser(actor, t).allowed && target.accountStatus !== "DELETED",
      restore: canDeleteUser(actor, t).allowed && target.accountStatus === "DELETED" && !isLegacyErased(target),
      assignRole: canAssignRole(actor, t, "VIEWER").allowed,
      setPermissions: canSetUserPermissions(actor, t, []).allowed,
      addRoles: ADDITIONAL_ROLES.filter((r) => canAddRole(actor, t, r).allowed),
      removeRoles: t.roles.filter((r) => canRemoveRole(actor, t, r).allowed),
    },
  });
}

const createSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(ROLES),
    email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("").transform(() => undefined)),
    phoneNumber: phoneE164Schema.optional().or(z.literal("").transform(() => undefined)),
    // Staff: the creator sets the first password, so the person can sign in to the portal straight away.
    password: passwordSchema.optional(),
    requirePasswordChange: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (ROLE_INFO[v.role].isStaff) {
      if (!v.email || !companyEmailSchema.safeParse(v.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Staff accounts need an @saferenttechnologies.com email." });
      }
      if (!v.phoneNumber) ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "Enter the staff member's phone number." });
      if (!v.password) ctx.addIssue({ code: "custom", path: ["password"], message: "Set a password for this staff account." });
    } else if (v.password) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "This role signs in with a phone number and has no password." });
    } else if (!v.phoneNumber) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "This role signs in with a phone number." });
    }
  });

/**
 * POST /api/users — create an account (no public registration for these roles).
 * Staff: company email + phone + password set by the creator → signs in to the portal with that
 *        email + password (then the usual email OTP). `requirePasswordChange` forces a new password first.
 * Agents / service providers / customers: Firebase user with phone → sign in with phone OTP.
 */
export async function createUser(req: Request, res: Response): Promise<void> {
  const actor = actorOf(req);
  const input = parseInput(createSchema, req.body);
  enforce(canCreateUserWithRole(actor, input.role));

  const duplicate = await prisma.user.findFirst({
    where: { OR: [...(input.email ? [{ email: input.email }] : []), ...(input.phoneNumber ? [{ phoneNumber: input.phoneNumber }] : [])] },
    select: { id: true },
  });
  if (duplicate) fail("already-exists", REASONS.CONFLICT, "A user with this email or phone already exists.");

  const isStaff = ROLE_INFO[input.role].isStaff;
  // Reuse an existing Firebase account for this identity if there is one (no duplicate auth accounts).
  const byEmail = input.email ? await adminAuth.getUserByEmail(input.email).catch(() => null) : null;
  const byPhone = input.phoneNumber ? await adminAuth.getUserByPhoneNumber(input.phoneNumber).catch(() => null) : null;
  if (byEmail && byPhone && byEmail.uid !== byPhone.uid) fail("already-exists", REASONS.CONFLICT, "This phone number is already used by another sign-in account.");
  const existingFirebase = byEmail ?? byPhone;
  // Staff: the password set here works immediately (email marked verified: it's a company address the admin typed).
  const credentials = isStaff && input.password ? { password: input.password, emailVerified: true } : {};
  const firebaseUser = existingFirebase
    ? await adminAuth.updateUser(existingFirebase.uid, {
        displayName: input.fullName,
        ...credentials,
        ...(input.phoneNumber && !existingFirebase.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
      })
    : await adminAuth.createUser({
        displayName: input.fullName,
        ...(input.email ? { email: input.email, emailVerified: false } : {}),
        ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
        ...credentials,
      });
  if (isStaff && input.password) await adminAuth.revokeRefreshTokens(firebaseUser.uid); // any old session of a reused account ends
  await adminAuth.setCustomUserClaims(firebaseUser.uid, { role: input.role });

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firebaseUid: firebaseUser.uid,
        fullName: input.fullName,
        email: input.email ?? null,
        phoneNumber: input.phoneNumber ?? null,
        role: input.role,
        createdById: actor.id,
        ...(isStaff && input.password ? { mustChangePassword: input.requirePasswordChange, passwordChangedAt: new Date() } : {}),
      },
    });
    if (input.role === "LANDLORD") await tx.landlordProfile.create({ data: { userId: user.id } });
    if (input.role === "TENANT") await tx.tenantProfile.create({ data: { userId: user.id } });
    if (input.role === "PROPERTY_AGENT") await tx.agentProfile.create({ data: { userId: user.id } });
    if (input.role === "SERVICE_PROVIDER") await tx.serviceProviderProfile.create({ data: { userId: user.id } });
    await logActivity(req, "user.create", "user", user.id, { role: input.role, email: input.email, phoneNumber: input.phoneNumber }, tx);
    return user;
  });

  // Old flow (no password given): email a "set your password" link. The password itself is never emailed or logged.
  if (isStaff && input.email && !input.password) {
    try {
      const link = await adminAuth.generatePasswordResetLink(input.email, { url: `${env.APP_ORIGIN.split(",")[0].trim()}/employee` });
      await sendEmail(input.email, staffInviteEmail({ link, name: input.fullName, roleName: ROLE_INFO[input.role].name }));
    } catch (error) {
      console.error("[users] invite email failed", error);
    }
  }
  await notify(created.id, "Welcome to SafeRent", `Your ${ROLE_INFO[input.role].name} account is ready.`, "/dashboard");
  res.status(201).json({ user: toProfile(created) });
}

const updateSchema = z.object({ fullName: z.string().trim().min(2).max(120) });

/** PATCH /api/users/:id — edit basic details of a lower-ranked user. */
export async function updateUser(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canManageUser(actorOf(req), targetOf(target)));
  const input = parseInput(updateSchema, req.body);
  const lockedChange = target.nameLocked && !sameName(target.fullName, input.fullName);
  // A verified (locked) name: only a Super Admin can change it; the change is audited without the names.
  if (lockedChange && !hasRole(req, "SUPER_ADMIN")) fail("failed-precondition", REASONS.NAME_LOCKED, "This name is verified. Only a Super Admin can change it.");
  const updated = await prisma.user.update({ where: { id: target.id }, data: input });
  if (lockedChange) {
    await logActivity(req, "user.locked_name_change", "user", target.id, { field: "fullName" });
    await writeAuditLog({ action: "account.name.locked_change", outcome: "success", userId: target.id, metadata: { by: me(req).id }, ...requestMeta(req) });
  } else {
    await logActivity(req, "user.update", "user", target.id, { from: { fullName: target.fullName }, to: input });
  }
  res.json({ user: toProfile(updated) });
}

async function revokeEverything(firebaseUid: string, userId: string): Promise<void> {
  await adminAuth.revokeRefreshTokens(firebaseUid);
  await prisma.authSession.updateMany({ where: { userId }, data: { revoked: true, revokedAt: new Date() } });
}

const reasonSchema = z.string().trim().min(5, "Tell us why (at least 5 characters).").max(300);
// A reason is required for every status change (activate too) — it's kept in the activity log.
const statusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]), reason: reasonSchema }).strict();

/** POST /api/users/:id/status — activate, suspend or deactivate (revokes sessions when not active). */
export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canDeactivateUser(actorOf(req), targetOf(target)));
  if (target.accountStatus === "DELETED") fail("failed-precondition", REASONS.INVALID_STATE, "This account has been deleted.");
  const { status, reason } = parseInput(statusSchema, req.body);

  await prisma.user.update({
    where: { id: target.id },
    data: { accountStatus: status, statusReason: status === "ACTIVE" ? null : (reason ?? null), statusChangedAt: new Date() },
  });
  // Only the DB status changes. The API's account gate refuses every request from a non-active account
  // (403 ACCOUNT_DISABLED with the reason), so nothing is revoked: Firebase user, tokens and sessions stay,
  // and re-activating works instantly (the app's "Try again" gets 200). To sign someone out for security,
  // use "Force sign-out" (POST /users/:id/revoke-sessions).
  // (Older accounts that an earlier version disabled in Firebase are re-enabled when activated.)
  if (status === "ACTIVE") await adminAuth.updateUser(target.firebaseUid, { disabled: false }).catch(() => undefined);

  await logActivity(req, "user.status", "user", target.id, { from: target.accountStatus, to: status, reason });
  await writeAuditLog({ action: "account.status.change", outcome: "success", userId: target.id, metadata: { status, by: me(req).id }, ...requestMeta(req) });
  res.json({ ok: true });
}

const resetSchema = z.object({ reason: reasonSchema }).strict();

/**
 * POST /api/v1/users/:id/reset-profile — "Reset user details": clears the demographic details (gender,
 * date of birth, city, state) and marks the profile incomplete, so the app asks for them again on next open.
 * Name, phone, email, roles, properties, leases, payments, reviews and all history stay as they are.
 * Who / when / why is recorded (activity log, shown on the user's page). The old values are not logged.
 */
export async function resetProfile(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canManageUser(actorOf(req), targetOf(target)));
  if (target.accountStatus === "DELETED") fail("failed-precondition", REASONS.INVALID_STATE, "This account has been deleted.");
  const { reason } = parseInput(resetSchema, req.body);
  const cleared = (["gender", "dateOfBirth", "city", "state"] as const).filter((f) => target[f] !== null);
  await prisma.user.update({ where: { id: target.id }, data: { gender: null, dateOfBirth: null, city: null, state: null, profileCompleted: false } });
  await logActivity(req, "user.profile_reset", "user", target.id, { reason, cleared });
  await writeAuditLog({ action: "account.profile.reset", outcome: "success", userId: target.id, metadata: { by: me(req).id }, ...requestMeta(req) });
  await notify(target.id, "Please update your profile", "SafeRent reset your profile details. Open the app and fill them in again.", "/profile", undefined, { type: "PROFILE_RESET" });
  res.locals.message = "User details reset. They'll be asked to fill them in again.";
  res.json({ ok: true, cleared, profileResets: await profileResetsOf(target.id) });
}

async function profileResetsOf(userId: string) {
  const rows = await prisma.adminActivityLog.findMany({ where: { action: "user.profile_reset", targetType: "user", targetId: userId }, orderBy: { createdAt: "desc" }, take: 20 });
  const names = await namesById(rows.map((r) => r.actorId));
  return rows.map((r) => {
    const c = (r.changes ?? {}) as { reason?: string; cleared?: string[] };
    return { at: r.createdAt.toISOString(), by: { id: r.actorId, fullName: names.get(r.actorId) ?? null }, reason: c.reason ?? null, cleared: c.cleared ?? [] };
  });
}

/** POST /api/users/:id/revoke-sessions — sign the user out everywhere. */
/**
 * POST /api/v1/users/:id/revoke-sessions — "Force sign-out" (security: e.g. a hacked account).
 * Revokes Firebase refresh tokens and our sessions; separate from deactivate / delete, which never revoke.
 */
export async function revokeSessions(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canManageUser(actorOf(req), targetOf(target)));
  await revokeEverything(target.firebaseUid, target.id);
  await logActivity(req, "user.sessions.revoke", "user", target.id);
  await writeAuditLog({ action: "account.sessions.revoked", outcome: "success", userId: target.id, metadata: { by: me(req).id }, ...requestMeta(req) });
  res.json({ ok: true });
}

const roleSchema = z.object({ role: z.enum(ROLES) });

/** POST /api/users/:id/role — change role (roles.manage; founder rules apply). */
export async function assignRole(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  const { role } = parseInput(roleSchema, req.body);
  enforce(canAssignRole(actorOf(req), targetOf(target), role));
  if (ROLE_INFO[role].isStaff && (!target.email || !companyEmailSchema.safeParse(target.email).success)) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "Staff roles require an @saferenttechnologies.com email on the account.");
  }
  if (!ROLE_INFO[role].isStaff && !target.phoneNumber) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "This role signs in with a phone number. Add a phone number first.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role } });
    // Individual overrides belong to the old role — clear them.
    await tx.userPermission.deleteMany({ where: { userId: target.id } });
    // Staff identities never keep customer roles; otherwise the new primary role is no longer "additional".
    await tx.userRole.deleteMany({ where: ROLE_INFO[role].isStaff ? { userId: target.id } : { userId: target.id, role } });
    await ensureRoleProfile(tx, target.id, role);
    await logActivity(req, "user.role", "user", target.id, { from: target.role, to: role }, tx);
  });
  await syncRoleClaim(target.firebaseUid, role);
  await revokeEverything(target.firebaseUid, target.id); // new role → fresh sign-in
  await notify(target.id, "Your role was updated", `You are now a ${ROLE_INFO[role].name}. Please sign in again.`);
  res.json({ ok: true });
}

const permissionsSchema = z.object({
  overrides: z
    .array(z.object({ permissionKey: z.string().max(64), granted: z.boolean(), scope: z.enum(["OWN", "ASSIGNED", "ALL"]) }))
    .max(100),
});

/** PUT /api/users/:id/permissions — replace individual permission overrides (roles.manage). */
export async function setUserPermissions(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  const { overrides } = parseInput(permissionsSchema, req.body);
  const actor = actorOf(req);
  enforce(canSetUserPermissions(actor, targetOf(target), overrides));

  const before = await prisma.userPermission.findMany({ where: { userId: target.id } });
  await prisma.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({ where: { userId: target.id } });
    if (overrides.length) {
      await tx.userPermission.createMany({ data: overrides.map((o) => ({ userId: target.id, permissionKey: o.permissionKey, granted: o.granted, scope: o.scope, grantedById: actor.id })) });
    }
    await logActivity(
      req,
      "user.permissions",
      "user",
      target.id,
      { before: before.map((b) => ({ permissionKey: b.permissionKey, granted: b.granted, scope: b.scope })), after: overrides },
      tx,
    );
  });
  res.json({ ok: true, permissions: await effectivePermissionsFor(target, target.roles) });
}

/** GET /api/users/:id/activity — security events + admin actions performed BY and ON this user. */
export async function userActivity(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  const [security, actions] = await Promise.all([
    prisma.auditLog.findMany({ where: { userId: target.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.adminActivityLog.findMany({
      where: { OR: [{ actorId: target.id }, { targetType: "user", targetId: target.id }] },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  res.json({
    security: security.map(toAuditEntry),
    actions: actions.map((a) => ({ id: a.id.toString(), actorId: a.actorId, action: a.action, targetType: a.targetType, targetId: a.targetId, changes: a.changes, createdAt: a.createdAt.toISOString() })),
  });
}

/** GET /api/users/lookup?role=SERVICE_PROVIDER&q= — name-only picker for assigning managers, agents, providers and support staff. */
export async function lookupUsers(req: Request, res: Response): Promise<void> {
  // Landlord: find one tenant by phone / SafeRent ID (to invite them).
  if (req.query.phone !== undefined || req.query.safeRentId !== undefined) return landlordUserLookup(req, res);
  if (!["users.view", "assignments.manage", "maintenance.manage", "support.manage"].some((perm) => can(req, perm as Parameters<typeof can>[1]))) {
    fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  }
  const role = enumQuery(req, "role", ["PROPERTY_MANAGER", "PROPERTY_AGENT", "SERVICE_PROVIDER", "SUPPORT"] as const);
  if (!role) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a role.");
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
  const users = await prisma.user.findMany({
    where: { AND: [hasRoleWhere(role), { accountStatus: "ACTIVE" }, q ? { OR: [{ fullName: { contains: q } }, { phoneNumber: { contains: q } }] } : {}] },
    select: { id: true, fullName: true, role: true },
    take: 20,
    orderBy: { fullName: "asc" },
  });
  res.json({ items: users });
}

/* ─────────────── Multi-role accounts ─────────────── */

const extraRoleSchema = z.object({ role: z.enum(ROLES) }).strict();

async function addRole(req: Request, res: Response, target: Awaited<ReturnType<typeof loadTarget>>, role: RoleKey): Promise<void> {
  enforce(canAddRole(actorOf(req), targetOf(target), role));
  if (!target.phoneNumber) fail("invalid-argument", REASONS.INVALID_INPUT, "This role signs in with a phone number. Add a phone number first.");
  await prisma.$transaction(async (tx) => {
    await tx.userRole.create({ data: { userId: target.id, role, grantedById: me(req).id } });
    await ensureRoleProfile(tx, target.id, role);
    await logActivity(req, "user.role.add", "user", target.id, { role }, tx);
  });
  await writeAuditLog({ action: "account.role.added", outcome: "success", userId: target.id, metadata: { role, by: me(req).id }, ...requestMeta(req) });
  if (target.id !== me(req).id) await notify(target.id, "New role added", `You can now use SafeRent as a ${ROLE_INFO[role].name}.`);
  res.status(201).json({ roles: [...target.roles, role] });
}

async function removeRole(req: Request, res: Response, target: Awaited<ReturnType<typeof loadTarget>>, role: RoleKey): Promise<void> {
  enforce(canRemoveRole(actorOf(req), targetOf(target), role));
  if (role === "LANDLORD") {
    const owned = await prisma.property.count({ where: { ownerId: target.id, activeStatus: { not: "ARCHIVED" } } });
    if (owned) fail("failed-precondition", REASONS.INVALID_STATE, "Archive or transfer the properties owned by this account first.");
  }
  if (role === "TENANT") {
    const leases = await prisma.lease.count({ where: { tenantId: target.id, status: "ACTIVE" } });
    if (leases) fail("failed-precondition", REASONS.INVALID_STATE, "End the active leases of this account first.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.userRole.delete({ where: { userId_role: { userId: target.id, role } } });
    await logActivity(req, "user.role.remove", "user", target.id, { role }, tx);
  });
  await writeAuditLog({ action: "account.role.removed", outcome: "success", userId: target.id, metadata: { role, by: me(req).id }, ...requestMeta(req) });
  res.json({ roles: target.roles.filter((r) => r !== role) });
}

/** POST /api/users/:id/roles — add an additional customer role (users.manage, rank rules apply). */
export async function addUserRole(req: Request, res: Response): Promise<void> {
  const { role } = parseInput(extraRoleSchema, req.body);
  await addRole(req, res, await loadTarget(req), role);
}

/** DELETE /api/users/:id/roles/:role */
export async function removeUserRole(req: Request, res: Response): Promise<void> {
  const role = parseInput(z.enum(ROLES), req.params.role);
  await removeRole(req, res, await loadTarget(req), role);
}

async function loadSelf(req: Request) {
  req.params.id = me(req).id;
  return loadTarget(req);
}

/** GET /api/me/roles — roles held + roles the user can add to their own account. */
export async function myRoles(req: Request, res: Response): Promise<void> {
  const self = await loadSelf(req);
  const actor = actorOf(req);
  res.json({
    roles: self.roles.map((key) => ({ key, ...ROLE_INFO[key], primary: key === self.role })),
    canAdd: ADDITIONAL_ROLES.filter((r) => canAddRole(actor, targetOf(self), r).allowed),
  });
}

/** POST /api/me/roles — e.g. a landlord who also wants to rent (adds TENANT). */
export async function addMyRole(req: Request, res: Response): Promise<void> {
  const { role } = parseInput(extraRoleSchema, req.body);
  await addRole(req, res, await loadSelf(req), role);
}

/** DELETE /api/me/roles/:role */
export async function removeMyRole(req: Request, res: Response): Promise<void> {
  const role = parseInput(z.enum(ROLES), req.params.role);
  await removeRole(req, res, await loadSelf(req), role);
}

const deleteSchema = z.object({ reason: reasonSchema }).strict();

/**
 * DELETE /api/v1/users/:id — delete an account (users.delete; Super Admin by default).
 * Soft delete: the account is marked DELETED and can never sign in again, but ALL of its data stays —
 * profile (name, phone, email, photo, demographics), properties, leases, payments, reviews, consents, KYC
 * and the activity log. Signing in with the same number shows "account deleted" (403 ACCOUNT_DELETED).
 * Refused while the account still has an active lease or a property that isn't archived.
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canDeleteUser(actorOf(req), targetOf(target)));
  if (target.accountStatus === "DELETED") fail("failed-precondition", REASONS.INVALID_STATE, "This account is already deleted.");
  const { reason } = parseInput(deleteSchema, req.body ?? {});

  const [activeLeases, liveProperties] = await Promise.all([
    prisma.lease.count({ where: { status: "ACTIVE", OR: [{ tenantId: target.id }, { landlordId: target.id }] } }),
    prisma.property.count({ where: { ownerId: target.id, activeStatus: { not: "ARCHIVED" } } }),
  ]);
  const blockers = [
    activeLeases ? `${activeLeases} active lease${activeLeases === 1 ? "" : "s"} (end ${activeLeases === 1 ? "it" : "them"} first)` : null,
    liveProperties ? `${liveProperties} propert${liveProperties === 1 ? "y" : "ies"} not archived (archive or transfer ${liveProperties === 1 ? "it" : "them"} first)` : null,
  ].filter(Boolean) as string[];
  if (blockers.length) fail("failed-precondition", REASONS.INVALID_STATE, `This account can't be deleted yet: ${blockers.join("; ")}.`, { activeLeases, liveProperties });

  const before = { fullName: target.fullName, role: target.role, accountStatus: target.accountStatus };
  await prisma.$transaction(async (tx) => {
    // Only the status changes — every profile field is kept as it was.
    await tx.user.update({
      where: { id: target.id },
      data: {
        accountStatus: "DELETED",
        deletedAt: new Date(),
        deletedById: me(req).id,
        deletionReason: reason,
        deletedPhoneHash: target.phoneNumber ? phoneHash(target.phoneNumber) : null,
        deletedSnapshot: { fullName: target.fullName, role: target.role, phone: target.phoneNumber, email: target.email },
        statusChangedAt: new Date(),
      },
    });
    await logActivity(req, "user.delete", "user", target.id, { before, reason }, tx);
  });
  // Only the DB status changes: no Firebase delete/disable, no token or session revoke. The account gate
  // answers 403 ACCOUNT_DELETED to every request, and Restore works without the user signing in again.
  // ID documents vault: crypto-shredded (not brought back by Restore).
  await shredTenantDocuments(target.id, me(req).id);
  await deleteHomeAlertFor(target.id);
  await clearUserArea(target.id);
  await writeAuditLog({ action: "account.deleted", outcome: "success", userId: target.id, metadata: { by: me(req).id, reason }, ...requestMeta(req) });
  res.locals.message = "Account deleted";
  res.json({ ok: true, id: target.id, accountStatus: "DELETED" });
}

/**
 * POST /api/v1/users/:id/restore — bring a deleted account back (users.delete; same rank rules as delete).
 * Body: { reason } (required). The account becomes ACTIVE with all its data; it can sign in again.
 */
export async function restoreUser(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canDeleteUser(actorOf(req), targetOf(target)));
  if (target.accountStatus !== "DELETED") fail("failed-precondition", REASONS.INVALID_STATE, "This account isn't deleted.");
  if (isLegacyErased(target)) fail("failed-precondition", REASONS.INVALID_STATE, "This account's details were erased when it was deleted, so it can't be restored.");
  const { reason } = parseInput(deleteSchema, req.body ?? {});

  const before = { accountStatus: target.accountStatus, deletedAt: target.deletedAt, deletedById: target.deletedById, deletionReason: target.deletionReason };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: {
        accountStatus: "ACTIVE",
        statusReason: null,
        statusChangedAt: new Date(),
        deletedAt: null,
        deletedById: null,
        deletionReason: null,
        deletedPhoneHash: null,
        deletedSnapshot: Prisma.DbNull,
      },
    });
    await logActivity(req, "user.restore", "user", target.id, { before, reason }, tx);
  });
  await adminAuth.updateUser(target.firebaseUid, { disabled: false }).catch(() => undefined);
  await writeAuditLog({ action: "account.restored", outcome: "success", userId: target.id, metadata: { by: me(req).id, reason }, ...requestMeta(req) });
  res.locals.message = "Account restored";
  res.json({ ok: true, id: target.id, accountStatus: "ACTIVE" });
}
