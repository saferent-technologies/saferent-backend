import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { found, idParam } from "../lib/http";
import { notify } from "../lib/notify";
import { canAskAgain, maskPan, normalizePan, PAN_REASK_DAYS, panSharedFor } from "../lib/pan";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { hasRole, me } from "../middleware/auth";
import { and, leaseWhere } from "../rbac/access";

/*
 * Landlord PAN sharing (for the tenant's HRA claim).
 *  - The owner saves their PAN in Profile. It's never shown whole to anyone by default.
 *  - A tenant taps "Request PAN" on their lease → the owner approves / denies.
 *  - Or the owner opts in once to share with all their tenants.
 *  - Only the owner can consent — staff / managers can't share it on their behalf.
 *  - Shared PAN appears on that lease's rent receipts. The owner can revoke any time.
 */

const panProfile = (userId: string) => prisma.landlordProfile.findUnique({ where: { userId }, select: { pan: true, panShareAll: true, panShareAllAt: true } });

function presentRequest(r: { status: string; note: string | null; requestedAt: Date; decidedAt: Date | null } | null) {
  return r ? { status: r.status, note: r.note, requestedAt: r.requestedAt, decidedAt: r.decidedAt } : null;
}

/** GET /api/profile/pan — owner's PAN settings (masked) + tenant requests. */
export async function getMyPan(req: Request, res: Response): Promise<void> {
  const user = me(req);
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only property owners have PAN settings.");
  const profile = await panProfile(user.id);
  const rows = await prisma.panShareRequest.findMany({
    where: { landlordId: user.id, status: { in: ["PENDING", "APPROVED"] } },
    orderBy: { requestedAt: "desc" },
    take: 100,
    include: { lease: { select: { id: true, code: true, unitId: true, bedId: true, status: true, property: { select: { title: true, code: true } } } } },
  });
  const tenants = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, fullName: true } });
  const names = new Map(tenants.map((t) => [t.id, t.fullName]));
  const places = await placeLabels(rows.map((r) => r.lease));
  res.json({
    hasPan: !!profile?.pan,
    masked: profile?.pan ? maskPan(profile.pan) : null,
    shareAll: profile?.panShareAll ?? false,
    shareAllAt: profile?.panShareAllAt ?? null,
    requests: rows.map((r) => ({
      leaseId: r.leaseId,
      leaseCode: r.lease.code,
      leaseStatus: r.lease.status,
      place: [placeOf(places, r.lease), r.lease.property.title ?? r.lease.property.code].filter(Boolean).join(" · "),
      tenant: names.get(r.tenantId) ?? null,
      ...presentRequest(r),
    })),
  });
}

const updateSchema = z.object({
  /** New PAN; "" or null removes it. Omit to keep the current one. */
  pan: z.string().trim().max(20).nullable().optional(),
  shareAll: z.boolean().optional(),
});

/** PUT /api/profile/pan — save / remove PAN and the "share with all my tenants" choice. */
export async function updateMyPan(req: Request, res: Response): Promise<void> {
  const user = me(req);
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only property owners have PAN settings.");
  const input = parseInput(updateSchema, req.body);
  const data: { pan?: string | null; panShareAll?: boolean; panShareAllAt?: Date | null } = {};
  if (input.pan !== undefined) {
    if (!input.pan) data.pan = null;
    else {
      const pan = normalizePan(input.pan);
      if (!pan) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a valid PAN, like ABCDE1234F.");
      data.pan = pan;
    }
  }
  if (input.shareAll !== undefined) {
    data.panShareAll = input.shareAll;
    data.panShareAllAt = input.shareAll ? new Date() : null;
  }
  // Removing the PAN also withdraws every consent that depended on it.
  if (data.pan === null) {
    data.panShareAll = false;
    data.panShareAllAt = null;
  }
  const before = await panProfile(user.id);
  await prisma.$transaction(async (tx) => {
    await tx.landlordProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    if (data.pan === null) await tx.panShareRequest.updateMany({ where: { landlordId: user.id, status: "APPROVED" }, data: { status: "REVOKED", decidedAt: new Date(), decidedById: user.id } });
    // Consent record — the PAN itself is never written to logs.
    await logActivity(req, "pan.settings", "user", user.id, {
      panChanged: data.pan !== undefined && data.pan !== before?.pan,
      panRemoved: data.pan === null,
      shareAll: data.panShareAll ?? before?.panShareAll ?? false,
    }, tx);
  });
  // Approve-after-save: tenants waiting on a PAN the owner just added still need an explicit approval.
  res.json({ ok: true });
}

async function loadLease(req: Request) {
  const scope = leaseWhere(me(req), "leases.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  return found(
    await prisma.lease.findFirst({ where: and(scope, { id: idParam(req) }), select: { id: true, code: true, tenantId: true, landlordId: true, status: true, unitId: true, bedId: true, property: { select: { title: true, code: true } } } }),
    "Lease",
  );
}

const leaseName = (l: { property: { title: string | null; code: string } }) => l.property.title ?? l.property.code;

