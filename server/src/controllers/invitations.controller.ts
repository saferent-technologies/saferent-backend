import type { Prisma, TenantInvitation } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { allowedOrigins } from "../config/env";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { canRespond, hashInviteToken, inviteMessage, isExpired, isWellFormedToken, leaseEndDate, newInviteToken } from "../lib/invitations";
import { maskPhone } from "../lib/mask";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { parseInput, phoneE164Schema } from "../lib/validation";
import { me } from "../middleware/auth";
import { and, propertyWhere } from "../rbac/access";
import { ROLE_INFO } from "../rbac/catalog";
import { ID_PREFIX } from "../properties/catalog";
import { assignBedTx } from "../properties/controllers/room.controller";
import { nextCode } from "../properties/ids";
import { audit, recordStatus, scopedProperty, typeOf, withProperty } from "../properties/service";
import { ensureRentSchedule } from "./rent.controller";
import { defaultTerms } from "./rentals.controller";
import { ensureRoleProfile } from "./users.controller";
import { evaluateForUser, recordInvitationReferral } from "../services/referral.service";

/*
 * Tenant invitation links.
 *   Landlord: POST /properties/:propertyId/invitations → gets a one-time link to share (WhatsApp / SMS).
 *   Tenant:   opens /invite/:token in the app → signs in → GET /invitations/token/:token → accept / reject.
 * Accepting creates the lease and marks the flat / bed OCCUPIED in one transaction.
 */

const INVITATION_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "REVOKED", "EXPIRED"] as const;
const money = z.coerce.number().min(0).max(100_000_000).transform((n) => n.toFixed(2));

const createSchema = z
  .object({
    unitId: z.string().uuid().optional(),
    bedId: z.string().uuid().optional(),
    recipientName: z.string().trim().min(2, "Enter the tenant's name.").max(120),
    recipientPhone: phoneE164Schema,
    recipientEmail: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("").transform(() => undefined)),
    monthlyRent: z.coerce.number().positive("Enter the monthly rent.").max(100_000_000).transform((n) => n.toFixed(2)),
    securityDeposit: money.default("0.00"),
    maintenanceCharges: money.optional(),
    otherCharges: z.array(z.object({ label: z.string().trim().min(2).max(60), amount: money })).max(10).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    rentDueDay: z.coerce.number().int().min(1).max(28),
    noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
    lockInMonths: z.coerce.number().int().min(0).max(60).optional(),
    additionalTerms: z.string().trim().max(5000).optional(),
    expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate > v.startDate, { message: "End date must be after the start date.", path: ["endDate"] });

const linkSchema = z.object({ expiresInDays: z.coerce.number().int().min(1).max(30).default(7) }).strict();

function inviteUrl(token: string): string {
  return `${(allowedOrigins[0] ?? "http://localhost:5173").replace(/\/$/, "")}/invite/${token}`;
}

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/** What the invitation is for: the flat / villa, the bed (room + bed), or the whole property. */
async function targetLabel(inv: Pick<TenantInvitation, "unitId" | "bedId">): Promise<string | null> {
  if (inv.bedId) {
    const bed = await prisma.propertyBed.findUnique({ where: { id: inv.bedId }, select: { bedNumber: true, room: { select: { roomNumber: true } } } });
    return bed ? `Room ${bed.room.roomNumber} · Bed ${bed.bedNumber}` : null;
  }
  if (inv.unitId) {
    const unit = await prisma.propertyUnit.findUnique({ where: { id: inv.unitId }, select: { name: true, unitNumber: true, code: true, kind: true } });
    if (!unit) return null;
    if (unit.name) return unit.name;
    return unit.unitNumber ? `${unit.kind === "VILLA" ? "Villa" : "Flat"} ${unit.unitNumber}` : unit.code;
  }
  return null;
}

/** Treats a PENDING invitation past its expiry as EXPIRED (and stores that). */
async function settleExpiry<T extends TenantInvitation>(inv: T): Promise<T> {
  if (inv.status === "PENDING" && isExpired(inv.expiresAt)) {
    await prisma.tenantInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    return { ...inv, status: "EXPIRED" };
  }
  return inv;
}

