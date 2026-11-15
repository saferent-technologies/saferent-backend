import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { releaseBedTx } from "./controllers/room.controller";
import { recordStatus } from "./service";

/**
 * A lease has just closed (agreed move-out, end date reached, or SafeRent closed it): free its flat /
 * unit or bed in the same transaction — AVAILABLE again (version bumped) unless another ACTIVE lease
 * still holds it. An open change request's copy of that unit / bed follows the live status.
 * Call AFTER the lease row is no longer ACTIVE.
 */
export async function freeLeasePlaceTx(
  tx: Prisma.TransactionClient,
  actor: Request,
  lease: { id: string; propertyId: string; unitId: string | null; bedId: string | null },
  reason: string,
): Promise<void> {
  if (lease.unitId) {
    const stillHeld = await tx.lease.count({ where: { unitId: lease.unitId, status: "ACTIVE", NOT: { id: lease.id } } });
    if (!stillHeld) {
      const unit = await tx.propertyUnit.findUnique({ where: { id: lease.unitId }, select: { availabilityStatus: true } });
      if (unit && unit.availabilityStatus === "OCCUPIED") {
        await tx.propertyUnit.update({ where: { id: lease.unitId }, data: { availabilityStatus: "AVAILABLE", version: { increment: 1 } } });
        await recordStatus(tx, actor, { propertyId: lease.propertyId, entityType: "UNIT", entityId: lease.unitId, field: "availabilityStatus", from: "OCCUPIED", to: "AVAILABLE", reason });
      }
      // Change-request copy (draft) of this unit.
      await tx.propertyUnit.updateMany({ where: { sourceId: lease.unitId, availabilityStatus: "OCCUPIED" }, data: { availabilityStatus: "AVAILABLE", version: { increment: 1 } } });
    }
  }
  if (lease.bedId) {
    const stillHeld = await tx.lease.count({ where: { bedId: lease.bedId, status: "ACTIVE", NOT: { id: lease.id } } });
    if (!stillHeld) {
      await releaseBedTx(actor, tx, lease.propertyId, lease.bedId, reason);
      await tx.propertyBed.updateMany({ where: { sourceId: lease.bedId, availabilityStatus: "OCCUPIED" }, data: { availabilityStatus: "AVAILABLE", tenantId: null, leaseId: null, occupiedSince: null, version: { increment: 1 } } });
    }
  }
}
