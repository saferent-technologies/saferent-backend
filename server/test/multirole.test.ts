import { describe, expect, it } from "vitest";
import { propertyWhere } from "../src/rbac/access";
import { DEFAULT_ROLE_PERMISSIONS, type RoleKey, type Scope } from "../src/rbac/catalog";
import { canAddRole, canManageUser, canRemoveRole, hasPermission, resolveEffectivePermissions, userRank, type Actor } from "../src/rbac/policy";

const rows = (roles: RoleKey[]) => roles.flatMap((r) => Object.entries(DEFAULT_ROLE_PERMISSIONS[r]).map(([permissionKey, scope]) => ({ permissionKey, scope: scope as Scope })));
const actor = (role: RoleKey, roles: RoleKey[] = [role], id = `${role}-1`, isFounder = false): Actor => ({ id, role, roles, isFounder, permissions: resolveEffectivePermissions(roles, rows(roles)) });

describe("multi-role accounts", () => {
  it("a landlord who is also a tenant gets the union of both roles", () => {
    const both = actor("LANDLORD", ["LANDLORD", "TENANT"]);
    expect(hasPermission(both.permissions, "properties.create")).toBe(true);
    expect(hasPermission(both.permissions, "applications.create")).toBe(true);
    expect(hasPermission(both.permissions, "rent.pay")).toBe(true);
    // Still only their OWN properties.
    expect(propertyWhere(both, "properties.manage")).toEqual({ ownerId: both.id });
  });

  it("reserved permissions never come from stacked roles", () => {
    const both = actor("LANDLORD", ["LANDLORD", "TENANT"]);
    expect(both.permissions["roles.manage"]).toBeUndefined();
    expect(both.permissions["settings.manage"]).toBeUndefined();
  });

  it("customers can add LANDLORD / TENANT to themselves but nothing else", () => {
    const tenant = actor("TENANT");
    const self = { id: tenant.id, role: "TENANT" as const, roles: ["TENANT" as const], isFounder: false };
    expect(canAddRole(tenant, self, "LANDLORD").allowed).toBe(true);
    expect(canAddRole(tenant, self, "PROPERTY_AGENT").allowed).toBe(false);
    expect(canAddRole(tenant, self, "ADMIN").allowed).toBe(false);
    expect(canAddRole(tenant, self, "TENANT").allowed).toBe(false);
  });

  it("staff identities never stack customer roles", () => {
    const admin = actor("ADMIN");
    const staffTarget = { id: "support-1", role: "SUPPORT" as const, roles: ["SUPPORT" as const], isFounder: false };
    expect(canAddRole(admin, staffTarget, "TENANT").allowed).toBe(false);
    const adminSelf = { id: admin.id, role: "ADMIN" as const, roles: ["ADMIN" as const], isFounder: false };
    expect(canAddRole(admin, adminSelf, "LANDLORD").allowed).toBe(false);
  });

  it("admins add agent / provider roles to customers within the rank rules", () => {
    const admin = actor("ADMIN");
    const landlord = { id: "l1", role: "LANDLORD" as const, roles: ["LANDLORD" as const], isFounder: false };
    expect(canAddRole(admin, landlord, "PROPERTY_AGENT").allowed).toBe(true);
    const support = actor("SUPPORT");
    expect(canAddRole(support, landlord, "TENANT").allowed).toBe(false); // no users.manage
  });

  it("the primary role cannot be removed as an additional role; stacked roles can", () => {
    const owner = actor("LANDLORD", ["LANDLORD", "TENANT"]);
    const self = { id: owner.id, role: "LANDLORD" as const, roles: ["LANDLORD" as const, "TENANT" as const], isFounder: false };
    expect(canRemoveRole(owner, self, "LANDLORD").allowed).toBe(false);
    expect(canRemoveRole(owner, self, "TENANT").allowed).toBe(true);
  });

  it("rank uses the highest role held", () => {
    expect(userRank({ role: "TENANT", roles: ["TENANT", "PROPERTY_AGENT"] })).toBe(15);
    const agentTenant = { id: "x", role: "TENANT" as const, roles: ["TENANT" as const, "PROPERTY_AGENT" as const], isFounder: false };
    const otherAgent = actor("PROPERTY_AGENT");
    expect(canManageUser(otherAgent, agentTenant).allowed).toBe(false);
  });
});

describe("property authorization (ownership / assignment)", () => {
  const landlord = actor("LANDLORD");
  const manager = actor("PROPERTY_MANAGER");
  const tenant = actor("TENANT");
  const admin = actor("ADMIN");
  const superAdmin = actor("SUPER_ADMIN");

  it("landlords only reach their own properties", () => {
    expect(propertyWhere(landlord, "properties.view")).toEqual({ ownerId: landlord.id });
    expect(propertyWhere(landlord, "properties.manage")).toEqual({ ownerId: landlord.id });
  });
  it("property managers only reach assigned properties and cannot create or transfer", () => {
    expect(propertyWhere(manager, "properties.manage")).toEqual({ assignments: { some: { userId: manager.id } } });
    expect(hasPermission(manager.permissions, "properties.create")).toBe(false);
    expect(hasPermission(manager.permissions, "users.manage")).toBe(false);
  });
  it("tenants cannot create or manage properties", () => {
    expect(hasPermission(tenant.permissions, "properties.create")).toBe(false);
    expect(propertyWhere(tenant, "properties.manage")).toBeNull();
    expect(propertyWhere(tenant, "properties.view")).toBeNull();
  });
  it("admins and the super admin see all properties; only staff verify listings", () => {
    expect(propertyWhere(admin, "properties.view")).toEqual({});
    expect(propertyWhere(superAdmin, "properties.manage")).toEqual({});
    expect(hasPermission(admin.permissions, "listings.approve")).toBe(true);
    expect(hasPermission(landlord.permissions, "listings.approve")).toBe(false);
  });
});
