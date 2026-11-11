import type { LeaseExitRequest, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { found, idParam } from "../lib/http";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { and, leaseWhere } from "../rbac/access";
import { releaseBedTx } from "../properties/controllers/room.controller";
import { audit, recordStatus, withProperty } from "../properties/service";
import { evaluateForUser } from "../services/referral.service";
import { createReview, prepareReview } from "./reviews.controller";

/*
 * Mutual lease close.
 *   Tenant wants to leave  → asks the landlord;  landlord accepts / declines.
 *   Landlord wants to close → asks the tenant;   tenant accepts / declines.
 * The lease closes only when the other side accepts — on the agreed move-out date (today or later).
 * Each side may attach an optional review; it's submitted automatically once the lease has closed.
 */

type Side = "TENANT" | "LANDLORD";
const OPEN = ["PENDING", "ACCEPTED"] as const;

const leaseInclude = { property: { select: { id: true, code: true, title: true } } } satisfies Prisma.LeaseInclude;

/** Which side the user acts for. Landlord side = the owner, or staff/manager who manage this lease. */
async function sideOf(req: Request, lease: { id: string; tenantId: string; landlordId: string }): Promise<Side | null> {
  const user = me(req);
  if (user.id === lease.tenantId) return "TENANT";
  if (user.id === lease.landlordId) return "LANDLORD";
  const scope = leaseWhere(user, "leases.manage");
  if (scope && (await prisma.lease.count({ where: and(scope, { id: lease.id }) }))) return "LANDLORD";
  return null;
}

async function loadLease(req: Request) {
  const scope = leaseWhere(me(req), "leases.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  return found(await prisma.lease.findFirst({ where: and(scope, { id: idParam(req) }), include: leaseInclude }), "Lease");
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function present(x: LeaseExitRequest, viewerSide: Side | null, names: Map<string, string>) {
  const mine = viewerSide === x.requestedByRole;
  return {
    id: x.id,
    leaseId: x.leaseId,
    requestedByRole: x.requestedByRole,
    requestedBy: names.get(x.requestedById) ?? null,
    reason: x.reason,
    moveOutDate: x.moveOutDate,
    status: x.status,
    respondedBy: x.respondedById ? (names.get(x.respondedById) ?? null) : null,
    respondedAt: x.respondedAt,
    responseNote: x.responseNote,
    completedAt: x.completedAt,
    createdAt: x.createdAt,
    // Only whether a review is attached — its content stays sealed (double-blind).
    hasMyReview: mine ? !!x.requesterReview : x.status !== "PENDING" && viewerSide !== null && !!x.responderReview,
    canRespond: x.status === "PENDING" && viewerSide !== null && !mine,
    canCancel: x.status === "PENDING" && mine,
  };
}

async function namesOf(rows: LeaseExitRequest[]) {
  const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.respondedById ?? ""]).filter(Boolean))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/**
 * Closes every lease whose agreed move-out date has come. Runs on a timer (jobs.ts) and before lease
 * reads, so it doesn't depend on anyone opening the app on the day.
 */
export async function finalizeDueExits(): Promise<number> {
  const due = await prisma.leaseExitRequest.findMany({ where: { status: "ACCEPTED", moveOutDate: { lte: new Date() } }, take: 100 });
  let n = 0;
  for (const x of due) if (await closeByAgreement(x.id)) n++;
  return n;
}

async function closeByAgreement(exitId: string): Promise<boolean> {
  const x = await prisma.leaseExitRequest.findUnique({ where: { id: exitId }, include: { lease: { include: leaseInclude } } });
  if (!x || x.status !== "ACCEPTED" || x.lease.status !== "ACTIVE") return false;
  const lease = x.lease;
  // Audit entries are attributed to the person who accepted the close.
  const actor = { user: { id: x.respondedById ?? x.requestedById, roles: [] }, ip: null, get: () => undefined } as unknown as Request;
  const reason = `Closed by mutual agreement (${x.requestedByRole === "TENANT" ? "tenant" : "landlord"} request): ${x.reason}`.slice(0, 500);
  const status = x.moveOutDate >= lease.endDate ? "ENDED" : "TERMINATED";
  const closed = await withProperty(lease.propertyId, async (tx) => {
    const claimed = await tx.leaseExitRequest.updateMany({ where: { id: x.id, status: "ACCEPTED" }, data: { status: "COMPLETED", completedAt: new Date(), openLeaseId: null } });
    if (!claimed.count) return false;
    const l = await tx.lease.updateMany({ where: { id: lease.id, status: "ACTIVE" }, data: { status, endedAt: new Date() } });
    if (!l.count) return false;
    // The flat waits for the landlord's move-out check before it's listed again.
    if (lease.unitId) {
      await tx.propertyUnit.update({ where: { id: lease.unitId }, data: { availabilityStatus: "NOT_AVAILABLE", version: { increment: 1 } } });
      await recordStatus(tx, actor, { propertyId: lease.propertyId, entityType: "UNIT", entityId: lease.unitId, field: "availabilityStatus", from: "OCCUPIED", to: "NOT_AVAILABLE", reason: "Lease closed by mutual agreement." });
    }
    if (lease.bedId) await releaseBedTx(actor, tx, lease.propertyId, lease.bedId, "Lease closed by mutual agreement.");
    await audit(tx, actor, { propertyId: lease.propertyId, entityType: "LEASE", entityId: lease.id, action: "lease.close_mutual", newValue: { status, exitRequestId: x.id, moveOutDate: x.moveOutDate, reason: x.reason } });
    return true;
  });
  if (!closed) return false;

  await evaluateForUser(lease.tenantId);
  const name = lease.property.title ?? lease.property.code;
  for (const id of [lease.tenantId, lease.landlordId]) await notify(id, "Lease closed", `The lease for "${name}" is closed as agreed. ${reason}`, "/leases");

  // Reviews written during the request / acceptance are submitted now (optional, never required).
  const submitted = new Set<string>();
  for (const [userId, draft] of [
    [x.requestedById, x.requesterReview],
    [x.respondedById, x.responderReview],
  ] as Array<[string | null, Prisma.JsonValue | null]>) {
    if (!userId || !draft) continue;
    try {
      await createReview(lease.id, userId, draft, { ...actor, user: { id: userId, roles: [] } } as unknown as Request);
      submitted.add(userId);
    } catch (err) {
      console.error("[lease-exit] review submit failed", err);
    }
  }
  for (const id of [lease.tenantId, lease.landlordId].filter((i) => !submitted.has(i))) {
    await notify(id, "How was your rental experience?", `You can now review your rental at "${name}". It's optional; both reviews are revealed together.`, "/reviews");
  }
  return true;
}

/** GET /api/v1/leases/:id/exit — open close request (if any), history and what I can do. */
export async function getExit(req: Request, res: Response): Promise<void> {
  await finalizeDueExits();
  const lease = await loadLease(req);
  const side = await sideOf(req, lease);
  const rows = await prisma.leaseExitRequest.findMany({ where: { leaseId: lease.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const names = await namesOf(rows);
  const open = rows.find((r) => (OPEN as readonly string[]).includes(r.status)) ?? null;
  res.json({
    leaseStatus: lease.status,
    side,
    noticePeriodDays: lease.noticePeriodDays,
    endDate: lease.endDate,
    open: open ? present(open, side, names) : null,
    history: rows.filter((r) => r.id !== open?.id).map((r) => present(r, side, names)),
    canRequest: lease.status === "ACTIVE" && side !== null && !open,
  });
}

const reviewDraft = z.unknown().optional();
const requestSchema = z
  .object({
    reason: z.string().trim().min(10, "Tell the other side why (at least 10 characters).").max(2000),
    moveOutDate: z.coerce.date(),
    review: reviewDraft,
  })
  .strict();

/** POST /api/v1/leases/:id/exit — ask the other side to close the lease. */
export async function requestExit(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await finalizeDueExits();
  const lease = await loadLease(req);
  if (lease.status !== "ACTIVE") fail("failed-precondition", REASONS.INVALID_STATE, "Only active leases can be closed.");
  const side = await sideOf(req, lease);
  if (!side) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the tenant or the landlord can ask to close this lease.");
  const input = parseInput(requestSchema, req.body);
  if (input.moveOutDate < startOfToday()) fail("invalid-argument", REASONS.INVALID_INPUT, "Move-out date can't be in the past.");
  // A review written now is checked now, but kept sealed until the lease has closed.
  const review = input.review ? (await prepareReview(side, lease, input.review)).raw : null;
  const open = await prisma.leaseExitRequest.findFirst({ where: { leaseId: lease.id, status: { in: [...OPEN] } } });
  if (open) fail("already-exists", REASONS.CONFLICT, open.requestedByRole === side ? "You've already asked to close this lease." : "The other side has already asked to close this lease — accept or decline their request.");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.leaseExitRequest.create({
        data: { leaseId: lease.id, openLeaseId: lease.id, requestedById: user.id, requestedByRole: side, reason: input.reason, moveOutDate: input.moveOutDate, requesterReview: (review ?? undefined) as Prisma.InputJsonValue | undefined },
      });
      await audit(tx, req, { propertyId: lease.propertyId, entityType: "LEASE", entityId: lease.id, action: "lease.exit_request", newValue: { by: side, moveOutDate: input.moveOutDate, reason: input.reason } });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") fail("already-exists", REASONS.CONFLICT, "There's already an open close request for this lease.");
    throw err;
  }
  const place = placeOf(await placeLabels([lease]), lease);
  const name = `${place ? `${place}, ` : ""}${lease.property.title ?? lease.property.code}`;
  await notify(side === "TENANT" ? lease.landlordId : lease.tenantId, side === "TENANT" ? "Tenant wants to move out" : "Landlord wants to close the lease", `${user.fullName} asked to close the lease for ${name} on ${input.moveOutDate.toDateString()}. Reason: ${input.reason}`, "/leases");
  res.locals.message = "Request sent. The lease closes only after the other side accepts.";
  res.status(201).json({ ok: true });
}

async function openRequest(req: Request) {
  const lease = await loadLease(req);
  const side = await sideOf(req, lease);
  if (!side) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the tenant or the landlord can do this.");
  const x = await prisma.leaseExitRequest.findFirst({ where: { leaseId: lease.id, status: "PENDING" } });
  if (!x) fail("not-found", REASONS.NOT_FOUND, "There's no pending close request for this lease.");
  return { lease, side, x };
}

const acceptSchema = z.object({ note: z.string().trim().max(1000).optional(), review: reviewDraft }).strict();

/** POST /api/v1/leases/:id/exit/accept — the other side agrees; the lease closes on the move-out date. */
export async function acceptExit(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const { lease, side, x } = await openRequest(req);
  if (side === x.requestedByRole) fail("permission-denied", REASONS.PERMISSION_DENIED, "The other side has to accept your request.");
  const input = parseInput(acceptSchema, req.body ?? {});
  const review = input.review ? (await prepareReview(side, lease, input.review)).raw : null;
  const done = await prisma.leaseExitRequest.updateMany({
    where: { id: x.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedById: user.id, respondedAt: new Date(), responseNote: input.note ?? null, responderReview: (review ?? undefined) as Prisma.InputJsonValue | undefined },
  });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just changed. Refresh and try again.");
  await logActivity(req, "lease.exit_accept", "lease", lease.id, { exitRequestId: x.id, moveOutDate: x.moveOutDate });
  await notify(x.requestedById, "Close request accepted", `Your request to close the lease for "${lease.property.title ?? lease.property.code}" was accepted. It closes on ${x.moveOutDate.toDateString()}.`, "/leases");
  const closedNow = x.moveOutDate <= new Date() ? await closeByAgreement(x.id) : false;
  res.locals.message = closedNow ? "Accepted — the lease is now closed." : `Accepted — the lease closes on ${x.moveOutDate.toDateString()}.`;
  res.json({ ok: true, closed: closedNow });
}

const declineSchema = z.object({ note: z.string().trim().min(5, "Tell them why (at least 5 characters).").max(1000) }).strict();

/** POST /api/v1/leases/:id/exit/decline — the other side doesn't agree (the lease stays active). */
export async function declineExit(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const { lease, side, x } = await openRequest(req);
  if (side === x.requestedByRole) fail("permission-denied", REASONS.PERMISSION_DENIED, "Use Cancel to withdraw your own request.");
  const { note } = parseInput(declineSchema, req.body);
  const done = await prisma.leaseExitRequest.updateMany({ where: { id: x.id, status: "PENDING" }, data: { status: "DECLINED", openLeaseId: null, respondedById: user.id, respondedAt: new Date(), responseNote: note } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just changed. Refresh and try again.");
  await logActivity(req, "lease.exit_decline", "lease", lease.id, { exitRequestId: x.id, note });
  await notify(x.requestedById, "Close request declined", `Your request to close the lease for "${lease.property.title ?? lease.property.code}" was declined: ${note}`, "/leases");
  res.locals.message = "Declined. The lease stays active.";
  res.json({ ok: true });
}

/** POST /api/v1/leases/:id/exit/cancel — the requester withdraws a pending request. */
export async function cancelExit(req: Request, res: Response): Promise<void> {
  const { lease, side, x } = await openRequest(req);
  if (side !== x.requestedByRole) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the side that asked can cancel.");
  const done = await prisma.leaseExitRequest.updateMany({ where: { id: x.id, status: "PENDING" }, data: { status: "CANCELLED", openLeaseId: null } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just answered. Refresh and check.");
  await notify(side === "TENANT" ? lease.landlordId : lease.tenantId, "Close request withdrawn", `The request to close the lease for "${lease.property.title ?? lease.property.code}" was withdrawn.`, "/leases");
  res.locals.message = "Request cancelled";
  res.json({ ok: true });
}
