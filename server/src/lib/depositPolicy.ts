import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * May the tenant pay rent from the security deposit? The flat's own pricing setting wins, else the
 * building / property setting, else no. PG beds use the building setting. Copied onto the lease.
 */
export async function depositUsableFor(db: Prisma.TransactionClient | typeof prisma, propertyId: string, unitId: string | null): Promise<boolean> {
  const rows = await db.propertyPricing.findMany({ where: { propertyId, scopeKey: { in: unitId ? [unitId, "PROPERTY"] : ["PROPERTY"] } }, select: { scopeKey: true, depositUsableAsRent: true } });
  const unit = unitId ? rows.find((r) => r.scopeKey === unitId)?.depositUsableAsRent : null;
  const building = rows.find((r) => r.scopeKey === "PROPERTY")?.depositUsableAsRent;
  return unit ?? building ?? false;
}

/**
 * Monthly maintenance for a flat / property from its pricing: a MAINTENANCE charge billed FIXED_MONTHLY
 * (monthly frequency) — the flat's own charge first, else the building's. 0 when there is none.
 */
export async function monthlyMaintenanceFor(db: Prisma.TransactionClient | typeof prisma, propertyId: string, unitId: string | null): Promise<number> {
  const pricing = await db.propertyPricing.findMany({
    where: { propertyId, scopeKey: { in: unitId ? [unitId, "PROPERTY"] : ["PROPERTY"] } },
    select: { scopeKey: true, charges: { where: { kind: "MAINTENANCE", billing: "FIXED_MONTHLY" }, select: { amount: true, frequency: true } } },
  });
  const pick = (scope: string) => pricing.find((p) => p.scopeKey === scope)?.charges.find((c) => c.amount !== null && (!c.frequency || c.frequency === "MONTHLY"));
  const charge = (unitId ? pick(unitId) : undefined) ?? pick("PROPERTY");
  return charge ? Number(charge.amount) : 0;
}
