import type { Prisma, PropertyVisit, PropertyVisitSettings } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { consumeRateLimit } from "../../lib/rateLimit";
import { parseInput } from "../../lib/validation";
import { bookingSchema, feedbackSchema, findSlot, istDate, reasonSchema, slotsFor, visitSettingsSchema, type VisitSettings } from "../../lib/visitSlots";
import { me } from "../../middleware/auth";
import { and, propertyWhere, visitWhere } from "../../rbac/access";
import { scopedProperty } from "../service";

/*
 * Property visits booked from the app.
 *   Owner / manager: availability (days, time slots, capacity, notice, approval mode, host).
 *   Tenant: sees free slots → books (REQUESTED, or SCHEDULED when auto-confirm) → cancels with a reason → feedback.
 *   Host / owner / manager: confirm, reject (reason), cancel (reason), complete (outcome), no-show, change host.
 * Privacy: the exact address, host phone and visit instructions are shown to the visitor only once confirmed;
 * the visitor's phone is shown to the host only for open visits. Logs: ids only.
 */

const OPEN = ["REQUESTED", "SCHEDULED"] as const;
const DEFAULTS = { enabled: false, approvalMode: "MANUAL", slotMinutes: 30, capacityPerSlot: 1, minNoticeHours: 4, maxDaysAhead: 14, weekly: [], blockedDates: [], hostId: null, instructions: null };
const IST = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function settingsOf(row: PropertyVisitSettings | null): VisitSettings {
  if (!row) return { ...DEFAULTS } as unknown as VisitSettings;
  return {
    enabled: row.enabled,
    approvalMode: row.approvalMode as VisitSettings["approvalMode"],
    slotMinutes: row.slotMinutes as VisitSettings["slotMinutes"],
    capacityPerSlot: row.capacityPerSlot,
    minNoticeHours: row.minNoticeHours,
    maxDaysAhead: row.maxDaysAhead,
    weekly: (row.weekly as VisitSettings["weekly"]) ?? [],
    blockedDates: (row.blockedDates as string[]) ?? [],
    hostId: row.hostId,
    instructions: row.instructions,
  };
}

/** Who can show the property: the owner and the managers / agents assigned to it. */
async function hostOptions(propertyId: string, ownerId: string) {
  const rows = await prisma.propertyAssignment.findMany({ where: { propertyId }, select: { userId: true, type: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [ownerId, ...rows.map((r) => r.userId)] } }, select: { id: true, fullName: true } });
  const name = (id: string) => users.find((u) => u.id === id)?.fullName ?? null;
  return [{ id: ownerId, fullName: name(ownerId), role: "OWNER" }, ...rows.map((r) => ({ id: r.userId, fullName: name(r.userId), role: r.type }))];
}

async function defaultHost(propertyId: string, ownerId: string, chosen: string | null | undefined): Promise<string> {
  if (chosen) return chosen;
  const a = await prisma.propertyAssignment.findMany({ where: { propertyId }, select: { userId: true, type: true }, orderBy: { createdAt: "asc" } });
  return a.find((x) => x.type === "MANAGER")?.userId ?? a.find((x) => x.type === "AGENT")?.userId ?? ownerId;
}

// ───── Owner / manager: availability ─────

/** GET /api/v1/properties/:propertyId/visit-settings */
export async function getVisitSettings(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const row = await prisma.propertyVisitSettings.findUnique({ where: { propertyId: property.id } });
  res.json({ settings: settingsOf(row), hosts: await hostOptions(property.id, property.ownerId), timezone: "Asia/Kolkata" });
}

/** PUT /api/v1/properties/:propertyId/visit-settings — the whole settings object. */
export async function putVisitSettings(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(visitSettingsSchema, req.body ?? {});
  if (input.hostId && !(await hostOptions(property.id, property.ownerId)).some((h) => h.id === input.hostId)) fail("invalid-argument", REASONS.INVALID_INPUT, "The host must be the owner or a manager / agent assigned to this property.");
  const data = { ...input, weekly: input.weekly as Prisma.InputJsonValue, blockedDates: [...new Set(input.blockedDates)].sort() as Prisma.InputJsonValue, hostId: input.hostId ?? null, instructions: input.instructions ?? null, updatedById: me(req).id };
  const row = await prisma.propertyVisitSettings.upsert({ where: { propertyId: property.id }, create: { propertyId: property.id, ...data }, update: data });
  res.locals.message = input.enabled ? "Visit booking is on" : "Visit booking is off";
  res.json({ settings: settingsOf(row), hosts: await hostOptions(property.id, property.ownerId), timezone: "Asia/Kolkata" });
}

