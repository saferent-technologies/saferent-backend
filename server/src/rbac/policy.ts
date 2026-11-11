/**
 * Pure authorization policies (no database) — unit tested in test/rbac.test.ts.
 */
import { PERMISSION_KEYS, RESERVED_PERMISSIONS, ROLE_INFO, ROLES, type PermissionKey, type RoleKey, type Scope } from "./catalog";

export type EffectivePermissions = Partial<Record<PermissionKey, Scope[]>>;

export interface PermissionOverride {
  permissionKey: string;
  granted: boolean;
  scope: Scope;
}

export interface Actor {
  id: string;
  /** Primary role (users.role). */
  role: RoleKey;
  /** Every role held, primary included. Defaults to [role]. */
  roles?: readonly RoleKey[];
  isFounder: boolean;
  permissions: EffectivePermissions;
}

export interface TargetUser {
  id: string;
  role: RoleKey;
  roles?: readonly RoleKey[];
  isFounder: boolean;
}

/**
 * Roles that can be held IN ADDITION to the primary role (multi-role accounts, e.g. LANDLORD + TENANT).
 * Staff roles are never stacked: a staff identity stays separate from a customer identity.
 */
export const ADDITIONAL_ROLES: readonly RoleKey[] = ["LANDLORD", "TENANT", "PROPERTY_AGENT", "SERVICE_PROVIDER"];
/** Roles a customer may add to their own account without an admin. */
export const SELF_ADDABLE_ROLES: readonly RoleKey[] = ["LANDLORD", "TENANT"];