function forLandlord(inv: TenantInvitation & { property?: { title: string | null; code: string } }, target: string | null) {
  return {
    id: inv.id,
    code: inv.code,
    propertyId: inv.propertyId,
    propertyName: inv.property ? (inv.property.title ?? inv.property.code) : undefined,
    unitId: inv.unitId,
    bedId: inv.bedId,
    target,
    recipientName: inv.recipientName,
    recipientPhone: inv.recipientPhone,
    recipientEmail: inv.recipientEmail,
    monthlyRent: inv.monthlyRent.toFixed(2),
    securityDeposit: inv.securityDeposit.toFixed(2),
    maintenanceCharges: inv.maintenanceCharges?.toFixed(2) ?? null,
    otherCharges: inv.otherCharges,
    startDate: inv.startDate,
    endDate: inv.endDate,
    rentDueDay: inv.rentDueDay,
    noticePeriodDays: inv.noticePeriodDays,
    lockInMonths: inv.lockInMonths,
    additionalTerms: inv.additionalTerms,
    status: inv.status,
    expiresAt: inv.expiresAt,
    respondedAt: inv.respondedAt,
    leaseId: inv.leaseId,
    createdAt: inv.createdAt,
  };
}

/**
 * Resolves and checks what is being rented. Flats need unitId, PG / hostel needs bedId, a house with a
 * single unit uses that unit. Throws when the flat / bed is already occupied or under an active lease.
 */
async function resolveTarget(property: { id: string; propertyTypeKey: string }, unitId?: string, bedId?: string): Promise<{ unitId: string | null; bedId: string | null }> {
  const type = typeOf(property);
  if (type.structure === "ROOMS_BEDS") {
    if (!bedId) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose the bed you are renting out.");
    const bed = await prisma.propertyBed.findFirst({ where: { id: bedId, room: { propertyId: property.id } } });
    if (!bed) fail("invalid-argument", REASONS.INVALID_INPUT, "Bed not found in this property.");
    if (bed.activeStatus !== "ACTIVE") fail("failed-precondition", REASONS.INVALID_STATE, "This bed is not active.");
    if (bed.tenantId || bed.availabilityStatus === "OCCUPIED") fail("failed-precondition", REASONS.INVALID_STATE, "This bed is already occupied.");
    return { unitId: null, bedId: bed.id };
  }
  if (bedId) fail("invalid-argument", REASONS.INVALID_INPUT, `${type.label} has no beds. Choose a ${(type.unitLabel ?? "unit").toLowerCase()}.`);
  let id = unitId;
  if (!id) {
    const units = await prisma.propertyUnit.findMany({ where: { propertyId: property.id, activeStatus: "ACTIVE" }, select: { id: true }, take: 2 });
    if (units.length === 1) id = units[0]!.id;
    else if (units.length > 1) fail("invalid-argument", REASONS.INVALID_INPUT, `Choose the ${(type.unitLabel ?? "unit").toLowerCase()} you are renting out.`);
  }
  if (id) {
    const unit = await prisma.propertyUnit.findFirst({ where: { id, propertyId: property.id } });
    if (!unit) fail("invalid-argument", REASONS.INVALID_INPUT, "Unit not found in this property.");
    if (unit.activeStatus !== "ACTIVE") fail("failed-precondition", REASONS.INVALID_STATE, "This unit is not active.");
    if (unit.availabilityStatus === "OCCUPIED") fail("failed-precondition", REASONS.INVALID_STATE, "This unit is already occupied.");
    if (await prisma.lease.count({ where: { unitId: id, status: "ACTIVE" } })) fail("failed-precondition", REASONS.INVALID_STATE, "This unit already has an active lease.");
    return { unitId: id, bedId: null };
  }
  // A property without units (e.g. land) is rented as a whole.
  if (await prisma.lease.count({ where: { propertyId: property.id, unitId: null, bedId: null, status: "ACTIVE" } })) {
    fail("failed-precondition", REASONS.INVALID_STATE, "This property already has an active lease.");
  }
  return { unitId: null, bedId: null };
}