// ───── Tenant: slots, booking, my visits ─────

async function publicProperty(id: string) {
  return found(
    await prisma.property.findFirst({ where: { OR: [{ id }, { code: id }], publicationStatus: "PUBLISHED", activeStatus: "ACTIVE", revisionOfId: null }, select: { id: true, code: true, title: true, ownerId: true, locality: true, city: true } }),
    "Listing",
  );
}

async function bookedCounts(propertyId: string, from: Date, to: Date) {
  const rows = await prisma.propertyVisit.groupBy({ by: ["scheduledAt"], where: { propertyId, status: { in: [...OPEN] }, scheduledAt: { gte: from, lte: to } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.scheduledAt.toISOString(), r._count._all]));
}

/** GET /api/v1/browse/:propertyId/visit-slots?from=YYYY-MM-DD&days=7 */
export async function visitSlots(req: Request, res: Response): Promise<void> {
  const property = await publicProperty(String(req.params.propertyId));
  const s = settingsOf(await prisma.propertyVisitSettings.findUnique({ where: { propertyId: property.id } }));
  const now = new Date();
  const today = istDate(now);
  const from = typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) && req.query.from >= today ? req.query.from : today;
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 31);
  const booked = await bookedCounts(property.id, now, new Date(now.getTime() + 62 * 86_400_000));
  const mine = await prisma.propertyVisit.findFirst({ where: { propertyId: property.id, tenantId: me(req).id, status: { in: [...OPEN] }, scheduledAt: { gte: now } }, select: { id: true, scheduledAt: true, status: true } });
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    enabled: s.enabled,
    approvalMode: s.approvalMode,
    slotMinutes: s.slotMinutes,
    timezone: "Asia/Kolkata",
    maxDaysAhead: s.maxDaysAhead,
    days: slotsFor(s, now, from, days, booked),
    myUpcomingVisit: mine,
  });
}

