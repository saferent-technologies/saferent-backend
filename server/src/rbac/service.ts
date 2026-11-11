import type { PermissionScope, User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_SETTINGS, PERMISSIONS, PERMISSION_KEYS, ROLES, ROLE_INFO, type PermissionInfo, type RoleKey, type Scope } from "./catalog";
import { resolveEffectivePermissions, type EffectivePermissions } from "./policy";

/**
 * Keeps the MySQL catalog (roles, permissions) in sync with code. Role → permission rows are seeded
 * only for roles that have none yet, so edits made by a Super Admin in the UI are preserved.
 * SUPER_ADMIN is always re-synced to every permission.
 */
export async function syncRbacCatalog(): Promise<void> {
  for (const key of ROLES) {
    const info = ROLE_INFO[key];
    await prisma.roleDefinition.upsert({
      where: { key },
      create: { key, name: info.name, description: info.description, rank: info.rank, isStaff: info.isStaff },
      update: { name: info.name, description: info.description, rank: info.rank, isStaff: info.isStaff },
    });
  }
  const known = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const added = PERMISSION_KEYS.filter((k) => !known.has(k));
  for (const key of PERMISSION_KEYS) {
    const info = PERMISSIONS[key] as PermissionInfo;
    await prisma.permission.upsert({
      where: { key },
      create: { key, category: info.category, description: info.description, reserved: !!info.reserved },
      update: { category: info.category, description: info.description, reserved: !!info.reserved },
    });
  }
  // Remove permissions that no longer exist in code.
  await prisma.permission.deleteMany({ where: { key: { notIn: PERMISSION_KEYS as string[] } } });

  for (const role of ROLES) {
    const count = await prisma.rolePermission.count({ where: { role } });
    if (count > 0 && role !== "SUPER_ADMIN") {
      // A permission that is new in this release gets its default grants once; edits made in the UI
      // to existing permissions are left alone. (Skipped on a fresh database, where nothing is known yet.)
      if (known.size) {
        const rows = added
          .filter((k) => DEFAULT_ROLE_PERMISSIONS[role][k])
          .map((k) => ({ role, permissionKey: k, scope: DEFAULT_ROLE_PERMISSIONS[role][k] as PermissionScope }));
        if (rows.length) await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
      }
      continue;
    }
    await resetRolePermissions(role);
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
  invalidateRoleCache();
}

export async function resetRolePermissions(role: RoleKey): Promise<void> {
  const rows = Object.entries(DEFAULT_ROLE_PERMISSIONS[role]).map(([permissionKey, scope]) => ({ role, permissionKey, scope: scope as PermissionScope }));
  await prisma.$transaction([prisma.rolePermission.deleteMany({ where: { role } }), prisma.rolePermission.createMany({ data: rows })]);
  invalidateRoleCache();
}

// Small in-memory cache of role permissions (refreshed every 30 s or when edited).
let cache: { at: number; map: Map<string, Array<{ permissionKey: string; scope: Scope }>> } | null = null;

export function invalidateRoleCache(): void {
  cache = null;
}

export async function rolePermissions(role: RoleKey): Promise<Array<{ permissionKey: string; scope: Scope }>> {
  if (!cache || Date.now() - cache.at > 30_000) {
    const rows = await prisma.rolePermission.findMany();
    const map = new Map<string, Array<{ permissionKey: string; scope: Scope }>>();
    for (const r of rows) {
      const list = map.get(r.role) ?? [];
      list.push({ permissionKey: r.permissionKey, scope: r.scope });
      map.set(r.role, list);
    }
    cache = { at: Date.now(), map };
  }
  return cache.map.get(role) ?? [];
}

/** All roles held by a user: primary role first, then additional roles from user_roles. */
export async function rolesFor(user: Pick<User, "id" | "role">): Promise<RoleKey[]> {
  const extra = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true }, orderBy: { createdAt: "asc" } });
  return [user.role as RoleKey, ...extra.map((r) => r.role as RoleKey).filter((r) => r !== user.role)];
}

/** Union of the permissions of every role the user holds, plus individual overrides. */
export async function effectivePermissionsFor(user: Pick<User, "id" | "role">, roles?: RoleKey[]): Promise<EffectivePermissions> {
  const allRoles = roles ?? (await rolesFor(user));
  const [roleRows, overrides] = await Promise.all([
    Promise.all(allRoles.map((r) => rolePermissions(r))).then((rows) => rows.flat()),
    prisma.userPermission.findMany({ where: { userId: user.id } }),
  ]);
  return resolveEffectivePermissions(allRoles, roleRows, overrides);
}
