import { appLink } from "../lib/appLinks";
import type { Prisma, TenantInvitation } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { canRespond, hashInviteToken, inviteMessage, isExpired, isWellFormedToken, leaseEndDate, newInviteToken } from "../lib/invitations";
import { maskPhone } from "../lib/mask";
import { decryptInviteToken, encryptInviteToken } from "../lib/inviteTokenCrypto";
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
import { depositUsableFor } from "../lib/depositPolicy";
import { assertNoReviewOwed, reviewsOwedBy } from "./reviews.controller";
import { DOCUMENT_REQUIREMENTS, answersSchema, asksNothing, documentStatus, requirementsSchema, ruleConflicts, type DocumentRequirement, type Requirements } from "../lib/tenantDetails";
import { decryptText, encryptText } from "./identityDocs.controller";

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
    // Either a phone number, or a SafeRent account picked with GET /users/lookup (recipientUserId).
    recipientUserId: z.string().uuid().optional(),
    recipientName: z.string().trim().min(2, "Enter the tenant's name.").max(120).optional(),
    recipientPhone: phoneE164Schema.optional(),
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
    /** What the tenant must answer / share when accepting. Leave out to ask nothing. */
    requirements: requirementsSchema.optional(),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate > v.startDate, { message: "End date must be after the start date.", path: ["endDate"] })
  .refine((v) => !!v.recipientUserId || !!v.recipientPhone, { message: "Enter the tenant's phone number.", path: ["recipientPhone"] })
  .refine((v) => !!v.recipientUserId || !!v.recipientName, { message: "Enter the tenant's name.", path: ["recipientName"] });

const rejectSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();

const linkSchema = z.object({ expiresInDays: z.coerce.number().int().min(1).max(30).default(7) }).strict();

/** https://app.saferenttechnologies.com/invite/{token} — opens the app (App Link) or the website. */
function inviteUrl(token: string): string {
  return appLink(`/invite/${token}`);
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
    requirements: (inv.requirements as Requirements | null) ?? null,
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
  // The last tenant of THIS property must be reviewed (while the review window is open) before inviting the next.
  const unreviewed = (await reviewsOwedBy(property.ownerId, "LANDLORD")).find((o) => o.propertyId === property.id);
  if (unreviewed) fail("already-exists", REASONS.REVIEW_REQUIRED, "Review your last tenant first", { leaseId: unreviewed.leaseId });
  const input = parseInput(createSchema, req.body);
  // Picked account: must be an active, non-staff account other than the landlord. Name / phone come from it.
  const account = input.recipientUserId
    ? await prisma.user.findFirst({ where: { id: input.recipientUserId, accountStatus: "ACTIVE" }, select: { id: true, fullName: true, phoneNumber: true, role: true } })
    : null;
  if (input.recipientUserId && (!account || ROLE_INFO[account.role].isStaff)) fail("invalid-argument", REASONS.INVALID_INPUT, "That SafeRent account can't be invited. Look the tenant up again.");
  if (account && (account.id === property.ownerId || account.id === user.id)) fail("invalid-argument", REASONS.INVALID_INPUT, "You can't invite yourself.");
  const recipientName = input.recipientName ?? account!.fullName;
  const recipientPhone = input.recipientPhone ?? account?.phoneNumber ?? null;
  const target = await resolveTarget(property, input.unitId, input.bedId);
  const pending = await prisma.tenantInvitation.findFirst({ where: { propertyId: property.id, unitId: target.unitId, bedId: target.bedId, status: "PENDING", expiresAt: { gt: new Date() } } });
  if (pending) fail("already-exists", REASONS.CONFLICT, `There's already a pending invitation (${pending.code}) for this. Revoke it or send its link again.`);

  const token = newInviteToken();
  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.tenantInvitation.create({
      data: {
        code: await nextCode(tx, ID_PREFIX.INVITATION),
        tokenHash: hashInviteToken(token),
        tokenEnc: encryptInviteToken(token),
        propertyId: property.id,
        unitId: target.unitId,
        bedId: target.bedId,
        landlordId: property.ownerId,
        createdById: user.id,
        recipientName,
        recipientPhone,
        recipientUserId: account?.id ?? null,
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
        requirements: input.requirements && !asksNothing(input.requirements) ? (input.requirements as Prisma.InputJsonValue) : undefined,
        expiresAt: days(input.expiresInDays),
      },
    });
    await audit(tx, req, { propertyId: property.id, entityType: "INVITATION", entityId: created.id, action: "invitation.create", newValue: { code: created.code, unitId: target.unitId, bedId: target.bedId, recipientUserId: account?.id ?? null, monthlyRent: input.monthlyRent } });
    return created;
  });
  const label = await targetLabel(invitation);
  const url = inviteUrl(token);
  const notified = await pushInvite(invitation, token, property.title ?? property.code, label);
  res.locals.message = notified ? "Invitation sent. The tenant got a notification in the SafeRent app." : "Invitation link created. Share it with the tenant.";
  res.status(201).json({
    invitation: forLandlord(invitation, label),
    // The link is shown only now (and when a new link is made). It can't be read back later.
    link: { url, expiresAt: invitation.expiresAt, shareText: inviteMessage({ tenantName: recipientName, propertyName: property.title ?? property.code, unitLabel: label, url }) },
    notified,
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
    const r = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: { in: ["PENDING", "EXPIRED"] } }, data: { tokenHash: hashInviteToken(token), tokenEnc: encryptInviteToken(token), expiresAt, status: "PENDING" } });
    if (r.count) await audit(tx, req, { propertyId: inv.propertyId, entityType: "INVITATION", entityId: inv.id, action: "invitation.new_link", newValue: { expiresAt } });
    return r.count;
  });
  if (!updated) fail("failed-precondition", REASONS.INVALID_STATE, "This invitation was just answered by the tenant. Refresh and check.");
  const label = await targetLabel(inv);
  const url = inviteUrl(token);
  await pushInvite(inv, token, inv.property.title ?? inv.property.code, label);
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

