import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { toAuditEntry } from "./serializers";

const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(8) });

/** GET /api/me/activity — the signed-in user's own recent security events. */
export async function recentActivity(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const { limit } = parseInput(activityQuery, req.query);
  const logs = await prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: limit });
  res.json({ items: logs.map(toAuditEntry) });
}