/** POST /api/v1/browse/:propertyId/visits { start, unitId?, bedId?, visitors, note? } */
export async function bookVisit(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const property = await publicProperty(String(req.params.propertyId));
  if (property.ownerId === user.id) fail("failed-precondition", REASONS.INVALID_STATE, "You can't book a visit to your own property.");
  await consumeRateLimit(`visit-book:${user.id}`, 10, 24 * 60 * 60 * 1000);
  const input = parseInput(bookingSchema, req.body ?? {});
  if (input.unitId && input.bedId) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a flat or a bed, not both.");
  if (input.unitId && !(await prisma.propertyUnit.count({ where: { id: input.unitId, propertyId: property.id, activeStatus: "ACTIVE" } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "This flat isn't part of this listing.");
  if (input.bedId && !(await prisma.propertyBed.count({ where: { id: input.bedId, room: { propertyId: property.id }, activeStatus: "ACTIVE" } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "This bed isn't part of this listing.");
  const s = settingsOf(await prisma.propertyVisitSettings.findUnique({ where: { propertyId: property.id } }));
  if (!s.enabled) fail("failed-precondition", REASONS.INVALID_STATE, "The owner isn't taking visit bookings in the app right now.");
  const now = new Date();
  const slot = findSlot(s, now, input.start);
  if (!slot) fail("failed-precondition", REASONS.INVALID_STATE, "That time isn't available. Pick another slot.");
  const hostId = await defaultHost(property.id, property.ownerId, s.hostId);
  const auto = s.approvalMode === "AUTO";

  const visit = await prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ got: bigint | number | null }>>`SELECT GET_LOCK(${`saferent_visit_${property.id}`}, 5) AS got`;
      if (!lock || Number(lock.got) !== 1) fail("unavailable", REASONS.INVALID_STATE, "Busy right now. Try again in a moment.");
      try {
        if (await tx.propertyVisit.count({ where: { propertyId: property.id, tenantId: user.id, status: { in: [...OPEN] }, scheduledAt: { gte: now } } }))
          fail("already-exists", REASONS.CONFLICT, "You already have a visit booked for this property. Cancel it to pick another time.");
        const taken = await tx.propertyVisit.count({ where: { propertyId: property.id, status: { in: [...OPEN] }, scheduledAt: input.start } });
        if (taken >= s.capacityPerSlot) fail("already-exists", REASONS.CONFLICT, "Someone just booked this slot. Pick another time.");
        return tx.propertyVisit.create({
          data: {
            propertyId: property.id,
            unitId: input.unitId ?? null,
            bedId: input.bedId ?? null,
            agentId: hostId,
            tenantId: user.id,
            scheduledAt: input.start,
            endsAt: new Date(slot!.end),
            source: "TENANT",
            visitors: input.visitors,
            visitorNote: input.note ?? null,
            status: auto ? "SCHEDULED" : "REQUESTED",
            confirmedAt: auto ? now : null,
          },
        });
      } finally {
        await tx.$queryRaw`SELECT RELEASE_LOCK(${`saferent_visit_${property.id}`})`;
      }
    },
    { timeout: 15_000 },
  );

  const name = property.title ?? property.code;
  const when = IST(visit.scheduledAt);
  const forHost = auto ? ["New property visit", `${user.fullName} booked a visit to "${name}" on ${when}.`] : ["Visit request", `${user.fullName} wants to visit "${name}" on ${when}. Confirm or decline.`];
  await notify(hostId, forHost[0]!, forHost[1]!, "/visits", undefined, { type: "VISIT", visitId: visit.id });
  if (hostId !== property.ownerId) await notify(property.ownerId, forHost[0]!, forHost[1]!, "/visits", undefined, { type: "VISIT", visitId: visit.id });
  res.locals.message = auto ? "Visit confirmed" : "Visit requested. You'll be notified when the owner confirms.";
  res.status(201).json({ visit: await presentForVisitor(visit) });
}

async function presentForVisitor(v: PropertyVisit) {
  const p = await prisma.property.findUnique({ where: { id: v.propertyId }, select: { id: true, code: true, title: true, addressLine: true, locality: true, city: true, state: true, pincode: true, latitude: true, longitude: true } });
  const confirmed = v.status === "SCHEDULED" || v.status === "COMPLETED";
  const showContact = v.status === "SCHEDULED";
  const [host, settings] = await Promise.all([
    showContact ? prisma.user.findUnique({ where: { id: v.agentId }, select: { fullName: true, phoneNumber: true } }) : null,
    showContact ? prisma.propertyVisitSettings.findUnique({ where: { propertyId: v.propertyId }, select: { instructions: true } }) : null,
  ]);
  const now = Date.now();
  return {
    id: v.id,
    property: p ? { id: p.id, code: p.code, title: p.title ?? p.code, locality: p.locality, city: p.city } : null,
    unitId: v.unitId,
    bedId: v.bedId,
    scheduledAt: v.scheduledAt,
    endsAt: v.endsAt,
    status: v.status,
    visitors: v.visitors,
    note: v.visitorNote,
    // Shown once the visit is confirmed.
    address: confirmed && p ? [p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", ") : null,
    location: confirmed && p?.latitude != null && p.longitude != null ? { latitude: Number(p.latitude), longitude: Number(p.longitude) } : null,
    host: host ? { fullName: host.fullName, phoneNumber: host.phoneNumber } : null,
    instructions: settings?.instructions ?? null,
    rejectReason: v.rejectReason,
    cancelReason: v.cancelReason,
    cancelledBy: v.cancelledAt ? (v.cancelledById === v.tenantId ? "YOU" : v.cancelledById ? "OWNER" : "SYSTEM") : null,
    canCancel: (OPEN as readonly string[]).includes(v.status) && v.scheduledAt.getTime() > now,
    canGiveFeedback: !v.feedbackAt && (v.status === "COMPLETED" || (v.status === "SCHEDULED" && v.scheduledAt.getTime() < now)),
    feedback: v.feedbackAt ? { rating: v.feedbackRating, interested: v.feedbackInterested, comment: v.feedbackComment, at: v.feedbackAt } : null,
    createdAt: v.createdAt,
  };
}

/** GET /api/v1/my/visits?upcoming=true */
export async function myVisits(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const where: Prisma.PropertyVisitWhereInput = { tenantId: me(req).id, ...(req.query.upcoming === "true" ? { scheduledAt: { gte: new Date() }, status: { in: [...OPEN] } } : {}) };
  const [rows, total] = await Promise.all([prisma.propertyVisit.findMany({ where, orderBy: { scheduledAt: "desc" }, skip: p.skip, take: p.take }), prisma.propertyVisit.count({ where })]);
  const items = [];
  for (const v of rows) items.push(await presentForVisitor(v));
  res.setHeader("Cache-Control", "no-store, private");
  res.json(paged(items, total, p));
}

async function myVisit(req: Request) {
  return found(await prisma.propertyVisit.findFirst({ where: { id: idParam(req), tenantId: me(req).id } }), "Visit");
}

/** POST /api/v1/my/visits/:id/cancel { reason } */
export async function cancelMyVisit(req: Request, res: Response): Promise<void> {
  const v = await myVisit(req);
  const { reason } = parseInput(reasonSchema, req.body ?? {});
  if (!(OPEN as readonly string[]).includes(v.status) || v.scheduledAt.getTime() <= Date.now()) fail("failed-precondition", REASONS.INVALID_STATE, "This visit can't be cancelled now.");
  const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: { in: [...OPEN] } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: me(req).id, cancelReason: reason } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This visit was just updated. Refresh and check.");
  await notify(v.agentId, "Visit cancelled", `${me(req).fullName} cancelled the visit on ${IST(v.scheduledAt)}. Reason: ${reason}`, "/visits", undefined, { type: "VISIT", visitId: v.id });
  res.locals.message = "Visit cancelled";
  res.json({ visit: await presentForVisitor((await prisma.propertyVisit.findUnique({ where: { id: v.id } }))!) });
}

/** POST /api/v1/my/visits/:id/feedback { rating 1–5, interested, comment? } */
export async function visitFeedback(req: Request, res: Response): Promise<void> {
  const v = await myVisit(req);
  const input = parseInput(feedbackSchema, req.body ?? {});
  const allowed = !v.feedbackAt && (v.status === "COMPLETED" || (v.status === "SCHEDULED" && v.scheduledAt.getTime() < Date.now()));
  if (!allowed) fail("failed-precondition", REASONS.INVALID_STATE, v.feedbackAt ? "You've already given feedback for this visit." : "You can give feedback after the visit.");
  const updated = await prisma.propertyVisit.update({ where: { id: v.id }, data: { feedbackRating: input.rating, feedbackInterested: input.interested, feedbackComment: input.comment ?? null, feedbackAt: new Date() } });
  if (input.interested) await notify(v.agentId, "Visitor is interested", `${me(req).fullName} is interested after the visit on ${IST(v.scheduledAt)}.`, "/visits", undefined, { type: "VISIT", visitId: v.id });
  res.locals.message = "Thanks for the feedback";
  res.json({ visit: await presentForVisitor(updated) });
}

// ───── Host / owner / manager ─────

/** Visits the caller may manage: visits.manage scope, or properties they manage (owner / assigned manager). */
function manageWhere(req: Request): Prisma.PropertyVisitWhereInput {
  const user = me(req);
  const a = visitWhere(user, "visits.manage");
  const pw = propertyWhere(user, "properties.manage");
  const parts = [a, pw ? { property: pw } : null, { agentId: user.id }].filter(Boolean) as Prisma.PropertyVisitWhereInput[];
  return { OR: parts };
}

async function presentForHost(rows: PropertyVisit[]) {
  const ids = [...new Set(rows.flatMap((v) => [v.tenantId, v.agentId]).filter(Boolean) as string[])];
  const [users, props] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phoneNumber: true } }),
    prisma.property.findMany({ where: { id: { in: [...new Set(rows.map((v) => v.propertyId))] } }, select: { id: true, code: true, title: true, locality: true, city: true } }),
  ]);
  const u = (id: string | null) => users.find((x) => x.id === id);
  return rows.map((v) => {
    const open = (OPEN as readonly string[]).includes(v.status);
    const visitor = u(v.tenantId);
    const host = u(v.agentId);
    return {
      id: v.id,
      property: props.find((p) => p.id === v.propertyId) ?? null,
      unitId: v.unitId,
      bedId: v.bedId,
      scheduledAt: v.scheduledAt,
      endsAt: v.endsAt,
      status: v.status,
      source: v.source,
      visitors: v.visitors,
      visitorNote: v.visitorNote,
      // The visitor's phone only while the visit is open.
      visitor: visitor ? { id: visitor.id, fullName: visitor.fullName, phoneNumber: open ? visitor.phoneNumber : null } : null,
      host: host ? { id: host.id, fullName: host.fullName } : null,
      confirmedAt: v.confirmedAt,
      rejectReason: v.rejectReason,
      cancelReason: v.cancelReason,
      cancelledBy: v.cancelledAt ? (v.cancelledById && v.cancelledById === v.tenantId ? "VISITOR" : v.cancelledById ? "OWNER" : "SYSTEM") : null,
      outcome: v.notes,
      completedAt: v.completedAt,
      feedback: v.feedbackAt ? { rating: v.feedbackRating, interested: v.feedbackInterested, comment: v.feedbackComment, at: v.feedbackAt } : null,
      createdAt: v.createdAt,
    };
  });
}

