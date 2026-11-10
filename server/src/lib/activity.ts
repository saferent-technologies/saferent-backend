import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "./prisma";

/**
 * admin_activity_logs — who changed what. Used for user/role/permission changes, moderation,
 * and EVERY financial action (refunds, adjustments, payments recorded, commission changes).
 */
export async function logActivity(
  req: Request,
  action: string,
  targetType: string,
  targetId: string | null,
  changes?: Record<string, unknown>,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  await tx.adminActivityLog.create({
    data: {
      actorId: req.user!.id,
      action,
      targetType,
      targetId,
      changes: (changes ?? {}) as Prisma.InputJsonValue,
      ip: req.ip ?? null,
    },
  });
}