/**
 * Accept / reject on an invitation that's no longer open: 409 when it was already answered,
 * 410 when it expired or the landlord revoked it. Other refusals: 403 (another phone number / staff
 * account / own invitation). Every error carries a message the app can show as is.
 */
function refuse(inv: TenantInvitation, reason: keyof typeof DECISION_MESSAGES): never {
  if (reason === "NOT_PENDING" || reason === "EXPIRED") {
    if (inv.status === "ACCEPTED") fail("already-exists", REASONS.CONFLICT, "This invitation has already been accepted.");
    if (inv.status === "REJECTED") fail("already-exists", REASONS.CONFLICT, "This invitation has already been declined.");
    if (inv.status === "REVOKED") fail("deadline-exceeded", REASONS.INVITATION_CLOSED, "This invitation was cancelled by the landlord. Ask them for a new link.");
    fail("deadline-exceeded", REASONS.INVITATION_CLOSED, DECISION_MESSAGES.EXPIRED);
  }
  if (reason === "WRONG_RECIPIENT") fail("permission-denied", REASONS.PERMISSION_DENIED, `${DECISION_MESSAGES.WRONG_RECIPIENT} Sign in with ${inv.recipientPhone ? maskPhone(inv.recipientPhone) : "the invited account"}.`);
  fail("permission-denied", REASONS.PERMISSION_DENIED, DECISION_MESSAGES[reason]);
}

function decisionFor(req: Request, inv: TenantInvitation) {
  const user = me(req);
  return canRespond(inv, { id: user.id, phoneNumber: user.phoneNumber, email: user.email, isStaff: ROLE_INFO[user.role].isStaff });
}

/**
 * Push the invited tenant when they already have a SafeRent account (picked account, or the phone number
 * matches one): "<landlord> invited you", link /invite/{token}. Returns whether someone was notified.
 */