/** GET /api/v1/visits?status=&propertyId=&upcoming=true — visits I host or manage. */
export async function listManagedVisits(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = enumQuery(req, "status", ["REQUESTED", "SCHEDULED", "REJECTED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const);
  const where = and<Prisma.PropertyVisitWhereInput>(
    manageWhere(req),
    status ? { status } : undefined,
    typeof req.query.propertyId === "string" && req.query.propertyId ? { propertyId: req.query.propertyId } : undefined,
    req.query.upcoming === "true" ? { scheduledAt: { gte: new Date() } } : undefined,
  );
  const [rows, total] = await Promise.all([
    prisma.propertyVisit.findMany({ where, orderBy: { scheduledAt: req.query.upcoming === "true" ? "asc" : "desc" }, skip: p.skip, take: p.take }),
    prisma.propertyVisit.count({ where }),
  ]);
  res.setHeader("Cache-Control", "no-store, private");
  res.json(paged(await presentForHost(rows), total, p));
}

async function managedVisit(req: Request) {
  return found(await prisma.propertyVisit.findFirst({ where: and(manageWhere(req), { id: idParam(req) }), include: { property: { select: { title: true, code: true, ownerId: true } } } }), "Visit");
}

async function respond(res: Response, id: string, message: string) {
  res.locals.message = message;
  res.json({ visit: (await presentForHost([(await prisma.propertyVisit.findUnique({ where: { id } }))!]))[0] });
}

/** POST /api/v1/visits/:id/confirm */
export async function confirmVisit(req: Request, res: Response): Promise<void> {
  const v = await managedVisit(req);
  if (v.scheduledAt.getTime() <= Date.now()) fail("failed-precondition", REASONS.INVALID_STATE, "This visit time has passed.");
  const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: "REQUESTED" }, data: { status: "SCHEDULED", confirmedAt: new Date(), confirmedById: me(req).id } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "Only requested visits can be confirmed.");
  await notify(v.tenantId, "Visit confirmed ✅", `Your visit to "${v.property.title ?? v.property.code}" on ${IST(v.scheduledAt)} is confirmed. See the address and contact in the app.`, "/my/visits", undefined, { type: "VISIT", visitId: v.id });
  await respond(res, v.id, "Visit confirmed");
}

