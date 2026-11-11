import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { env } from "../config/env";
import { logActivity } from "../lib/activity";
import { requestMeta, writeAuditLog } from "../lib/audit";
import { fail } from "../lib/errors";
import { adminAuth } from "../lib/firebaseAdmin";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { companyEmailSchema, parseInput, phoneE164Schema } from "../lib/validation";
import { can, me, syncRoleClaim } from "../middleware/auth";
import { ROLES, ROLE_INFO, type RoleKey } from "../rbac/catalog";
import {
  ADDITIONAL_ROLES,
  canAddRole,
  canAssignRole,
  canCreateUserWithRole,
  canManageUser,
  canRemoveRole,
  canSetUserPermissions,
  type Decision,
} from "../rbac/policy";
import { effectivePermissionsFor } from "../rbac/service";
import { sendEmail } from "../services/email";
import { staffInviteEmail } from "../services/templates";
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
  const status = enumQuery(req, "status", ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const);
  const where: Prisma.UserWhereInput = {
    AND: [
      role ? hasRoleWhere(role) : {},
      status ? { accountStatus: status } : {},
      p.q ? { OR: [{ fullName: { contains: p.q } }, { email: { contains: p.q } }, { phoneNumber: { contains: p.q } }] } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { extraRoles: { select: { role: true } } } }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(items.map(({ extraRoles, ...u }) => ({ ...toProfile(u), roles: [u.role, ...extraRoles.map((r) => r.role)] })), total, p));
}

/** GET /api/users/:id — profile, effective permissions and individual overrides. */
export async function getUser(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  const [permissions, overrides, session, landlord] = await Promise.all([
    effectivePermissionsFor(target, target.roles),
    prisma.userPermission.findMany({ where: { userId: target.id } }),
    prisma.authSession.findUnique({ where: { userId: target.id } }),
    prisma.landlordProfile.findUnique({ where: { userId: target.id }, select: { kycStatus: true, kycNote: true, kycReviewedAt: true } }),
  ]);
  const actor = actorOf(req);
  const t = targetOf(target);
  // Finance / support staff without users.view get the profile only — no permissions or session details.
  if (!can(req, "users.view")) {
    res.json({ user: { ...toProfile(target), roles: target.roles }, permissions: null, overrides: [], session: null, landlordKyc: null, can: { manage: false, assignRole: false, setPermissions: false, addRoles: [], removeRoles: [] } });
    return;
  }
  res.json({
    user: { ...toProfile(target), roles: target.roles },
    permissions,
    overrides: overrides.map((o) => ({ permissionKey: o.permissionKey, granted: o.granted, scope: o.scope })),
    // Landlord identity verification (unlocks referral rewards).
    landlordKyc: target.roles.includes("LANDLORD") && landlord ? landlord : null,
    session: session ? { method: session.method, verifiedAt: session.verifiedAt.toISOString(), expiresAt: session.expiresAt.toISOString(), revoked: session.revoked } : null,
    can: {
      manage: canManageUser(actor, t).allowed,
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
  })
  .superRefine((v, ctx) => {
    if (ROLE_INFO[v.role].isStaff) {
      if (!v.email || !companyEmailSchema.safeParse(v.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Staff accounts need an @saferenttechnologies.com email." });
      }
    } else if (!v.phoneNumber) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "This role signs in with a phone number." });
    }
  });

/**
 * POST /api/users — create an account (no public registration for these roles).
 * Staff: Firebase user with company email → "set your password" link emailed.
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
  const existingFirebase = await (input.email ? adminAuth.getUserByEmail(input.email) : adminAuth.getUserByPhoneNumber(input.phoneNumber!)).catch(() => null);
  const firebaseUser =
    existingFirebase ??
    (await adminAuth.createUser({
      displayName: input.fullName,
      ...(input.email ? { email: input.email, emailVerified: false } : {}),
      ...(input.phoneNumber ? { phoneNumber: input.phoneNumber } : {}),
    }));
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
      },
    });
    if (input.role === "LANDLORD") await tx.landlordProfile.create({ data: { userId: user.id } });
    if (input.role === "TENANT") await tx.tenantProfile.create({ data: { userId: user.id } });
    if (input.role === "PROPERTY_AGENT") await tx.agentProfile.create({ data: { userId: user.id } });
    if (input.role === "SERVICE_PROVIDER") await tx.serviceProviderProfile.create({ data: { userId: user.id } });
    await logActivity(req, "user.create", "user", user.id, { role: input.role, email: input.email, phoneNumber: input.phoneNumber }, tx);
    return user;
  });

  if (isStaff && input.email) {
    try {
      const link = await adminAuth.generatePasswordResetLink(input.email, { url: `${env.APP_ORIGIN.split(",")[0].trim()}/login` });
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
  const updated = await prisma.user.update({ where: { id: target.id }, data: input });
  await logActivity(req, "user.update", "user", target.id, { from: { fullName: target.fullName }, to: input });
  res.json({ user: toProfile(updated) });
}

async function revokeEverything(firebaseUid: string, userId: string): Promise<void> {
  await adminAuth.revokeRefreshTokens(firebaseUid);
  await prisma.authSession.updateMany({ where: { userId }, data: { revoked: true, revokedAt: new Date() } });
}

const statusSchema = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]), reason: z.string().trim().max(300).optional() });

/** POST /api/users/:id/status — activate, suspend or deactivate (revokes sessions when not active). */
export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  enforce(canManageUser(actorOf(req), targetOf(target)));
  const { status, reason } = parseInput(statusSchema, req.body);

  await prisma.user.update({ where: { id: target.id }, data: { accountStatus: status } });
  await adminAuth.updateUser(target.firebaseUid, { disabled: status !== "ACTIVE" });
  if (status !== "ACTIVE") await revokeEverything(target.firebaseUid, target.id);

  await logActivity(req, "user.status", "user", target.id, { from: target.accountStatus, to: status, reason });
  await writeAuditLog({ action: "account.status.change", outcome: "success", userId: target.id, metadata: { status, by: me(req).id }, ...requestMeta(req) });
  res.json({ ok: true });
}

/** POST /api/users/:id/revoke-sessions — sign the user out everywhere. */
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
