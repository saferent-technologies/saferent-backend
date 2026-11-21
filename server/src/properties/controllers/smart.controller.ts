import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { appLink } from "../../lib/appLinks";
import { fail } from "../../lib/errors";
import { found, idParam } from "../../lib/http";
import { compareInspections } from "../../lib/inspectionCompare";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { qrSvg } from "../../lib/qr";
import { consumeRateLimit } from "../../lib/rateLimit";
import { DEFAULT_SETTINGS, daysBetween, inSendingHours, isLatePayer, nextReminder, reminderSettingsSchema, type ReminderSettings } from "../../lib/rentReminders";
import { parseInput } from "../../lib/validation";
import { istDate } from "../../lib/visitSlots";
import { can, hasRole, me } from "../../middleware/auth";
import { imageUrl } from "../presenters";
import { inScope, isModerator, scopedProperty } from "../service";

/*
 * Smart features:
 *   1. Move-in vs move-out inspection comparison (lease).
 *   2. QR codes for a property / flat (App Link) and resolving a scanned code to what the user can do there.
 *   3. Smart rent reminders: before / after the due date on the landlord's schedule, earlier for late payers.
 * Logs: ids only.
 */

// ───── 1. Inspection comparison ─────

/** GET /api/v1/leases/:leaseId/inspection-comparison — landlord, tenant, property team. */
export async function inspectionComparison(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = found(await prisma.lease.findUnique({ where: { id: idParam(req, "leaseId") }, select: { id: true, tenantId: true, landlordId: true, propertyId: true } }), "Lease");
  const party = lease.tenantId === user.id || lease.landlordId === user.id;
  if (!party && !isModerator(req) && !(await inScope(req, "properties.view", lease.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Lease not found.");
  const rows = await prisma.propertyInspection.findMany({ where: { leaseId: lease.id, type: { in: ["MOVE_IN", "MOVE_OUT"] } }, include: { photos: { select: { id: true, category: true, createdAt: true } } } });
  const moveIn = rows.find((r) => r.type === "MOVE_IN");
  const moveOut = rows.find((r) => r.type === "MOVE_OUT");
  const side = (r: (typeof rows)[number] | undefined) =>
    r ? { id: r.id, status: r.status, inspectionDate: r.inspectionDate, landlordAcknowledgedAt: r.landlordAcknowledgedAt, tenantAcknowledgedAt: r.tenantAcknowledgedAt, photos: r.photos.map((p) => ({ id: p.id, category: p.category, url: imageUrl(p.id) })) } : null;
  res.setHeader("Cache-Control", "no-store, private");
  if (!moveIn || !moveOut || moveIn.status !== "COMPLETED" || moveOut.status !== "COMPLETED") {
    res.json({ ready: false, missing: [...(!moveIn || moveIn.status !== "COMPLETED" ? ["MOVE_IN"] : []), ...(!moveOut || moveOut.status !== "COMPLETED" ? ["MOVE_OUT"] : [])], moveIn: side(moveIn), moveOut: side(moveOut), comparison: null });
    return;
  }
  res.json({ ready: true, missing: [], moveIn: side(moveIn), moveOut: side(moveOut), comparison: compareInspections(moveIn as never, moveOut as never) });
}

// ───── 2. QR codes ─────

async function unitOf(propertyId: string, unitId: string | undefined) {
  if (!unitId) return null;
  const u =
    (await prisma.propertyUnit.findFirst({ where: { id: unitId, propertyId }, select: { id: true, code: true, name: true, unitNumber: true } })) ??
    (await prisma.propertyUnit.findFirst({ where: { id: unitId, property: { revisionOfId: propertyId } }, select: { sourceId: true } }).then((c) => (c?.sourceId ? prisma.propertyUnit.findUnique({ where: { id: c.sourceId }, select: { id: true, code: true, name: true, unitNumber: true } }) : null)));
  if (!u) fail("invalid-argument", REASONS.INVALID_INPUT, "This flat isn't part of this property.");
  return u!;
}
const unitLabel = (u: { name: string | null; unitNumber: string | null; code: string }) => u.name || (u.unitNumber ? `Flat ${u.unitNumber}` : u.code);
const qrUrl = (propertyCode: string, unitCode?: string | null) => appLink(`/p/${encodeURIComponent(propertyCode)}${unitCode ? `/u/${encodeURIComponent(unitCode)}` : ""}`);

/** GET /api/v1/properties/:propertyId/qr — links for the property and each flat (apps draw the QR). */
export async function qrLinks(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const units = await prisma.propertyUnit.findMany({ where: { propertyId: property.id, activeStatus: "ACTIVE" }, select: { id: true, code: true, name: true, unitNumber: true }, orderBy: { createdAt: "asc" } });
  res.json({
    property: { code: property.code, title: property.title ?? property.code, url: qrUrl(property.code) },
    units: units.map((u) => ({ unitId: u.id, code: u.code, label: unitLabel(u), url: qrUrl(property.code, u.code) })),
  });
}

/** GET /api/v1/properties/:propertyId/qr.svg[?unitId=] — printable QR (SVG) with a caption. */
export async function qrImage(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const unit = await unitOf(property.id, typeof req.query.unitId === "string" ? req.query.unitId : undefined);
  const caption = unit ? `${property.title ?? property.code} · ${unitLabel(unit)}` : (property.title ?? property.code);
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", `inline; filename="${(unit?.code ?? property.code).replace(/[^\w.-]/g, "_")}-qr.svg"`);
  res.send(qrSvg(qrUrl(property.code, unit?.code), 512, caption.slice(0, 60)));
}

/**
 * GET /api/v1/qr/resolve?code=SR-PROP-…&unit=SR-UNIT-… — what a scanned QR opens for this user:
 * owner / team → property; tenant of that flat → their lease actions; anyone else → the public listing (if live).
 */
export async function resolveQr(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await consumeRateLimit(`qr-resolve:${user.id}`, 60, 60 * 60 * 1000);
  const code = String(req.query.code ?? "").trim();
  const unitCode = typeof req.query.unit === "string" ? req.query.unit.trim() : "";
  const property = await prisma.property.findFirst({ where: { code, revisionOfId: null }, select: { id: true, code: true, title: true, ownerId: true, publicationStatus: true, activeStatus: true } });
  if (!property) fail("not-found", REASONS.NOT_FOUND, "This QR code isn't a SafeRent property.");
  const unit = unitCode ? await prisma.propertyUnit.findFirst({ where: { code: unitCode, propertyId: property!.id }, select: { id: true, code: true, name: true, unitNumber: true } }) : null;
  const team = property!.ownerId === user.id || (await inScope(req, "properties.view", property!.id));
  const lease = await prisma.lease.findFirst({ where: { propertyId: property!.id, tenantId: user.id, status: "ACTIVE", ...(unit ? { unitId: unit.id } : {}) }, select: { id: true } });
  const live = property!.publicationStatus === "PUBLISHED" && property!.activeStatus === "ACTIVE";
  const visits = live ? await prisma.propertyVisitSettings.findUnique({ where: { propertyId: property!.id }, select: { enabled: true } }) : null;
  const role = team ? "TEAM" : lease ? "TENANT" : live ? "VISITOR" : "NONE";
  const actions =
    role === "TEAM"
      ? ["OPEN_PROPERTY", ...(can(req, "inspections.manage") || property!.ownerId === user.id || hasRole(req, "PROPERTY_MANAGER") ? ["START_INSPECTION"] : []), "OPEN_FURNITURE"]
      : role === "TENANT"
        ? ["OPEN_LEASE", "RAISE_REQUEST", "EMERGENCY"]
        : role === "VISITOR"
          ? ["VIEW_LISTING", ...(visits?.enabled ? ["BOOK_VISIT"] : [])]
          : [];
  res.json({
    role,
    property: { id: role === "NONE" ? null : property!.id, code: property!.code, title: role === "NONE" ? null : (property!.title ?? property!.code) },
    unit: unit && role !== "NONE" ? { id: unit.id, code: unit.code, label: unitLabel(unit) } : null,
    leaseId: lease?.id ?? null,
    actions,
    message: role === "NONE" ? "This property isn't listed on SafeRent right now." : null,
  });
}

// ───── 3. Smart rent reminders ─────

async function settingsFor(landlordId: string): Promise<ReminderSettings> {
  const r = await prisma.rentReminderSettings.findUnique({ where: { landlordId } });
  return r ? { enabled: r.enabled, beforeDays: r.beforeDays as number[], overdueDays: r.overdueDays as number[], smartEarly: r.smartEarly } : DEFAULT_SETTINGS;
}

/** GET /api/v1/rent/reminder-settings — landlord. */
export async function getReminderSettings(req: Request, res: Response): Promise<void> {
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Rent reminders are set by landlords.");
  res.json({ settings: await settingsFor(me(req).id), defaults: DEFAULT_SETTINGS, sendingHours: "9 AM – 8 PM IST" });
}

/** PUT /api/v1/rent/reminder-settings — landlord. */
export async function putReminderSettings(req: Request, res: Response): Promise<void> {
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Rent reminders are set by landlords.");
  const s = parseInput(reminderSettingsSchema, req.body ?? {});
  const data = { enabled: s.enabled, beforeDays: s.beforeDays as Prisma.InputJsonValue, overdueDays: s.overdueDays as Prisma.InputJsonValue, smartEarly: s.smartEarly };
  await prisma.rentReminderSettings.upsert({ where: { landlordId: me(req).id }, create: { landlordId: me(req).id, ...data }, update: data });
  res.locals.message = s.enabled ? "Rent reminders saved" : "Rent reminders turned off";
  res.json({ settings: s, defaults: DEFAULT_SETTINGS, sendingHours: "9 AM – 8 PM IST" });
}

const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Job: smart reminders (between 9 AM and 8 PM IST). The due-day and first overdue notices stay in rentNotifications. */
export async function processSmartRentReminders(now = new Date()): Promise<number> {
  if (!inSendingHours(now)) return 0;
  const today = istDate(now);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86_400_000);
  const to = new Date(Date.parse(`${today}T00:00:00Z`) + 10 * 86_400_000);
  const dues = await prisma.rentPayment.findMany({
    where: { status: { in: ["DUE", "OVERDUE", "PARTIAL"] }, dueDate: { gte: from, lte: to }, lease: { status: "ACTIVE" } },
    select: { id: true, tenantId: true, landlordId: true, amount: true, paidAmount: true, dueDate: true, lease: { select: { property: { select: { title: true, code: true } } } } },
    take: 1000,
  });
  if (!dues.length) return 0;
  const logs = await prisma.rentReminderLog.findMany({ where: { rentPaymentId: { in: dues.map((d) => d.id) } }, select: { rentPaymentId: true, kind: true } });
  const sentMap = new Map<string, Set<string>>();
  for (const l of logs) (sentMap.get(l.rentPaymentId) ?? sentMap.set(l.rentPaymentId, new Set()).get(l.rentPaymentId)!).add(l.kind);
  const settingsCache = new Map<string, ReminderSettings>();
  const lateCache = new Map<string, boolean>();
  let sent = 0;
  for (const d of dues) {
    const s = settingsCache.get(d.landlordId) ?? (await settingsFor(d.landlordId));
    settingsCache.set(d.landlordId, s);
    if (!s.enabled) continue;
    const daysToDue = daysBetween(today, ymd(d.dueDate));
    let late = lateCache.get(d.tenantId);
    if (late === undefined && daysToDue > 0 && s.smartEarly) {
      const hist = await prisma.rentPayment.findMany({ where: { tenantId: d.tenantId, dueDate: { gte: new Date(Date.parse(`${today}T00:00:00Z`) - 183 * 86_400_000), lt: new Date(`${today}T00:00:00Z`) } }, select: { dueDate: true, paidAt: true, status: true } });
      late = isLatePayer(hist.map((h) => ({ dueDate: ymd(h.dueDate), paidOn: h.paidAt ? istDate(h.paidAt) : null, overdueNow: h.status === "OVERDUE" })));
      lateCache.set(d.tenantId, late);
    }
    const next = nextReminder(s, daysToDue, !!late, sentMap.get(d.id) ?? new Set());
    if (!next) continue;
    if (next.skip.length) await prisma.rentReminderLog.createMany({ data: next.skip.map((kind) => ({ rentPaymentId: d.id, kind, sent: false })), skipDuplicates: true });
    try {
      await prisma.rentReminderLog.create({ data: { rentPaymentId: d.id, kind: next.kind } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // another run sent it
      throw e;
    }
    const balance = Math.max(0, Number(d.amount) - Number(d.paidAmount));
    const where = d.lease.property.title ?? d.lease.property.code;
    const when = d.dueDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
    const [title, body] =
      daysToDue > 0
        ? [`Rent due in ${daysToDue} day${daysToDue > 1 ? "s" : ""}`, `Rent of ${inr(balance)} for ${where} is due on ${when}.`]
        : [`Rent ${-daysToDue} day${daysToDue < -1 ? "s" : ""} overdue`, `${inr(balance)} for ${where} was due on ${when}. Please pay your landlord${balance < Number(d.amount) ? " the balance" : ""}.`];
    await notify(d.tenantId, title, body, "/rent", daysToDue > 0 ? "RENT_DUE" : "RENT_OVERDUE", { type: "RENT_REMINDER", rentPaymentId: d.id });
    if (daysToDue <= -7) await notify(d.landlordId, "Rent still unpaid", `${inr(balance)} for ${where} is ${-daysToDue} days overdue.`, "/rent", "RENT_OVERDUE", { type: "RENT_REMINDER", rentPaymentId: d.id });
    sent++;
  }
  return sent;
}