/** POST /api/v1/visits/:id/reject { reason } */
export async function rejectVisit(req: Request, res: Response): Promise<void> {
  const v = await managedVisit(req);
  const { reason } = parseInput(reasonSchema, req.body ?? {});
  const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: "REQUESTED" }, data: { status: "REJECTED", rejectReason: reason, cancelledById: me(req).id } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "Only requested visits can be declined.");
  await notify(v.tenantId, "Visit not confirmed", `The owner couldn't confirm your visit to "${v.property.title ?? v.property.code}" on ${IST(v.scheduledAt)}. Reason: ${reason}`, "/my/visits", undefined, { type: "VISIT", visitId: v.id });
  await respond(res, v.id, "Visit declined");
}

/** POST /api/v1/visits/:id/cancel { reason } — a confirmed (or requested) visit, by the host side. */
export async function cancelManagedVisit(req: Request, res: Response): Promise<void> {
  const v = await managedVisit(req);
  const { reason } = parseInput(reasonSchema, req.body ?? {});
  const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: { in: [...OPEN] } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: me(req).id, cancelReason: reason } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This visit can't be cancelled now.");
  await notify(v.tenantId, "Visit cancelled", `Your visit to "${v.property.title ?? v.property.code}" on ${IST(v.scheduledAt)} was cancelled. Reason: ${reason}`, "/my/visits", undefined, { type: "VISIT", visitId: v.id });
  await respond(res, v.id, "Visit cancelled");
}

