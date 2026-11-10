import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { PERMISSIONS, PERMISSION_KEYS, ROLES, ROLE_INFO, type PermissionInfo, type RoleKey } from "../rbac/catalog";
import { canEditRolePermissions, isRole } from "../rbac/policy";
import { invalidateRoleCache, resetRolePermissions } from "../rbac/service";

/** GET /api/roles — roles, permission catalog and the current role → permission matrix. */
export async function listRoles(_req: Request, res: Response): Promise<void> {
  const [rows, counts] = await Promise.all([
    prisma.rolePermission.findMany(),
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
  ]);
  const matrix: Record<string, Record<string, string>> = {};
  for (const r of rows) (matrix[r.role] ??= {})[r.permissionKey] = r.scope;
  res.json({
    roles: ROLES.map((key) => ({
      key,
      ...ROLE_INFO[key],
      userCount: counts.find((c) => c.role === key)?._count._all ?? 0,
      permissions: matrix[key] ?? {},
    })),
    permissions: PERMISSION_KEYS.map((key) => ({ key, ...(PERMISSIONS[key] as PermissionInfo) })),
  });
}

const rolePermissionsSchema = z.object({
  permissions: z.array(z.object({ permissionKey: z.string().max(64), scope: z.enum(["OWN", "ASSIGNED", "ALL"]) })).max(PERMISSION_KEYS.length),
});

function roleParam(req: Request): RoleKey {
  const role = req.params.role;
  if (!isRole(role)) fail("not-found", REASONS.NOT_FOUND, "Role not found.");
  return role;
}

/** PUT /api/roles/:role/permissions — replace a role's permissions (roles.manage; SUPER_ADMIN role is fixed). */
export async function setRolePermissions(req: Request, res: Response): Promise<void> {
  const role = roleParam(req);
  const { permissions } = parseInput(rolePermissionsSchema, req.body);
  const actor = me(req);
  const decision = canEditRolePermissions({ id: actor.id, role: actor.role as RoleKey, isFounder: actor.isFounder, permissions: actor.permissions }, role, permissions);
  if (!decision.allowed) fail("permission-denied", REASONS.PERMISSION_DENIED, decision.reason);

  const before = await prisma.rolePermission.findMany({ where: { role } });
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { role } });
    if (permissions.length) await tx.rolePermission.createMany({ data: permissions.map((p) => ({ role, permissionKey: p.permissionKey, scope: p.scope })) });
    await logActivity(req, "role.permissions", "role", role, { before: before.map((b) => ({ permissionKey: b.permissionKey, scope: b.scope })), after: permissions }, tx);
  });
  invalidateRoleCache();
  res.json({ ok: true });
}

/** POST /api/roles/:role/reset — restore the default matrix for a role. */
export async function resetRole(req: Request, res: Response): Promise<void> {
  const role = roleParam(req);
  if (role === "SUPER_ADMIN") fail("invalid-argument", REASONS.INVALID_INPUT, "The Super Admin role always has every permission.");
  await resetRolePermissions(role);
  await logActivity(req, "role.reset", "role", role);
  res.json({ ok: true });
}
