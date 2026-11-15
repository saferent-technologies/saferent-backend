import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_PERMISSIONS, type RoleKey, type Scope } from "../src/rbac/catalog";
import { canDeactivateUser, canDeleteUser, resolveEffectivePermissions, type Actor } from "../src/rbac/policy";

const rows = (roles: RoleKey[]) => roles.flatMap((r) => Object.entries(DEFAULT_ROLE_PERMISSIONS[r]).map(([permissionKey, scope]) => ({ permissionKey, scope: scope as Scope })));
const actor = (role: RoleKey, isFounder = false, extra: Array<{ permissionKey: string; scope: Scope }> = []): Actor => ({
  id: `${role}-actor`, role, roles: [role], isFounder, permissions: resolveEffectivePermissions([role], [...rows([role]), ...extra]),
});
const target = (role: RoleKey, id = `${role}-target`, isFounder = false) => ({ id, role, roles: [role], isFounder });

describe("deactivate / delete users", () => {
  it("Super Admin can deactivate and delete customers", () => {
    const sa = actor("SUPER_ADMIN");
    expect(canDeactivateUser(sa, target("TENANT")).allowed).toBe(true);
    expect(canDeleteUser(sa, target("LANDLORD")).allowed).toBe(true);
  });

  it("Admin can deactivate by default but not delete", () => {
    const admin = actor("ADMIN");
    expect(canDeactivateUser(admin, target("TENANT")).allowed).toBe(true);
    expect(canDeleteUser(admin, target("TENANT")).allowed).toBe(false);
  });

  it("a role granted users.delete can delete lower roles only", () => {
    const admin = actor("ADMIN", false, [{ permissionKey: "users.delete", scope: "ALL" }]);
    expect(canDeleteUser(admin, target("TENANT")).allowed).toBe(true);
    expect(canDeleteUser(admin, target("ADMIN")).allowed).toBe(false);
  });

  it("nobody deletes themselves, the founder, or (unless founder) a Super Admin", () => {
    const sa = actor("SUPER_ADMIN");
    expect(canDeleteUser(sa, { ...target("SUPER_ADMIN"), id: sa.id }).allowed).toBe(false);
    expect(canDeleteUser(sa, target("SUPER_ADMIN", "founder", true)).allowed).toBe(false);
    expect(canDeleteUser(sa, target("SUPER_ADMIN")).allowed).toBe(false);
    expect(canDeleteUser(actor("SUPER_ADMIN", true), target("SUPER_ADMIN")).allowed).toBe(true);
    expect(canDeactivateUser(sa, target("SUPER_ADMIN", "founder", true)).allowed).toBe(false);
  });

  it("customers have neither permission", () => {
    expect(canDeactivateUser(actor("LANDLORD"), target("TENANT")).allowed).toBe(false);
    expect(canDeleteUser(actor("LANDLORD"), target("TENANT")).allowed).toBe(false);
  });
});
