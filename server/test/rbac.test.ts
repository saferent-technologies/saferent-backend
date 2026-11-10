import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, ROLES, type PermissionKey, type RoleKey, type Scope } from "../src/rbac/catalog";
import {
  canAssignRole,
  canCreateUserWithRole,
  canEditRolePermissions,
  canManageUser,
  canSetUserPermissions,
  hasPermission,
  resolveEffectivePermissions,
  type Actor,
} from "../src/rbac/policy";

function rolePerms(role: RoleKey) {
  return Object.entries(DEFAULT_ROLE_PERMISSIONS[role]).map(([permissionKey, scope]) => ({ permissionKey, scope: scope as Scope }));
}

function actor(role: RoleKey, id = `${role}-1`, isFounder = false): Actor {
  return { id, role, isFounder, permissions: resolveEffectivePermissions(role, rolePerms(role)) };
}

const target = (role: RoleKey, id = `${role}-target`, isFounder = false) => ({ id, role, isFounder });
const founder = actor("SUPER_ADMIN", "founder", true);

describe("role matrix (least privilege)", () => {
  it("only SUPER_ADMIN holds every permission", () => {
    expect(Object.keys(resolveEffectivePermissions("SUPER_ADMIN", rolePerms("SUPER_ADMIN")))).toHaveLength(PERMISSION_KEYS.length);
    for (const role of ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(Object.keys(resolveEffectivePermissions(role, rolePerms(role))).length).toBeLessThan(PERMISSION_KEYS.length);
    }
  });

  it("reserved permissions never reach other roles, even via role config or grants", () => {
    for (const role of ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      const perms = resolveEffectivePermissions(role, [...rolePerms(role), { permissionKey: "roles.manage", scope: "ALL" }], [
        { permissionKey: "settings.manage", granted: true, scope: "ALL" },
      ]);
      expect(hasPermission(perms, "roles.manage")).toBe(false);
      expect(hasPermission(perms, "settings.manage")).toBe(false);
    }
  });

  it("financial permissions are limited to finance, landlords (own) and tenants (own)", () => {
    const financial: PermissionKey[] = ["payments.view", "payments.manage", "refunds.manage", "finance.reports", "rent.collect"];
    for (const role of ["ADMIN", "SUPPORT", "MODERATOR", "VIEWER", "PROPERTY_MANAGER", "PROPERTY_AGENT", "SERVICE_PROVIDER", "LANDLORD", "TENANT"] as RoleKey[]) {
      const perms = actor(role).permissions;
      for (const p of financial) expect(hasPermission(perms, p), `${role} should not have ${p}`).toBe(false);
    }
    expect(actor("LANDLORD").permissions["rent.view"]).toEqual(["OWN"]);
    expect(actor("TENANT").permissions["rent.view"]).toEqual(["OWN"]);
    expect(actor("FINANCE_ADMIN").permissions["payments.manage"]).toEqual(["ALL"]);
  });

  it("finance admin cannot change roles or security settings", () => {
    const f = actor("FINANCE_ADMIN").permissions;
    expect(hasPermission(f, "roles.manage")).toBe(false);
    expect(hasPermission(f, "users.manage")).toBe(false);
    expect(hasPermission(f, "settings.manage")).toBe(false);
  });

  it("viewer is read-only", () => {
    // profile.manage only covers the viewer's own profile
    const writes = PERMISSION_KEYS.filter((k) => k !== "profile.manage" && /\.(manage|create|approve|verify|collect|pay|work)$/.test(k));
    for (const p of writes) expect(hasPermission(actor("VIEWER").permissions, p)).toBe(false);
  });

  it("individual revokes remove a role permission; grants add one", () => {
    const perms = resolveEffectivePermissions("SUPPORT", rolePerms("SUPPORT"), [
      { permissionKey: "support.manage", granted: false, scope: "ALL" },
      { permissionKey: "reports.view", granted: true, scope: "ALL" },
    ]);
    expect(hasPermission(perms, "support.manage")).toBe(false);
    expect(hasPermission(perms, "reports.view")).toBe(true);
  });
});

describe("role escalation protection", () => {
  it("admins cannot manage other admins, super admins or the founder", () => {
    const admin = actor("ADMIN");
    expect(canManageUser(admin, target("ADMIN")).allowed).toBe(false);
    expect(canManageUser(admin, target("SUPER_ADMIN")).allowed).toBe(false);
    expect(canManageUser(admin, target("SUPER_ADMIN", "founder", true)).allowed).toBe(false);
    expect(canManageUser(admin, target("TENANT")).allowed).toBe(true);
  });

  it("nobody can manage, demote or re-permission the founder", () => {
    const otherSuper = actor("SUPER_ADMIN", "super-2");
    const f = target("SUPER_ADMIN", "founder", true);
    expect(canManageUser(otherSuper, f).allowed).toBe(false);
    expect(canAssignRole(otherSuper, f, "ADMIN").allowed).toBe(false);
    expect(canSetUserPermissions(otherSuper, f, []).allowed).toBe(false);
  });

  it("nobody can change their own role or permissions", () => {
    expect(canAssignRole(founder, target("SUPER_ADMIN", "founder", true), "ADMIN").allowed).toBe(false);
    const sa = actor("SUPER_ADMIN", "sa");
    expect(canSetUserPermissions(sa, target("SUPER_ADMIN", "sa"), []).allowed).toBe(false);
  });

  it("only the founder can create or grant Super Admin", () => {
    expect(canCreateUserWithRole(actor("SUPER_ADMIN", "sa"), "SUPER_ADMIN").allowed).toBe(false);
    expect(canCreateUserWithRole(founder, "SUPER_ADMIN").allowed).toBe(true);
    expect(canAssignRole(actor("SUPER_ADMIN", "sa"), target("ADMIN"), "SUPER_ADMIN").allowed).toBe(false);
    expect(canAssignRole(founder, target("ADMIN"), "SUPER_ADMIN").allowed).toBe(true);
  });

  it("roles without roles.manage cannot assign roles or permissions", () => {
    for (const role of ROLES.filter((r) => r !== "SUPER_ADMIN")) {
      expect(canAssignRole(actor(role), target("TENANT"), "ADMIN").allowed).toBe(false);
      expect(canSetUserPermissions(actor(role), target("TENANT"), [{ permissionKey: "users.view", granted: true, scope: "ALL" }]).allowed).toBe(false);
    }
  });

  it("admins can only create lower roles", () => {
    const admin = actor("ADMIN");
    expect(canCreateUserWithRole(admin, "FINANCE_ADMIN").allowed).toBe(true);
    expect(canCreateUserWithRole(admin, "ADMIN").allowed).toBe(false);
    expect(canCreateUserWithRole(admin, "SUPER_ADMIN").allowed).toBe(false);
    expect(canCreateUserWithRole(actor("FINANCE_ADMIN"), "TENANT").allowed).toBe(false);
  });

  it("reserved permissions cannot be granted to anyone", () => {
    expect(canSetUserPermissions(founder, target("ADMIN"), [{ permissionKey: "roles.manage", granted: true, scope: "ALL" }]).allowed).toBe(false);
    expect(canEditRolePermissions(founder, "ADMIN", [{ permissionKey: "settings.manage", scope: "ALL" }]).allowed).toBe(false);
    expect(canEditRolePermissions(founder, "SUPER_ADMIN", []).allowed).toBe(false);
  });

  it("unknown permissions are rejected", () => {
    expect(canSetUserPermissions(founder, target("ADMIN"), [{ permissionKey: "everything", granted: true, scope: "ALL" }]).allowed).toBe(false);
  });
});
