import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import { maskEmail } from "./mask";
import { prisma } from "./prisma";

export interface AuditEntry {
  action: string;
  outcome: "success" | "failure";
  userId?: string | null;
  firebaseUid?: string | null;
  email?: string | null;
  reason?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export function requestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
  };
}

/** Append-only security log. Failures are logged but never break the user-facing flow. */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        outcome: entry.outcome === "success" ? "SUCCESS" : "FAILURE",
        userId: entry.userId ?? null,
        firebaseUid: entry.firebaseUid ?? null,
        email: entry.email ? maskEmail(entry.email) : null,
        reason: entry.reason ?? null,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[audit] Failed to write audit log", entry.action, error);
  }
}