const outcomeSchema = z.object({ outcome: z.string().trim().max(500).optional() }).strict();

/** POST /api/v1/visits/:id/complete { outcome? } */
export async function completeVisit(req: Request, res: Response): Promise<void> {
  const v = await managedVisit(req);
  const { outcome } = parseInput(outcomeSchema, req.body ?? {});
  if (v.scheduledAt.getTime() > Date.now()) fail("failed-precondition", REASONS.INVALID_STATE, "Mark the visit done after it has happened.");
  const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: "SCHEDULED" }, data: { status: "COMPLETED", completedAt: new Date(), ...(outcome ? { notes: outcome } : {}) } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "Only confirmed visits can be marked done.");
  await notify(v.tenantId, "How was the visit?", `Tell us how your visit to "${v.property.title ?? v.property.code}" went.`, "/my/visits", undefined, { type: "VISIT_FEEDBACK", visitId: v.id });
  await respond(res, v.id, "Visit marked done");
}

/** POST /api/v1/visits/:id/no-show */
export async function noShowVisit(req: Request, res: Response): Promise<void> {
  const v = await managedVisit(req);
  if (v.scheduledAt.getTime() > Date.now()) fail("failed-precondition", REASONS.INVALID_STATE, "Mark a no-show after the visit time.");
  const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: "SCHEDULED" }, data: { status: "NO_SHOW", completedAt: new Date() } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "Only confirmed visits can be marked as no-show.");
  await respond(res, v.id, "Marked as no-show");
}

/** POST /api/v1/visits/:id/host { hostId } — owner / managers change who shows the property. */
export async function changeVisitHost(req: Request, res: Response): Promise<void> {
  const v = await managedVisit(req);
  const hostId = String((req.body ?? {}).hostId ?? "");
  if (!(await hostOptions(v.propertyId, v.property.ownerId)).some((h) => h.id === hostId)) fail("invalid-argument", REASONS.INVALID_INPUT, "The host must be the owner or a manager / agent assigned to this property.");
  if (!(OPEN as readonly string[]).includes(v.status)) fail("failed-precondition", REASONS.INVALID_STATE, "Only open visits can be reassigned.");
  await prisma.propertyVisit.update({ where: { id: v.id }, data: { agentId: hostId } });
  if (hostId !== me(req).id) await notify(hostId, "Visit assigned to you", `Show "${v.property.title ?? v.property.code}" on ${IST(v.scheduledAt)}.`, "/visits", undefined, { type: "VISIT", visitId: v.id });
  await respond(res, v.id, "Host changed");
}

// ───── Job: reminders and stale requests ─────

/** Every few minutes: remind confirmed visits ~2 hours ahead; close requests nobody confirmed in time. */
export async function processVisitReminders(): Promise<void> {
  const now = new Date();
  const soon = await prisma.propertyVisit.findMany({ where: { status: "SCHEDULED", reminderSentAt: null, scheduledAt: { gt: now, lte: new Date(now.getTime() + 2 * 3_600_000) } }, include: { property: { select: { title: true, code: true } } }, take: 200 });
  for (const v of soon) {
    const claimed = await prisma.propertyVisit.updateMany({ where: { id: v.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    const name = v.property.title ?? v.property.code;
    await notify(v.tenantId, "Visit reminder", `Your visit to "${name}" is at ${IST(v.scheduledAt)}.`, "/my/visits", undefined, { type: "VISIT", visitId: v.id });
    await notify(v.agentId, "Visit reminder", `You're showing "${name}" at ${IST(v.scheduledAt)}.`, "/visits", undefined, { type: "VISIT", visitId: v.id });
  }
  const stale = await prisma.propertyVisit.findMany({ where: { status: "REQUESTED", scheduledAt: { lte: now } }, include: { property: { select: { title: true, code: true } } }, take: 200 });
  for (const v of stale) {
    const done = await prisma.propertyVisit.updateMany({ where: { id: v.id, status: "REQUESTED" }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Not confirmed before the visit time." } });
    if (done.count) await notify(v.tenantId, "Visit not confirmed", `The owner didn't confirm your visit to "${v.property.title ?? v.property.code}" in time. Book another slot.`, "/my/visits", undefined, { type: "VISIT", visitId: v.id });
  }
}