export function isRole(value: unknown): value is RoleKey {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is PermissionKey {
  return typeof value === "string" && (PERMISSION_KEYS as string[]).includes(value);
}

/**
 * Role permissions + individual overrides. A revoke (granted=false) removes the permission;
 * a grant adds a scope. Reserved permissions are dropped for anyone who is not SUPER_ADMIN.
 */
export function resolveEffectivePermissions(
  role: RoleKey | readonly RoleKey[],
  rolePermissions: Array<{ permissionKey: string; scope: Scope }>,
  overrides: PermissionOverride[] = [],
): EffectivePermissions {
  const roles: readonly RoleKey[] = typeof role === "string" ? [role] : role;
  const result: EffectivePermissions = {};
  const add = (key: string, scope: Scope) => {
    if (!isPermission(key)) return;
    const current = result[key] ?? [];
    if (!current.includes(scope)) result[key] = [...current, scope];
  };
  for (const rp of rolePermissions) add(rp.permissionKey, rp.scope);
  for (const o of overrides) if (o.granted) add(o.permissionKey, o.scope);
  for (const o of overrides) if (!o.granted && isPermission(o.permissionKey)) delete result[o.permissionKey];

  if (!roles.includes("SUPER_ADMIN")) for (const reserved of RESERVED_PERMISSIONS) delete result[reserved];
  for (const key of Object.keys(result) as PermissionKey[]) {
    if (result[key]!.includes("ALL")) result[key] = ["ALL"];
  }
  return result;
}

export function scopesFor(permissions: EffectivePermissions, key: PermissionKey): Scope[] {
  return permissions[key] ?? [];
}

export function hasPermission(permissions: EffectivePermissions, key: PermissionKey, scope?: Scope): boolean {
  const scopes = scopesFor(permissions, key);
  if (scopes.length === 0) return false;
  return scope ? scopes.includes("ALL") || scopes.includes(scope) : true;
}

export function rankOf(role: RoleKey): number {
  return ROLE_INFO[role].rank;
}

/** Highest rank among every role a user holds. */
export function userRank(user: { role: RoleKey; roles?: readonly RoleKey[] }): number {
  return Math.max(rankOf(user.role), ...(user.roles ?? []).map(rankOf));
}

export function rolesOf(user: { role: RoleKey; roles?: readonly RoleKey[] }): RoleKey[] {
  return [user.role, ...(user.roles ?? []).filter((r) => r !== user.role)];
}

export type Decision = { allowed: true } | { allowed: false; reason: string };
const deny = (reason: string): Decision => ({ allowed: false, reason });
const ALLOW: Decision = { allowed: true };

/** Can the actor edit / activate / deactivate / revoke sessions of the target account? */
export function canManageUser(actor: Actor, target: TargetUser): Decision {
  if (!hasPermission(actor.permissions, "users.manage")) return deny("Missing users.manage permission.");
  if (target.isFounder && actor.id !== target.id) return deny("The founder account is protected.");
  if (actor.id === target.id) return deny("You cannot change your own account here.");
  if (actor.isFounder) return ALLOW;
  if (userRank(target) >= userRank(actor)) return deny("You can only manage accounts with a lower role than yours.");
  return ALLOW;
}

/** Can the actor create an account with this role? */
export function canCreateUserWithRole(actor: Actor, role: RoleKey): Decision {
  if (!hasPermission(actor.permissions, "users.manage")) return deny("Missing users.manage permission.");
  if (role === "SUPER_ADMIN" && !actor.isFounder) return deny("Only the founder can create Super Admins.");
  if (actor.isFounder) return ALLOW;
  if (rankOf(role) >= userRank(actor)) return deny("You can only create accounts with a lower role than yours.");
  return ALLOW;
}

/** Can the actor change the target's role to newRole? (requires roles.manage — SUPER_ADMIN only) */
export function canAssignRole(actor: Actor, target: TargetUser, newRole: RoleKey): Decision {
  if (!hasPermission(actor.permissions, "roles.manage")) return deny("Missing roles.manage permission.");
  if (actor.id === target.id) return deny("You cannot change your own role.");
  if (target.isFounder) return deny("The founder's role cannot be changed.");
  if ((newRole === "SUPER_ADMIN" || target.role === "SUPER_ADMIN") && !actor.isFounder) {
    return deny("Only the founder can grant or remove the Super Admin role.");
  }
  return ALLOW;
}

/** Can the actor set these individual permission overrides on the target? */
export function canSetUserPermissions(actor: Actor, target: TargetUser, overrides: PermissionOverride[]): Decision {
  if (!hasPermission(actor.permissions, "roles.manage")) return deny("Missing roles.manage permission.");
  if (actor.id === target.id) return deny("You cannot change your own permissions.");
  if (target.isFounder) return deny("The founder's permissions cannot be changed.");
  if (target.role === "SUPER_ADMIN" && !actor.isFounder) return deny("Only the founder can change a Super Admin's permissions.");
  for (const o of overrides) {
    if (!isPermission(o.permissionKey)) return deny(`Unknown permission: ${o.permissionKey}`);
    if (o.granted && (RESERVED_PERMISSIONS as string[]).includes(o.permissionKey)) {
      return deny(`${o.permissionKey} is reserved for Super Admins.`);
    }
    if (o.granted && !hasPermission(actor.permissions, o.permissionKey, o.scope)) {
      return deny(`You cannot grant ${o.permissionKey} (${o.scope}) because you don't have it.`);
    }
  }
  return ALLOW;
}

/** Can the actor change a role's default permissions? */
export function canEditRolePermissions(actor: Actor, role: RoleKey, permissions: Array<{ permissionKey: string; scope: Scope }>): Decision {
  if (!hasPermission(actor.permissions, "roles.manage")) return deny("Missing roles.manage permission.");
  if (role === "SUPER_ADMIN") return deny("The Super Admin role always has every permission.");
  for (const p of permissions) {
    if (!isPermission(p.permissionKey)) return deny(`Unknown permission: ${p.permissionKey}`);
    if ((RESERVED_PERMISSIONS as string[]).includes(p.permissionKey)) return deny(`${p.permissionKey} is reserved for Super Admins.`);
  }
  return ALLOW;
}

/**
 * Can `actor` add `role` as an ADDITIONAL role to `target`?
 *  - Only customer roles can be stacked, and never on a staff account.
 *  - Customers may add LANDLORD / TENANT to themselves.
 *  - Otherwise users.manage + the normal rank rules apply.
 */
export function canAddRole(actor: Actor, target: TargetUser, role: RoleKey): Decision {
  if (!ADDITIONAL_ROLES.includes(role)) return deny(`${role} cannot be added as an additional role.`);
  if (ROLE_INFO[target.role].isStaff) return deny("Staff accounts cannot hold customer roles. Use a separate account.");
  if (rolesOf(target).includes(role)) return deny("The account already has this role.");
  if (actor.id === target.id) {
    return SELF_ADDABLE_ROLES.includes(role) ? ALLOW : deny("This role can only be added by SafeRent staff.");
  }
  const manage = canManageUser(actor, target);
  if (!manage.allowed) return manage;
  if (!actor.isFounder && rankOf(role) >= userRank(actor)) return deny("You can only add roles lower than yours.");
  return ALLOW;
}

/** Can `actor` remove the ADDITIONAL role `role` from `target`? (The primary role is changed with canAssignRole.) */
export function canRemoveRole(actor: Actor, target: TargetUser, role: RoleKey): Decision {
  if (role === target.role) return deny("The primary role cannot be removed here.");
  if (!(target.roles ?? []).includes(role)) return deny("The account does not have this role.");
  if (actor.id === target.id) return SELF_ADDABLE_ROLES.includes(role) ? ALLOW : deny("Ask SafeRent staff to remove this role.");
  return canManageUser(actor, target);
}