async function pushInvite(inv: TenantInvitation, token: string, propertyName: string, label: string | null): Promise<boolean> {
  const to = inv.recipientUserId
    ? inv.recipientUserId
    : inv.recipientPhone
      ? ((await prisma.user.findFirst({ where: { phoneNumber: inv.recipientPhone, accountStatus: "ACTIVE" }, select: { id: true } }))?.id ?? null)
      : null;
  if (!to || to === inv.landlordId) return false;
  const landlord = await prisma.user.findUnique({ where: { id: inv.landlordId }, select: { fullName: true } });
  const place = label ? `${label}, ${propertyName}` : propertyName;
  await notify(to, "You're invited to rent", `${landlord?.fullName ?? "A landlord"} invited you to rent ${place} on SafeRent. Open to see the terms and accept.`, `/invite/${token}`, undefined, { type: "TENANT_INVITATION", invitationId: inv.id });
  return true;
}

/** GET /api/v1/invitations/token/:token — details for the invited (signed-in) tenant only. */
export async function viewInvitation(req: Request, res: Response): Promise<void> {
  const inv = await byToken(req);
  res.json(await invitationView(req, inv));
}

type InviteWithProperty = Awaited<ReturnType<typeof byToken>>;

/** What the invited tenant sees (GET /invitations/token/:token and each item of GET /invitations/mine). */
async function invitationView(req: Request, inv: InviteWithProperty) {
  const decision = decisionFor(req, inv);
  // Someone else holding the link learns nothing about the property or the tenant.
  if (!decision.ok && decision.reason === "WRONG_RECIPIENT") {
    fail("permission-denied", REASONS.PERMISSION_DENIED, `${DECISION_MESSAGES.WRONG_RECIPIENT} Sign in with ${inv.recipientPhone ? maskPhone(inv.recipientPhone) : "the invited account"}.`);
  }
  const label = await targetLabel(inv);
  const p = inv.property;
  const [images, unit, bed, landlordKyc] = await Promise.all([
    prisma.propertyImage.findMany({ where: { propertyId: p.id, status: "APPROVED", inspectionId: null }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, unitId: true, category: true, width: true, height: true }, take: 12 }),
    inv.unitId ? prisma.propertyUnit.findUnique({ where: { id: inv.unitId }, select: { id: true, unitNumber: true, name: true, bhkType: true, floorNumber: true } }) : null,
    inv.bedId ? prisma.propertyBed.findUnique({ where: { id: inv.bedId }, select: { id: true, bedNumber: true, room: { select: { id: true, roomNumber: true } } } }) : null,
    prisma.landlordProfile.findUnique({ where: { userId: inv.landlordId }, select: { kycStatus: true } }),
  ]);
  // The invited flat's photos first, then the building's.
  const ordered = [...images.filter((i) => inv.unitId && i.unitId === inv.unitId), ...images.filter((i) => !i.unitId), ...images.filter((i) => i.unitId && i.unitId !== inv.unitId)];
  return {
    property: { id: p.id, code: p.code, title: p.title ?? p.code, locality: p.locality, city: p.city, coverImageId: ordered.find((i) => (i as { category?: string }).category !== "PANORAMA_360")?.id ?? null, images: ordered.map((i) => ({ id: i.id })) },
    unit: unit ? { id: unit.id, unitNumber: unit.unitNumber, name: unit.name, bhkType: unit.bhkType, floorNumber: unit.floorNumber } : null,
    bed: bed ? { id: bed.id, bedNumber: bed.bedNumber, room: { id: bed.room.id, roomNumber: bed.room.roomNumber } } : null,
    landlord: { fullName: p.owner?.fullName ?? null, verified: landlordKyc?.kycStatus === "APPROVED" },
    invitation: {
      id: inv.id,
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
      /** What the tenant must answer / share on accepting (null = nothing). */
      requirements: (inv.requirements as Requirements | null) ?? null,
      documentOptions: Object.entries(DOCUMENT_REQUIREMENTS).map(([key, d]) => ({ key, label: d.label, vaultTypes: d.vaultTypes })),
    },
    houseRules: await houseRulesOf(inv.propertyId, inv.lockInMonths),
    // The tenant's own last answers (no references), to fill the form.
    prefill: inv.requirements ? await prefillFor(me(req).id) : null,
    // The invited tenant still owes a review of their previous rental: the app asks for it before accepting.
    reviewRequired: decision.ok ? ((await reviewsOwedBy(me(req).id, "TENANT"))[0] ?? null) : null,
  };
}