/** POST /api/v1/properties/:propertyId/invitations — landlord (own) / manager (assigned) / admin. */
export async function createInvitation(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const property = await scopedProperty(req, "leases.manage");
  await consumeRateLimit(`invite-create:${user.id}`, RATE_LIMITS.INVITE_CREATE.limit, RATE_LIMITS.INVITE_CREATE.windowMs);
  if (property.activeStatus === "ARCHIVED" || property.activeStatus === "SUSPENDED") fail("failed-precondition", REASONS.INVALID_STATE, `This property is ${property.activeStatus.toLowerCase()}.`);
  const input = parseInput(createSchema, req.body);
  const target = await resolveTarget(property, input.unitId, input.bedId);
  const pending = await prisma.tenantInvitation.findFirst({ where: { propertyId: property.id, unitId: target.unitId, bedId: target.bedId, status: "PENDING", expiresAt: { gt: new Date() } } });
  if (pending) fail("already-exists", REASONS.CONFLICT, `There's already a pending invitation (${pending.code}) for this. Revoke it or send its link again.`);

  const token = newInviteToken();
  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.tenantInvitation.create({
      data: {
        code: await nextCode(tx, ID_PREFIX.INVITATION),
        tokenHash: hashInviteToken(token),
        propertyId: property.id,
        unitId: target.unitId,
        bedId: target.bedId,
        landlordId: property.ownerId,
        createdById: user.id,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        recipientEmail: input.recipientEmail ?? null,
        monthlyRent: input.monthlyRent,
        securityDeposit: input.securityDeposit,
        maintenanceCharges: input.maintenanceCharges ?? null,
        otherCharges: (input.otherCharges ?? undefined) as Prisma.InputJsonValue | undefined,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        rentDueDay: input.rentDueDay,
        noticePeriodDays: input.noticePeriodDays ?? null,
        lockInMonths: input.lockInMonths ?? null,
        additionalTerms: input.additionalTerms || null,
        expiresAt: days(input.expiresInDays),
      },
    });
    await audit(tx, req, { propertyId: property.id, entityType: "INVITATION", entityId: created.id, action: "invitation.create", newValue: { code: created.code, unitId: target.unitId, bedId: target.bedId, recipientName: input.recipientName, monthlyRent: input.monthlyRent } });
    return created;
  });
  const label = await targetLabel(invitation);
  const url = inviteUrl(token);
  res.locals.message = "Invitation link created. Share it with the tenant.";
  res.status(201).json({
    invitation: forLandlord(invitation, label),
    // The link is shown only now (and when a new link is made). It can't be read back later.
    link: { url, expiresAt: invitation.expiresAt, shareText: inviteMessage({ tenantName: input.recipientName, propertyName: property.title ?? property.code, unitLabel: label, url }) },
  });
}

/** GET /api/v1/invitations?propertyId=&status= — invitations for properties in the caller's lease scope. */
export async function listInvitations(req: Request, res: Response): Promise<void> {
  const scope = propertyWhere(me(req), "leases.manage");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to view invitations.");
  const p = pagination(req);
  const status = enumQuery(req, "status", INVITATION_STATUSES);
  // Expire stale ones first so the list shows the truth.
  await prisma.tenantInvitation.updateMany({ where: { status: "PENDING", expiresAt: { lte: new Date() }, property: scope }, data: { status: "EXPIRED" } });
  const where: Prisma.TenantInvitationWhereInput = and<Prisma.TenantInvitationWhereInput>(
    { property: scope },
    typeof req.query.propertyId === "string" && req.query.propertyId ? { propertyId: req.query.propertyId } : undefined,
    status ? { status } : undefined,
  );
  const [items, total] = await Promise.all([
    prisma.tenantInvitation.findMany({ where, include: { property: { select: { title: true, code: true } } }, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.tenantInvitation.count({ where }),
  ]);
  const rows = await Promise.all(items.map(async (i) => forLandlord(i, await targetLabel(i))));
  res.json(paged(rows, total, p));
}

async function scopedInvitation(req: Request) {
  const scope = propertyWhere(me(req), "leases.manage");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to manage invitations.");
  const inv = found(await prisma.tenantInvitation.findFirst({ where: { id: idParam(req), property: scope }, include: { property: true } }), "Invitation");
  return settleExpiry(inv);
}

/** POST /api/v1/invitations/:id/revoke — the link stops working immediately. */
export async function revokeInvitation(req: Request, res: Response): Promise<void> {
  const inv = await scopedInvitation(req);
  if (inv.status !== "PENDING") fail("failed-precondition", REASONS.INVALID_STATE, `This invitation is already ${inv.status.toLowerCase()}.`);
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "REVOKED", revokedById: me(req).id, respondedAt: new Date() } });
    if (r.count) await audit(tx, req, { propertyId: inv.propertyId, entityType: "INVITATION", entityId: inv.id, action: "invitation.revoke" });
    return r.count;
  });
  if (!done) fail("failed-precondition", REASONS.INVALID_STATE, "This invitation was just answered by the tenant. Refresh and check.");
  res.locals.message = "Invitation revoked";
  res.json({ ok: true });
}

