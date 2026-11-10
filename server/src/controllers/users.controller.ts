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
import { me, syncRoleClaim } from "../middleware/auth";
import { ROLES, ROLE_INFO, type RoleKey } from "../rbac/catalog";
import { canAssignRole, canCreateUserWithRole, canManageUser, canSetUserPermissions, type Decision } from "../rbac/policy";
import { effectivePermissionsFor } from "../rbac/service";
import { sendEmail } from "../services/email";
import { staffInviteEmail } from "../services/templates";
import { toAuditEntry, toProfile } from "./serializers";

function enforce(decision: Decision): void {
  if (!decision.allowed) fail("permission-denied", REASONS.PERMISSION_DENIED, decision.reason);
}

function actorOf(req: Request) {
  const user = me(req);
  return { id: user.id, role: user.role as RoleKey, isFounder: user.isFounder, permissions: user.permissions };
}

async function loadTarget(req: Request) {
  return found(await prisma.user.findUnique({ where: { id: idParam(req) } }), "User");
}

/** GET /api/users — search, filter by role/status, paginate. */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const role = enumQuery(req, "role", ROLES);
  const status = enumQuery(req, "status", ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const);
  const where: Prisma.UserWhereInput = {
    ...(role ? { role } : {}),
    ...(status ? { accountStatus: status } : {}),
    ...(p.q ? { OR: [{ fullName: { contains: p.q } }, { email: { contains: p.q } }, { phoneNumber: { contains: p.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(items.map(toProfile), total, p));
}

/** GET /api/users/:id — profile, effective permissions and individual overrides. */
export async function getUser(req: Request, res: Response): Promise<void> {
  const target = await loadTarget(req);
  const [permissions, overrides, session] = await Promise.all([
    effectivePermissionsFor(target),
    prisma.userPermission.findMany({ where: { userId: target.id } }),
    prisma.authSession.findUnique({ where: { userId: target.id } }),
  ]);
  const actor = actorOf(req);
  const t = { id: target.id, role: target.role as RoleKey, isFounder: target.isFounder };
  res.json({
    user: toProfile(target),
    permissions,
    overrides: overrides.map((o) => ({ permissionKey: o.permissionKey, granted: o.granted, scope: o.scope })),
    session: session ? { method: session.method, verifiedAt: session.verifiedAt.toISOString(), expiresAt: session.expiresAt.toISOString(), revoked: session.revoked } : null,
    can: {
      manage: canManageUser(actor, t).allowed,
      assignRole: canAssignRole(actor, t, "VIEWER").allowed,
      setPermissions: canSetUserPermissions(actor, t, []).allowed,
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
  enforce(canManageUser(actorOf(req), { id: target.id, role: target.role as RoleKey, isFounder: target.isFounder }));
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
  enforce(canManageUser(actorOf(req), { id: target.id, role: target.role as RoleKey, isFounder: target.isFounder }));
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
  enforce(canManageUser(actorOf(req), { id: target.id, role: target.role as RoleKey, isFounder: target.isFounder }));
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
  enforce(canAssignRole(actorOf(req), { id: target.id, role: target.role as RoleKey, isFounder: target.isFounder }, role));
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
    if (role === "LANDLORD") await tx.landlordProfile.upsert({ where: { userId: target.id }, create: { userId: target.id }, update: {} });
    if (role === "TENANT") await tx.tenantProfile.upsert({ where: { userId: target.id }, create: { userId: target.id }, update: {} });
    if (role === "PROPERTY_AGENT") await tx.agentProfile.upsert({ where: { userId: target.id }, create: { userId: target.id }, update: {} });
    if (role === "SERVICE_PROVIDER") await tx.serviceProviderProfile.upsert({ where: { userId: target.id }, create: { userId: target.id }, update: {} });
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
  enforce(canSetUserPermissions(actor, { id: target.id, role: target.role as RoleKey, isFounder: target.isFounder }, overrides));

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
  res.json({ ok: true, permissions: await effectivePermissionsFor(target) });
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
    where: { role, accountStatus: "ACTIVE", ...(q ? { OR: [{ fullName: { contains: q } }, { phoneNumber: { contains: q } }] } : {}) },
    select: { id: true, fullName: true, role: true },
    take: 20,
    orderBy: { fullName: "asc" },
  });
  res.json({ items: users });
}