/** GET /api/leases/:id/pan — what this viewer may see about the owner's PAN on this lease. */
export async function leasePan(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = await loadLease(req);
  const side = user.id === lease.tenantId ? "TENANT" : user.id === lease.landlordId ? "LANDLORD" : null;
  const [profile, request] = await Promise.all([panProfile(lease.landlordId), prisma.panShareRequest.findUnique({ where: { leaseId: lease.id } })]);
  const shared = panSharedFor(profile, request);
  res.json({
    side,
    hasPan: !!profile?.pan,
    shared,
    sharedVia: shared ? (profile?.panShareAll ? "ALL_TENANTS" : "THIS_LEASE") : null,
    // Full PAN only to the two parties, and only with consent. Staff see the state, not the number.
    pan: shared && side ? profile!.pan : null,
    masked: profile?.pan ? maskPan(profile.pan) : null,
    request: presentRequest(request),
    canRequest: side === "TENANT" && !shared && canAskAgain(request),
    canDecide: side === "LANDLORD",
    reaskDays: PAN_REASK_DAYS,
  });
}

const requestSchema = z.object({ note: z.string().trim().max(300).optional() });

/** POST /api/leases/:id/pan/request — tenant asks the owner to share their PAN. */
export async function requestPan(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = await loadLease(req);
  if (user.id !== lease.tenantId) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the tenant on this lease can ask for the owner's PAN.");
  const input = parseInput(requestSchema, req.body ?? {});
  const [profile, existing] = await Promise.all([panProfile(lease.landlordId), prisma.panShareRequest.findUnique({ where: { leaseId: lease.id } })]);
  if (panSharedFor(profile, existing)) fail("failed-precondition", REASONS.INVALID_STATE, "The owner has already shared their PAN with you.");
  if (!canAskAgain(existing)) {
    fail("failed-precondition", REASONS.INVALID_STATE, existing?.status === "PENDING" ? "Your request is already with the owner." : `The owner said no. You can ask again ${PAN_REASK_DAYS} days after that.`);
  }
  const data = { status: "PENDING" as const, note: input.note || null, requestedAt: new Date(), decidedAt: null, decidedById: null };
  await prisma.panShareRequest.upsert({ where: { leaseId: lease.id }, create: { leaseId: lease.id, tenantId: lease.tenantId, landlordId: lease.landlordId, ...data }, update: data });
  await logActivity(req, "pan.request", "lease", lease.id);
  await notify(lease.landlordId, "PAN requested", `${user.fullName} asked you to share your PAN for their HRA claim ("${leaseName(lease)}"). You decide — it's only shared if you approve.`, "/profile");
  res.json({ ok: true });
}

const decideSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(300).optional() });

/** POST /api/leases/:id/pan/decide — owner approves (or shares without a request) / denies. */
export async function decidePan(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = await loadLease(req);
  if (user.id !== lease.landlordId) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the property owner can decide on sharing their PAN.");
  const input = parseInput(decideSchema, req.body);
  const [profile, existing] = await Promise.all([panProfile(user.id), prisma.panShareRequest.findUnique({ where: { leaseId: lease.id } })]);
  if (input.approve) {
    if (!profile?.pan) fail("failed-precondition", REASONS.INVALID_STATE, "Add your PAN in Profile → PAN & tax first.");
    if (existing?.status === "APPROVED") fail("failed-precondition", REASONS.INVALID_STATE, "Already shared with this tenant.");
  } else if (existing?.status !== "PENDING") {
    fail("failed-precondition", REASONS.INVALID_STATE, "There's no pending request to decline.");
  }
  const data = { status: input.approve ? ("APPROVED" as const) : ("DENIED" as const), decidedAt: new Date(), decidedById: user.id, note: input.note || existing?.note || null };
  await prisma.panShareRequest.upsert({ where: { leaseId: lease.id }, create: { leaseId: lease.id, tenantId: lease.tenantId, landlordId: lease.landlordId, requestedAt: new Date(), ...data }, update: data });
  await logActivity(req, input.approve ? "pan.approve" : "pan.deny", "lease", lease.id);
  await notify(
    lease.tenantId,
    input.approve ? "PAN shared" : "PAN request declined",
    input.approve ? `The owner shared their PAN for "${leaseName(lease)}". It's on your rent receipts now.` : `The owner declined to share their PAN for "${leaseName(lease)}".${input.note ? ` Note: ${input.note}` : ""}`,
    "/leases",
  );
  res.json({ ok: true });
}

/** POST /api/leases/:id/pan/revoke — owner withdraws consent for this lease. */
export async function revokePan(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = await loadLease(req);
  if (user.id !== lease.landlordId) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the property owner can do that.");
  const r = await prisma.panShareRequest.updateMany({ where: { leaseId: lease.id, status: "APPROVED" }, data: { status: "REVOKED", decidedAt: new Date(), decidedById: user.id } });
  if (!r.count) fail("failed-precondition", REASONS.INVALID_STATE, "Your PAN isn't shared on this lease.");
  await logActivity(req, "pan.revoke", "lease", lease.id);
  await notify(lease.tenantId, "PAN no longer shared", `The owner stopped sharing their PAN for "${leaseName(lease)}". New receipts won't show it.`, "/leases");
  res.json({ ok: true });
}

/** For receipts: the owner's PAN if this lease may show it, else null. */
export async function receiptPan(leaseId: string, landlordId: string): Promise<string | null> {
  const [profile, request] = await Promise.all([panProfile(landlordId), prisma.panShareRequest.findUnique({ where: { leaseId }, select: { status: true } })]);
  return panSharedFor(profile, request) ? profile!.pan : null;
}
