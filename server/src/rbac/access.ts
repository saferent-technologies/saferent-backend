/**
 * Resource-level authorization: turns (user, permission) into a Prisma `where` filter.
 * Every list/detail query in the API goes through one of these, so a user can only ever read
 * rows inside their scope. `null` means "no access at all" (→ 403).
 *
 * Pure functions — unit tested in test/access.test.ts.
 */
import type { Prisma } from "@prisma/client";
import type { PermissionKey, Scope } from "./catalog";
import { scopesFor, type EffectivePermissions } from "./policy";

export interface AccessUser {
  id: string;
  permissions: EffectivePermissions;
}

type Builders<W> = Partial<Record<Exclude<Scope, "ALL">, (userId: string) => W>>;

function build<W extends object>(user: AccessUser, permission: PermissionKey, builders: Builders<W>): W | null {
  const scopes = scopesFor(user.permissions, permission);
  if (scopes.length === 0) return null;
  if (scopes.includes("ALL")) return {} as W;
  const clauses = scopes.map((s) => builders[s as Exclude<Scope, "ALL">]?.(user.id)).filter((c): c is W => !!c);
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0] : ({ OR: clauses } as W);
}

const assignedProperty = (userId: string) => ({ assignments: { some: { userId } } });

export function propertyWhere(user: AccessUser, permission: PermissionKey = "properties.view"): Prisma.PropertyWhereInput | null {
  return build<Prisma.PropertyWhereInput>(user, permission, {
    OWN: (id) => ({ ownerId: id }),
    ASSIGNED: (id) => assignedProperty(id),
  });
}

export function applicationWhere(user: AccessUser, permission: PermissionKey = "applications.view"): Prisma.RentalApplicationWhereInput | null {
  return build<Prisma.RentalApplicationWhereInput>(user, permission, {
    OWN: (id) => ({ OR: [{ tenantId: id }, { property: { ownerId: id } }] }),
    ASSIGNED: (id) => ({ property: assignedProperty(id) }),
  });
}

export function leaseWhere(user: AccessUser, permission: PermissionKey = "leases.view"): Prisma.LeaseWhereInput | null {
  return build<Prisma.LeaseWhereInput>(user, permission, {
    OWN: (id) => ({ OR: [{ tenantId: id }, { landlordId: id }] }),
    ASSIGNED: (id) => ({ property: assignedProperty(id) }),
  });
}

/** Financial records: tenants see their own, landlords see their properties', finance sees all. */
export function rentWhere(user: AccessUser, permission: PermissionKey = "rent.view"): Prisma.RentPaymentWhereInput | null {
  return build<Prisma.RentPaymentWhereInput>(user, permission, {
    OWN: (id) => ({ OR: [{ tenantId: id }, { landlordId: id }] }),
    ASSIGNED: (id) => ({ lease: { property: assignedProperty(id) } }),
  });
}

export function maintenanceWhere(user: AccessUser, permission: PermissionKey = "maintenance.view"): Prisma.MaintenanceRequestWhereInput | null {
  return build<Prisma.MaintenanceRequestWhereInput>(user, permission, {
    OWN: (id) => ({ OR: [{ raisedById: id }, { landlordId: id }] }),
    ASSIGNED: (id) => ({ OR: [{ assignedProviderId: id }, { property: assignedProperty(id) }] }),
  });
}

export function enquiryWhere(user: AccessUser, permission: PermissionKey = "enquiries.manage"): Prisma.EnquiryWhereInput | null {
  return build<Prisma.EnquiryWhereInput>(user, permission, {
    OWN: (id) => ({ OR: [{ tenantId: id }, { property: { ownerId: id } }] }),
    ASSIGNED: (id) => ({ property: assignedProperty(id) }),
  });
}

export function visitWhere(user: AccessUser, permission: PermissionKey = "visits.manage"): Prisma.PropertyVisitWhereInput | null {
  return build<Prisma.PropertyVisitWhereInput>(user, permission, {
    OWN: (id) => ({ OR: [{ tenantId: id }, { property: { ownerId: id } }] }),
    ASSIGNED: (id) => ({ OR: [{ agentId: id }, { property: assignedProperty(id) }] }),
  });
}

/** Support staff (support.manage) see every ticket; everyone else only tickets they raised. */
export function ticketWhere(user: AccessUser): Prisma.SupportTicketWhereInput {
  return scopesFor(user.permissions, "support.manage").length > 0 ? {} : { raisedById: user.id };
}

/** Combine a scope filter with extra conditions. */
export function and<W extends object>(scope: W, ...extra: Array<W | undefined | false>): W {
  const parts = [scope, ...extra.filter(Boolean)] as W[];
  return (parts.length === 1 ? parts[0] : { AND: parts }) as W;
}