/**
 * GET /api/v1/invitations/mine — open invitations sent to me (picked account, or my phone number):
 * PENDING and not expired, newest first. Each item = the GET /invitations/token/{token} view + token.
 */
export async function myInvitations(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const rows = await prisma.tenantInvitation.findMany({
    where: {
      status: "PENDING",
      expiresAt: { gt: new Date() },
      landlordId: { not: user.id },
      OR: [{ recipientUserId: user.id }, ...(user.phoneNumber ? [{ recipientPhone: user.phoneNumber }] : [])],
    },
    include: { property: { select: { id: true, code: true, title: true, propertyTypeKey: true, addressLine: true, locality: true, city: true, state: true, pincode: true, ownerId: true, owner: { select: { fullName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const items = [];
  for (const inv of rows) items.push({ ...(await invitationView(req, inv)), token: decryptInviteToken(inv.tokenEnc) });
  res.json({ items });
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
  if (!decision.ok) refuse(inv, decision.reason);
  await assertNoReviewOwed(user.id, "TENANT", "accept a new rental");
  const requirements = (inv.requirements as Requirements | null) ?? null;
  const answers = asksNothing(requirements) ? null : parseInput(answersSchema(requirements!), (req.body ?? {}).details ?? {});
  const propertyName = inv.property.title ?? inv.property.code;
  const label = await targetLabel(inv);
  const needsTenantRole = user.role !== "TENANT" && !user.roles.includes("TENANT");

  const lease = await withProperty(inv.propertyId, async (tx) => {
    // Single use: only one request can move PENDING → ACCEPTED.
    const claimed = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: "PENDING", expiresAt: { gt: new Date() } }, data: { status: "ACCEPTED", respondedById: user.id, respondedAt: new Date() } });
    if (claimed.count === 0) fail("already-exists", REASONS.CONFLICT, "This invitation has already been answered.");

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
        depositUsableAsRent: await depositUsableFor(tx, inv.propertyId, inv.unitId),
        createdById: user.id,
      },
    });
    if (inv.bedId) await assignBedTx(req, inv.propertyId, inv.bedId, user.id, created.id, tx);
    await tx.tenantInvitation.update({ where: { id: inv.id }, data: { leaseId: created.id } });
    if (answers) {
      const { references, backgroundConsent, ...rest } = answers;
      await tx.tenantRentalDetails.create({
        data: { ...rest, tenantId: user.id, invitationId: inv.id, leaseId: created.id, referencesEnc: references.length ? encryptText(JSON.stringify(references)) : null, backgroundConsentAt: backgroundConsent ? new Date() : null },
      });
    }

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
  res.json({
    lease: { id: lease.created.id, code: lease.created.code },
    leaseId: lease.created.id,
    leaseCode: lease.created.code,
    rolesAdded: needsTenantRole ? ["TENANT"] : [],
    // Documents the owner asked for: share them from the ID vault (POST /me/documents/:id/shares { leaseId }).
    documentsToShare: ((requirements?.documents ?? []) as DocumentRequirement[]).map((key) => ({ key, label: DOCUMENT_REQUIREMENTS[key].label, vaultTypes: DOCUMENT_REQUIREMENTS[key].vaultTypes })),
  });
}

/** POST /api/v1/invitations/token/:token/reject — the invited tenant declines. */
export async function rejectInvitation(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const inv = await byToken(req);
  const decision = decisionFor(req, inv);
  if (!decision.ok && decision.reason !== "STAFF_ACCOUNT") refuse(inv, decision.reason);
  const { reason } = parseInput(rejectSchema, req.body ?? {});
  const r = await prisma.$transaction(async (tx) => {
    const done = await tx.tenantInvitation.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "REJECTED", respondedById: user.id, respondedAt: new Date() } });
    if (done.count) await audit(tx, req, { propertyId: inv.propertyId, entityType: "INVITATION", entityId: inv.id, action: "invitation.reject", newValue: { reason: reason ?? null } });
    return done.count;
  });
  if (!r) fail("already-exists", REASONS.CONFLICT, "This invitation has already been answered.");
  await notify(
    inv.landlordId,
    "Invitation declined",
    `${inv.recipientName} declined invitation ${inv.code} for "${inv.property.title ?? inv.property.code}".${reason ? ` Reason: ${reason}` : ""}`,
    `/properties/${inv.propertyId}?tab=invitations`,
  );
  res.locals.message = "Invitation declined";
  res.json({ ok: true });
}

