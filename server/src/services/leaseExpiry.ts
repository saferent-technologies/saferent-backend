import type { Request } from "express";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { freeLeasePlaceTx } from "../properties/occupancy";
import { audit, withProperty } from "../properties/service";

/**
 * Leases whose end date has passed are closed (ENDED) and their flat / bed is freed — runs from
 * jobs.ts. A lease with an agreed move-out still pending closes on that date instead (lease-exit job).
 * Idempotent: each lease is claimed with a conditional update.
 */
export async function endExpiredLeases(): Promise<number> {
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const due = await prisma.lease.findMany({
    where: { status: "ACTIVE", endDate: { lt: todayUtc }, exitRequests: { none: { status: "ACCEPTED" } } },
    select: { id: true, propertyId: true, unitId: true, bedId: true, tenantId: true, landlordId: true, property: { select: { title: true, code: true } } },
    take: 100,
  });
  let n = 0;
  const system = { user: undefined, ip: null, get: () => undefined } as unknown as Request; // recorded as done by the system
  for (const l of due) {
    const closed = await withProperty(l.propertyId, async (tx) => {
      const claimed = await tx.lease.updateMany({ where: { id: l.id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: new Date() } });
      if (!claimed.count) return false;
      await freeLeasePlaceTx(tx, system, l, "Lease ended (end date reached).");
      await audit(tx, system, { propertyId: l.propertyId, entityType: "LEASE", entityId: l.id, action: "lease.end", newValue: { reason: "end date reached" } });
      return true;
    });
    if (!closed) continue;
    n++;
    const name = l.property.title ?? l.property.code;
    for (const id of [l.tenantId, l.landlordId]) await notify(id, "Lease ended", `The lease for "${name}" has ended (end date reached).`, `/leases/${l.id}`, undefined, { leaseId: l.id });
  }
  await healStaleOccupancy(system);
  return n;
}

/**
 * Safety net: a live unit / bed still marked OCCUPIED although no ACTIVE lease holds it (e.g. closed
 * before this fix) is made AVAILABLE. Beds assigned by hand without a lease are left alone.
 */
async function healStaleOccupancy(system: Request): Promise<void> {
  const units = await prisma.propertyUnit.findMany({
    where: { availabilityStatus: "OCCUPIED", property: { revisionOfId: null }, leases: { none: { status: "ACTIVE" } } },
    select: { id: true, propertyId: true },
    take: 100,
  });
  const beds = await prisma.propertyBed.findMany({
    where: { availabilityStatus: "OCCUPIED", sourceId: null, leaseId: { not: null } },
    select: { id: true, propertyId: true, leaseId: true },
    take: 200,
  });
  const activeBedLeases = new Set((await prisma.lease.findMany({ where: { id: { in: beds.map((b) => b.leaseId!) }, status: "ACTIVE" }, select: { id: true } })).map((l) => l.id));
  for (const u of units) {
    await withProperty(u.propertyId, (tx) => freeLeasePlaceTx(tx, system, { id: "", propertyId: u.propertyId, unitId: u.id, bedId: null }, "No active lease on this unit."));
  }
  for (const b of beds.filter((x) => !activeBedLeases.has(x.leaseId!))) {
    await withProperty(b.propertyId, (tx) => freeLeasePlaceTx(tx, system, { id: "", propertyId: b.propertyId, unitId: null, bedId: b.id }, "No active lease on this bed."));
  }
}
