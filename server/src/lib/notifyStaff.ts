import type { Role } from "@prisma/client";
import type { PermissionKey } from "../rbac/catalog";
import { notify } from "./notify";
import { prisma } from "./prisma";

/**
 * Tell the staff who handle something (permission with ALL scope through their role, an extra role or a
 * personal grant; Super Admin always) — e.g. a new support ticket or a listing waiting for review.
 * In-app + push; the admin portal plays a sound for new notifications. Best effort, never throws.
 * `exceptUserId`: don't notify the person who caused it.
 */
export async function notifyStaff(permission: PermissionKey, title: string, body: string, link: string, exceptUserId?: string): Promise<void> {
  try {
    const roles = (await prisma.rolePermission.findMany({ where: { permissionKey: permission, scope: "ALL" }, select: { role: true } })).map((r) => r.role as Role);
    const roleSet = [...new Set<Role>([...roles, "SUPER_ADMIN"])];
    const users = await prisma.user.findMany({
      where: {
        accountStatus: "ACTIVE",
        OR: [{ role: { in: roleSet } }, { extraRoles: { some: { role: { in: roleSet } } } }, { permissions: { some: { permissionKey: permission, granted: true, scope: "ALL" } } }],
        NOT: [{ permissions: { some: { permissionKey: permission, granted: false } } }, ...(exceptUserId ? [{ id: exceptUserId }] : [])],
      },
      select: { id: true },
      take: 200,
    });
    for (const u of users) await notify(u.id, title, body, link, undefined, { type: "STAFF_ALERT" });
  } catch (err) {
    console.error("[notify-staff] failed", (err as Error).message);
  }
}