/** POST /api/v1/invitations/:id/link — makes a new link (the old one stops working) and extends the expiry. */
export async function renewInvitationLink(req: Request, res: Response): Promise<void> {
  const inv = await scopedInvitation(req);
  if (!["PENDING", "EXPIRED"].includes(inv.status)) fail("failed-precondition", REASONS.INVALID_STATE, `This invitation is already ${inv.status.toLowerCase()}.`);
  await consumeRateLimit(`invite-create:${me(req).id}`, RATE_LIMITS.INVITE_CREATE.limit, RATE_LIMITS.INVITE_CREATE.windowMs);
  const { expiresInDays } = parseInput(linkSchema, req.body ?? {});
  if (inv.status === "EXPIRED") await resolveTarget(inv.property, inv.unitId ?? undefined, inv.bedId ?? undefined);
  const token = newInviteToken();
  const expiresAt = days(expiresInDays);
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: { in: ["PENDING", "EXPIRED"] } }, data: { tokenHash: hashInviteToken(token), expiresAt, status: "PENDING" } });
    if (r.count) await audit(tx, req, { propertyId: inv.propertyId, entityType: "INVITATION", entityId: inv.id, action: "invitation.new_link", newValue: { expiresAt } });
    return r.count;
  });
  if (!updated) fail("failed-precondition", REASONS.INVALID_STATE, "This invitation was just answered by the tenant. Refresh and check.");
  const label = await targetLabel(inv);
  const url = inviteUrl(token);
  res.locals.message = "New invitation link created. The old link no longer works.";
  res.json({ link: { url, expiresAt, shareText: inviteMessage({ tenantName: inv.recipientName, propertyName: inv.property.title ?? inv.property.code, unitLabel: label, url }) } });
}

/* ─────────────── Tenant side (signed-in user holding the link) ─────────────── */

const DECISION_MESSAGES = {
  NOT_PENDING: "This invitation is no longer open.",
  EXPIRED: "This invitation link has expired. Ask your landlord to send a new one.",
  OWN_INVITE: "You created this invitation. Share the link with your tenant.",
  WRONG_RECIPIENT: "This invitation was sent to a different phone number.",
  STAFF_ACCOUNT: "Staff accounts can't rent properties. Sign in with your personal account.",
} as const;

async function byToken(req: Request) {
  const user = me(req);
  await consumeRateLimit(`invite-lookup:${user.id}`, RATE_LIMITS.INVITE_LOOKUP.limit, RATE_LIMITS.INVITE_LOOKUP.windowMs);
  const token = req.params.token;
  if (!isWellFormedToken(token)) fail("not-found", REASONS.NOT_FOUND, "This invitation link is not valid.");
  const inv = await prisma.tenantInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { property: { select: { id: true, code: true, title: true, propertyTypeKey: true, addressLine: true, locality: true, city: true, state: true, pincode: true, ownerId: true, owner: { select: { fullName: true } } } } },
  });
  if (!inv) fail("not-found", REASONS.NOT_FOUND, "This invitation link is not valid. Ask your landlord for a new one.");
  return settleExpiry(inv);
}

function decisionFor(req: Request, inv: TenantInvitation) {
  const user = me(req);
  return canRespond(inv, { id: user.id, phoneNumber: user.phoneNumber, email: user.email, isStaff: ROLE_INFO[user.role].isStaff });
}

/** GET /api/v1/invitations/token/:token — details for the invited (signed-in) tenant only. */
export async function viewInvitation(req: Request, res: Response): Promise<void> {
  const inv = await byToken(req);
  const decision = decisionFor(req, inv);
  // Someone else holding the link learns nothing about the property or the tenant.
  if (!decision.ok && decision.reason === "WRONG_RECIPIENT") {
    fail("permission-denied", REASONS.PERMISSION_DENIED, `${DECISION_MESSAGES.WRONG_RECIPIENT} Sign in with ${inv.recipientPhone ? maskPhone(inv.recipientPhone) : "the invited account"}.`);
  }
  const label = await targetLabel(inv);
  const p = inv.property;
  res.json({
    invitation: {
      code: inv.code,
      status: inv.status,
      expiresAt: inv.expiresAt,
      canAccept: decision.ok,
      message: decision.ok ? null : DECISION_MESSAGES[decision.reason],
      recipientName: inv.recipientName,
      property: { name: p.title ?? p.code, code: p.code, address: [p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", "), type: typeOf(p).label },
      target: label,
      landlordName: p.owner?.fullName ?? null,
      monthlyRent: inv.monthlyRent.toFixed(2),
      securityDeposit: inv.securityDeposit.toFixed(2),
      maintenanceCharges: inv.maintenanceCharges?.toFixed(2) ?? null,
      otherCharges: inv.otherCharges,
      startDate: inv.startDate,
      endDate: leaseEndDate(inv.startDate, inv.endDate),
      rentDueDay: inv.rentDueDay,
      noticePeriodDays: inv.noticePeriodDays,
      lockInMonths: inv.lockInMonths,
      additionalTerms: inv.additionalTerms,
      leaseId: inv.status === "ACCEPTED" && inv.respondedById === me(req).id ? inv.leaseId : null,
    },
  });
}

