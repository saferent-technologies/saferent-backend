import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Working copy (change request) property id → live property id. Audit entries, status history and
 * scope checks always use the live id, so nothing is lost when a working copy is deleted.
 */
const liveIds = new Map<string, string>();
const plainIds = new Set<string>();

export function rememberDraft(draftId: string, liveId: string): void {
  liveIds.set(draftId, liveId);
}

export async function liveIdOf(db: Prisma.TransactionClient | typeof prisma, propertyId: string): Promise<string> {
  const known = liveIds.get(propertyId);
  if (known) return known;
  if (plainIds.has(propertyId)) return propertyId;
  const row = await db.property.findUnique({ where: { id: propertyId }, select: { revisionOfId: true } });
  if (row?.revisionOfId) {
    liveIds.set(propertyId, row.revisionOfId);
    return row.revisionOfId;
  }
  if (plainIds.size > 20_000) plainIds.clear();
  plainIds.add(propertyId);
  return propertyId;
}
