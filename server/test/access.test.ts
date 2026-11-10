import { describe, expect, it } from "vitest";
import { applicationWhere, leaseWhere, maintenanceWhere, propertyWhere, rentWhere, ticketWhere } from "../src/rbac/access";
import { DEFAULT_ROLE_PERMISSIONS, type RoleKey, type Scope } from "../src/rbac/catalog";
import { resolveEffectivePermissions } from "../src/rbac/policy";

function user(role: RoleKey, id = "u1") {
  const rp = Object.entries(DEFAULT_ROLE_PERMISSIONS[role]).map(([permissionKey, scope]) => ({ permissionKey, scope: scope as Scope }));
  return { id, permissions: resolveEffectivePermissions(role, rp) };
}

describe("ownership restrictions", () => {
  it("landlord sees only own properties", () => {
    expect(propertyWhere(user("LANDLORD"))).toEqual({ ownerId: "u1" });
    expect(propertyWhere(user("LANDLORD"), "properties.manage")).toEqual({ ownerId: "u1" });
  });

  it("property manager and agent see only assigned properties", () => {
    expect(propertyWhere(user("PROPERTY_MANAGER"))).toEqual({ assignments: { some: { userId: "u1" } } });
    expect(propertyWhere(user("PROPERTY_AGENT"))).toEqual({ assignments: { some: { userId: "u1" } } });
  });

  it("staff with ALL scope see everything", () => {
    expect(propertyWhere(user("ADMIN"))).toEqual({});
    expect(propertyWhere(user("MODERATOR"))).toEqual({});
  });

  it("tenant cannot list property records (only public browse)", () => {
    expect(propertyWhere(user("TENANT"))).toBeNull();
    expect(propertyWhere(user("SERVICE_PROVIDER"))).toBeNull();
  });

  it("tenant sees only own applications and leases", () => {
    expect(applicationWhere(user("TENANT"))).toEqual({ OR: [{ tenantId: "u1" }, { property: { ownerId: "u1" } }] });
    expect(leaseWhere(user("TENANT"))).toEqual({ OR: [{ tenantId: "u1" }, { landlordId: "u1" }] });
  });

  it("tenants cannot approve applications", () => {
    expect(applicationWhere(user("TENANT"), "applications.manage")).toBeNull();
  });

  it("service provider sees only assigned maintenance jobs", () => {
    expect(maintenanceWhere(user("SERVICE_PROVIDER"))).toEqual({
      OR: [{ assignedProviderId: "u1" }, { property: { assignments: { some: { userId: "u1" } } } }],
    });
    expect(leaseWhere(user("SERVICE_PROVIDER"))).toBeNull();
  });

  it("support sees all tickets; others only their own", () => {
    expect(ticketWhere(user("SUPPORT"))).toEqual({});
    expect(ticketWhere(user("TENANT"))).toEqual({ raisedById: "u1" });
  });
});

describe("financial data access", () => {
  it("tenant and landlord see only their own rent records", () => {
    expect(rentWhere(user("TENANT"))).toEqual({ OR: [{ tenantId: "u1" }, { landlordId: "u1" }] });
    expect(rentWhere(user("LANDLORD", "l1"))).toEqual({ OR: [{ tenantId: "l1" }, { landlordId: "l1" }] });
  });

  it("finance admin sees all rent records", () => {
    expect(rentWhere(user("FINANCE_ADMIN"))).toEqual({});
  });

  it("support, moderator, viewer, agent, provider and admin get no rent access", () => {
    for (const role of ["SUPPORT", "MODERATOR", "VIEWER", "PROPERTY_AGENT", "SERVICE_PROVIDER", "ADMIN", "PROPERTY_MANAGER"] as RoleKey[]) {
      expect(rentWhere(user(role)), role).toBeNull();
    }
  });

  it("only finance can record collections", () => {
    expect(rentWhere(user("FINANCE_ADMIN"), "rent.collect")).toEqual({});
    expect(rentWhere(user("LANDLORD"), "rent.collect")).toBeNull();
  });
});