// ───── Tenant details asked on the invitation ─────

async function houseRulesOf(propertyId: string, lockInMonths: number | null) {
  const policy = await prisma.propertyPolicy.findUnique({ where: { propertyId }, select: { petsAllowed: true, smokingAllowed: true } });
  return { petsAllowed: policy?.petsAllowed ?? "NOT_DISCLOSED", smokingAllowed: policy?.smokingAllowed ?? "NOT_DISCLOSED", lockInMonths };
}

/** The tenant's last answers (to fill the form). References are never pre-filled. */
async function prefillFor(tenantId: string) {
  const last = await prisma.tenantRentalDetails.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  if (!last) return null;
  return { tenantType: last.tenantType, employmentType: last.employmentType, companyName: last.companyName, adults: last.adults, children: last.children, hasPets: last.hasPets, petDetails: last.petDetails, smokes: last.smokes, stayMonths: last.stayMonths };
}

/**
 * GET /api/v1/invitations/:id/tenant-details — what the tenant answered (landlord / lease managers).
 * Company name and references are shown only while the lease is active.
 */
export async function invitationTenantDetails(req: Request, res: Response): Promise<void> {
  const inv = await scopedInvitation(req);
  res.setHeader("Cache-Control", "no-store, private");
  const requirements = (inv.requirements as Requirements | null) ?? null;
  const d = await prisma.tenantRentalDetails.findUnique({ where: { invitationId: inv.id } });
  if (!d) {
    res.json({ requirements, details: null, documents: [], conflicts: [] });
    return;
  }
  const lease = d.leaseId ? await prisma.lease.findUnique({ where: { id: d.leaseId }, select: { status: true } }) : null;
  const active = lease?.status === "ACTIVE";
  const shared = d.leaseId ? await prisma.tenantDocumentShare.findMany({ where: { leaseId: d.leaseId }, select: { document: { select: { type: true } } } }) : [];
  const refs = active && d.referencesEnc ? (JSON.parse(decryptText(d.referencesEnc) ?? "[]") as Array<{ name: string; relation: string; phone: string }>) : [];
  res.json({
    requirements,
    details: {
      tenantType: d.tenantType,
      employmentType: d.employmentType,
      companyName: active ? d.companyName : null,
      adults: d.adults,
      children: d.children,
      hasPets: d.hasPets,
      petDetails: d.petDetails,
      smokes: d.smokes,
      stayMonths: d.stayMonths,
      references: refs,
      backgroundConsentAt: d.backgroundConsentAt,
      leaseActive: active,
      answeredAt: d.createdAt,
    },
    documents: documentStatus((requirements?.documents ?? []) as DocumentRequirement[], shared.map((s) => s.document.type)),
    conflicts: ruleConflicts(d, await houseRulesOf(inv.propertyId, inv.lockInMonths)),
  });
}
