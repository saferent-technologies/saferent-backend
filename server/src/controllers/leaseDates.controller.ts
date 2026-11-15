import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { idParam } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { and, leaseWhere } from "../rbac/access";
import { audit } from "../properties/service";
import { ensureRentSchedule } from "./rent.controller";

/*
 * Move-in ("occupied since") date of a lease. Only Super Admin, or a role given `leases.change_dates`,
 * can change it — always with a reason. Every change is kept (lease_date_changes) and also written to
 * the property history. Rent dues follow the join date, so unpaid dues are re-dated automatically;
 * paid dues are never touched.
 */

const startDateSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
    reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500),
  })
  .strict();

const d = (x: Date) => x.toISOString().slice(0, 10);

/** POST /api/v1/leases/:id/start-date { date, reason } */
export async function changeLeaseStartDate(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = leaseWhere(user, "leases.change_dates");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to change lease dates.");
  const lease = await prisma.lease.findFirst({ where: and(scope!, { id: idParam(req) }), include: { property: { select: { title: true, code: true } } } });
  if (!lease) fail("not-found", REASONS.NOT_FOUND, "Lease not found.");
  const l = lease!;
  if (l.status !== "ACTIVE") fail("failed-precondition", REASONS.INVALID_STATE, "Only an active lease's move-in date can be changed.");
  const input = parseInput(startDateSchema, req.body);
  const next = new Date(`${input.date}T00:00:00.000Z`);
  if (Number.isNaN(next.getTime())) fail("invalid-argument", REASONS.INVALID_INPUT, "That date isn't valid.");
  if (d(next) === d(l.startDate)) fail("invalid-argument", REASONS.INVALID_INPUT, "That's already the move-in date.");
  if (next >= l.endDate) fail("invalid-argument", REASONS.INVALID_INPUT, `The move-in date must be before the lease end (${d(l.endDate)}).`);

  const change = await prisma.$transaction(async (tx) => {
    const updated = await tx.lease.updateMany({ where: { id: l.id, status: "ACTIVE", startDate: l.startDate }, data: { startDate: next } });
    if (!updated.count) fail("failed-precondition", REASONS.INVALID_STATE, "This lease was just changed. Refresh and try again.");
    const row = await tx.leaseDateChange.create({ data: { leaseId: l.id, field: "START_DATE", oldValue: l.startDate, newValue: next, reason: input.reason, changedById: user.id } });
    await audit(tx, req, { propertyId: l.propertyId, entityType: "LEASE", entityId: l.id, action: "lease.start_date_change", oldValue: { startDate: d(l.startDate) }, newValue: { startDate: d(next), reason: input.reason } });
    return row;
  });
  // Rent is due on the join date → unpaid dues move to the new date (paid ones stay as they are).
  await ensureRentSchedule({ ...l, startDate: next });
  const paidDues = await prisma.rentPayment.count({ where: { leaseId: l.id, status: { in: ["PAID", "PARTIAL"] } } });

  const name = l.property.title ?? l.property.code;
  for (const id of [l.tenantId, l.landlordId]) {
    if (id !== user.id) await notify(id, "Move-in date updated", `The move-in date for "${name}" was changed from ${d(l.startDate)} to ${d(next)}. Reason: ${input.reason}`, `/leases/${l.id}`, undefined, { leaseId: l.id });
  }
  res.locals.message = "Move-in date changed";
  res.json({
    leaseId: l.id,
    startDate: next,
    change: { id: change.id, from: change.oldValue, to: change.newValue, reason: change.reason, changedBy: user.fullName, at: change.createdAt },
    ...(paidDues ? { note: "Already-paid rent months were not changed." } : {}),
  });
}

/** Change history for leases (newest first), with who made each change. */
export async function dateChangesFor(leaseIds: string[]) {
  if (!leaseIds.length) return new Map<string, Array<{ id: string; field: string; from: Date; to: Date; reason: string; changedBy: string; at: Date }>>();
  const rows = await prisma.leaseDateChange.findMany({ where: { leaseId: { in: leaseIds } }, orderBy: { createdAt: "desc" } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.changedById))] } }, select: { id: true, fullName: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  const out = new Map<string, Array<{ id: string; field: string; from: Date; to: Date; reason: string; changedBy: string; at: Date }>>();
  for (const r of rows) {
    const list = out.get(r.leaseId) ?? [];
    list.push({ id: r.id, field: r.field, from: r.oldValue, to: r.newValue, reason: r.reason, changedBy: nameOf.get(r.changedById) ?? "SafeRent", at: r.createdAt });
    out.set(r.leaseId, list);
  }
  return out;
}

/** GET /api/v1/leases/:id/date-changes — anyone who can see the lease. */
export async function listLeaseDateChanges(req: Request, res: Response): Promise<void> {
  const scope = leaseWhere(me(req), "leases.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const lease = await prisma.lease.findFirst({ where: and(scope!, { id: idParam(req) }), select: { id: true } });
  if (!lease) fail("not-found", REASONS.NOT_FOUND, "Lease not found.");
  res.json({ items: (await dateChangesFor([lease!.id])).get(lease!.id) ?? [] });
}