function leaseTermsText(inv: TenantInvitation): string {
  const extra: string[] = [];
  if (inv.noticePeriodDays !== null) extra.push(`Notice period: ${inv.noticePeriodDays} days.`);
  if (inv.lockInMonths !== null) extra.push(`Lock-in period: ${inv.lockInMonths} months.`);
  if (inv.maintenanceCharges) extra.push(`Maintenance charges: ₹${inv.maintenanceCharges.toFixed(2)} per month.`);
  for (const c of (inv.otherCharges as Array<{ label: string; amount: string }> | null) ?? []) extra.push(`${c.label}: ₹${c.amount}.`);
  return [defaultTerms(inv.rentDueDay), extra.length ? `\nAgreed terms:\n${extra.join("\n")}` : "", inv.additionalTerms ? `\nAdditional terms:\n${inv.additionalTerms}` : ""].join("");
}

/**
 * POST /api/v1/invitations/token/:token/accept — explicit acceptance by the invited tenant.
 * One transaction: claim the invitation (single use) → occupy the flat / bed → create the lease →
 * add the Tenant role if needed. Any conflict rolls everything back.
 */
export async function acceptInvitation(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const inv = await byToken(req);
  const decision = decisionFor(req, inv);
  if (!decision.ok) fail(decision.reason === "WRONG_RECIPIENT" || decision.reason === "STAFF_ACCOUNT" ? "permission-denied" : "failed-precondition", decision.reason === "WRONG_RECIPIENT" ? REASONS.PERMISSION_DENIED : REASONS.INVALID_STATE, DECISION_MESSAGES[decision.reason]);
  const propertyName = inv.property.title ?? inv.property.code;
  const label = await targetLabel(inv);
  const needsTenantRole = user.role !== "TENANT" && !user.roles.includes("TENANT");

  const lease = await withProperty(inv.propertyId, async (tx) => {
    // Single use: only one request can move PENDING → ACCEPTED.
    const claimed = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "ACCEPTED", respondedById: user.id, respondedAt: new Date() } });
    if (claimed.count === 0) fail("failed-precondition", REASONS.INVALID_STATE, "This invitation is no longer open.");

    if (inv.unitId) {
      if (await tx.lease.count({ where: { unitId: inv.unitId, status: "ACTIVE" } })) fail("already-exists", REASONS.CONFLICT, "This unit has already been rented.");
      const taken = await tx.propertyUnit.updateMany({ where: { id: inv.unitId, activeStatus: "ACTIVE", availabilityStatus: { not: "OCCUPIED" } }, data: { availabilityStatus: "OCCUPIED", version: { increment: 1 } } });
      if (taken.count === 0) fail("already-exists", REASONS.CONFLICT, "This unit is no longer available.");
      await recordStatus(tx, req, { propertyId: inv.propertyId, entityType: "UNIT", entityId: inv.unitId, field: "availabilityStatus", from: "AVAILABLE", to: "OCCUPIED", reason: `Tenant accepted invitation ${inv.code}.` });
    } else if (!inv.bedId && (await tx.lease.count({ where: { propertyId: inv.propertyId, unitId: null, bedId: null, status: "ACTIVE" } }))) {
      fail("already-exists", REASONS.CONFLICT, "This property has already been rented.");
    }

    const created = await tx.lease.create({
      data: {
        code: await nextCode(tx, ID_PREFIX.LEASE),
        propertyId: inv.propertyId,
        unitId: inv.unitId,
        bedId: inv.bedId,
        landlordId: inv.landlordId,
        tenantId: user.id,
        invitationId: inv.id,
        startDate: inv.startDate,
        endDate: leaseEndDate(inv.startDate, inv.endDate),
        monthlyRent: inv.monthlyRent,
        securityDeposit: inv.securityDeposit,
        rentDueDay: inv.rentDueDay,
        maintenanceCharges: inv.maintenanceCharges,
        noticePeriodDays: inv.noticePeriodDays,
        lockInMonths: inv.lockInMonths,
        terms: leaseTermsText(inv),
        createdById: user.id,
      },
    });
    if (inv.bedId) await assignBedTx(req, inv.propertyId, inv.bedId, user.id, created.id, tx);
    await tx.tenantInvitation.update({ where: { id: inv.id }, data: { leaseId: created.id } });

    // Close the applications that were waiting for the same flat / bed.
    const sameTarget = { propertyId: inv.propertyId, status: "PENDING" as const, unitId: inv.unitId, bedId: inv.bedId };
    const others = await tx.rentalApplication.findMany({ where: sameTarget, select: { tenantId: true } });
    await tx.rentalApplication.updateMany({ where: sameTarget, data: { status: "REJECTED", decisionNote: "This unit has been rented.", decidedAt: new Date() } });

    if (needsTenantRole) {
      await tx.userRole.create({ data: { userId: user.id, role: "TENANT", grantedById: user.id } });
      await ensureRoleProfile(tx, user.id, "TENANT");
    }
    await audit(tx, req, { propertyId: inv.propertyId, entityType: "INVITATION", entityId: inv.id, action: "invitation.accept", newValue: { leaseId: created.id, leaseCode: created.code, tenantId: user.id } });
    await audit(tx, req, { propertyId: inv.propertyId, entityType: "LEASE", entityId: created.id, action: "lease.create", newValue: { code: created.code, tenantId: user.id, unitId: inv.unitId, bedId: inv.bedId, monthlyRent: inv.monthlyRent.toFixed(2), via: inv.code } });
    await logActivity(req, "invitation.accept", "tenant_invitation", inv.id, { leaseId: created.id }, tx);
    return { created, others };
  });

  await ensureRentSchedule(lease.created);
  // Landlord → tenant referral reward (once per tenant); also re-checks the tenant's own referral.
  await recordInvitationReferral(inv, user.id, lease.created.id).catch((err) => console.error("[referrals] invitation referral failed", err));
  await evaluateForUser(user.id);
  const place = label ? `${label}, ${propertyName}` : propertyName;
  await notify(inv.landlordId, "Tenant joined 🎉", `${user.fullName} accepted your invitation for ${place}. Lease ${lease.created.code} is active.`, `/leases/${lease.created.id}`);
  if (inv.createdById !== inv.landlordId) await notify(inv.createdById, "Tenant joined", `${user.fullName} accepted invitation ${inv.code} for ${place}.`, `/leases/${lease.created.id}`);
  await notify(user.id, "Welcome to your new home", `Your lease for ${place} is active from ${inv.startDate.toDateString()}.`, `/leases/${lease.created.id}`);
  for (const o of lease.others) await notify(o.tenantId, "Application update", `"${propertyName}" has been rented to another tenant.`, "/applications");
  res.locals.message = "Invitation accepted. Your lease is active.";
  res.json({ leaseId: lease.created.id, leaseCode: lease.created.code, rolesAdded: needsTenantRole ? ["TENANT"] : [] });
}

/** POST /api/v1/invitations/token/:token/reject — the invited tenant declines. */
export async function rejectInvitation(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const inv = await byToken(req);
  const decision = decisionFor(req, inv);
  if (!decision.ok && decision.reason !== "STAFF_ACCOUNT") fail(decision.reason === "WRONG_RECIPIENT" ? "permission-denied" : "failed-precondition", decision.reason === "WRONG_RECIPIENT" ? REASONS.PERMISSION_DENIED : REASONS.INVALID_STATE, DECISION_MESSAGES[decision.reason]);
  const r = await prisma.$transaction(async (tx) => {
    const done = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "REJECTED", respondedById: user.id, respondedAt: new Date() } });
    if (done.count) await audit(tx, req, { propertyId: inv.propertyId, entityType: "INVITATION", entityId: inv.id, action: "invitation.reject" });
    return done.count;
  });
  if (!r) fail("failed-precondition", REASONS.INVALID_STATE, "This invitation is no longer open.");
  await notify(inv.landlordId, "Invitation declined", `${inv.recipientName} declined invitation ${inv.code} for "${inv.property.title ?? inv.property.code}".`, `/properties/${inv.propertyId}`);
  res.locals.message = "Invitation declined";
  res.json({ ok: true });
}
