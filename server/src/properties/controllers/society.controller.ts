import { Prisma, type PropertySociety } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found, idParam } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { approvalSchema, monthlyMaintenance, parkingSlotSchema, parkingSlotUpdateSchema, societySchema, type SocietyInput } from "../../lib/society";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { and, propertyWhere } from "../../rbac/access";
import { audit, scopedProperty, typeOf, withProperty } from "../service";

/*
 * Society / association (apartment complexes, gated communities).
 *   Owner / manager: GET / PUT /properties/:id/society, parking slots (allocated to flats).
 *   Tenants browsing: maintenance, rules, visitor policy, gate method, amenity timings, move rules (no contacts).
 *   Lease (tenant + landlord): GET /leases/:id/society — contacts, gate contact, my parking, society approval.
 *   Landlord / lease managers: PUT /leases/:id/society-approval. Logs: ids only.
 */

const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));

function present(r: PropertySociety | null) {
  if (!r) return null;
  return {
    isSociety: r.isSociety,
    associationName: r.associationName,
    registrationNumber: r.registrationNumber,
    contactName: r.contactName,
    contactRole: r.contactRole,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    officeHours: r.officeHours,
    maintenanceAmount: num(r.maintenanceAmount),
    maintenanceFrequency: r.maintenanceFrequency,
    maintenanceMonthly: monthlyMaintenance(num(r.maintenanceAmount), r.maintenanceFrequency),
    maintenancePaidBy: r.maintenancePaidBy,
    maintenancePayTo: r.maintenancePayTo,
    rules: (r.rules as SocietyInput["rules"]) ?? [],
    visitorPolicy: r.visitorPolicy,
    gateAccessMethods: (r.gateAccessMethods as string[] | null) ?? [],
    gateContactName: r.gateContactName,
    gateContactPhone: r.gateContactPhone,
    clubhouseRules: r.clubhouseRules,
    commonAreas: (r.commonAreas as SocietyInput["commonAreas"]) ?? [],
    moveRequiresPermission: r.moveRequiresPermission,
    moveNoticeDays: r.moveNoticeDays,
    moveAllowedTimings: r.moveAllowedTimings,
    moveChargeAmount: num(r.moveChargeAmount),
    moveDepositAmount: num(r.moveDepositAmount),
    moveLiftBooking: r.moveLiftBooking,
    moveNotes: r.moveNotes,
    updatedAt: r.updatedAt,
  };
}

async function rulesDocument(propertyId: string) {
  const draft = await prisma.property.findFirst({ where: { revisionOfId: propertyId }, select: { id: true } });
  const d = await prisma.propertyDocument.findFirst({ where: { propertyId: { in: [propertyId, ...(draft ? [draft.id] : [])] }, docType: "SOCIETY_RULES", isCurrent: true, archivedAt: null }, select: { id: true, sharedWithTenant: true } });
  return d ? { documentId: d.id, sharedWithTenant: d.sharedWithTenant } : null;
}

function presentSlot(s: { id: string; unitId: string | null; slotNumber: string; vehicleType: string; covered: boolean; notes: string | null }, units: Map<string, string>) {
  return { id: s.id, slotNumber: s.slotNumber, unitId: s.unitId, unitLabel: s.unitId ? (units.get(s.unitId) ?? null) : null, vehicleType: s.vehicleType, covered: s.covered, notes: s.notes };
}

async function unitLabels(propertyId: string) {
  const units = await prisma.propertyUnit.findMany({ where: { propertyId }, select: { id: true, name: true, unitNumber: true, code: true } });
  return new Map(units.map((u) => [u.id, u.name || (u.unitNumber ? `Flat ${u.unitNumber}` : u.code)]));
}

function assertApplies(property: { propertyTypeKey: string }) {
  if (typeOf(property).category === "LAND") fail("failed-precondition", REASONS.INVALID_STATE, "Society details are for buildings and gated communities.");
}

/** GET /api/v1/properties/:propertyId/society */
export async function getSociety(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const [row, slots, labels] = await Promise.all([prisma.propertySociety.findUnique({ where: { propertyId: property.id } }), prisma.parkingSlot.findMany({ where: { propertyId: property.id }, orderBy: { slotNumber: "asc" } }), unitLabels(property.id)]);
  res.setHeader("Cache-Control", "no-store, private");
  res.json({ society: present(row), parkingSlots: slots.map((s) => presentSlot(s, labels)), rulesDocument: await rulesDocument(property.id) });
}

/** PUT /api/v1/properties/:propertyId/society — the whole object. */
export async function putSociety(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  assertApplies(property);
  const v = parseInput(societySchema, req.body ?? {});
  const json = (x: unknown[] | null | undefined) => (x && x.length ? (x as Prisma.InputJsonValue) : Prisma.DbNull);
  const data = {
    isSociety: v.isSociety,
    associationName: v.associationName ?? null,
    registrationNumber: v.registrationNumber ?? null,
    contactName: v.contactName ?? null,
    contactRole: v.contactRole ?? null,
    contactPhone: v.contactPhone ?? null,
    contactEmail: v.contactEmail ?? null,
    officeHours: v.officeHours ?? null,
    maintenanceAmount: v.maintenanceAmount ?? null,
    maintenanceFrequency: v.maintenanceFrequency ?? null,
    maintenancePaidBy: v.maintenancePaidBy ?? null,
    maintenancePayTo: v.maintenancePayTo ?? null,
    rules: json(v.rules),
    visitorPolicy: v.visitorPolicy ?? null,
    gateAccessMethods: json(v.gateAccessMethods),
    gateContactName: v.gateContactName ?? null,
    gateContactPhone: v.gateContactPhone ?? null,
    clubhouseRules: v.clubhouseRules ?? null,
    commonAreas: json(v.commonAreas),
    moveRequiresPermission: v.moveRequiresPermission ?? null,
    moveNoticeDays: v.moveNoticeDays ?? null,
    moveAllowedTimings: v.moveAllowedTimings ?? null,
    moveChargeAmount: v.moveChargeAmount ?? null,
    moveDepositAmount: v.moveDepositAmount ?? null,
    moveLiftBooking: v.moveLiftBooking ?? null,
    moveNotes: v.moveNotes ?? null,
    updatedById: me(req).id,
  };
  await withProperty(property.id, async (tx) => {
    await tx.propertySociety.upsert({ where: { propertyId: property.id }, create: { propertyId: property.id, ...data }, update: data });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "society.update" });
  });
  res.locals.message = "Society details saved";
  await getSociety(req, res);
}

/** The live flat for an id sent by the app (a live id, or its change-request copy's id). */
async function liveUnit(propertyId: string, unitId: string | null | undefined) {
  if (!unitId) return unitId;
  const live = await prisma.propertyUnit.findFirst({ where: { id: unitId, propertyId }, select: { id: true } });
  if (live) return live.id;
  const copy = await prisma.propertyUnit.findFirst({ where: { id: unitId, property: { revisionOfId: propertyId } }, select: { sourceId: true } });
  if (copy?.sourceId) return copy.sourceId;
  if (copy) fail("failed-precondition", REASONS.INVALID_STATE, "This flat is new. Allocate parking after the changes are approved.");
  fail("invalid-argument", REASONS.INVALID_INPUT, "This flat isn't part of this property.");
}

const P2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** POST /api/v1/properties/:propertyId/parking-slots */
export async function createSlot(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const v = parseInput(parkingSlotSchema, req.body ?? {});
  if ((await prisma.parkingSlot.count({ where: { propertyId: property.id } })) >= 1000) fail("failed-precondition", REASONS.INVALID_STATE, "A property can have at most 1000 parking slots.");
  try {
    const s = await prisma.parkingSlot.create({ data: { ...v, unitId: (await liveUnit(property.id, v.unitId)) ?? null, notes: v.notes ?? null, propertyId: property.id } });
    res.locals.message = "Parking slot added";
    res.status(201).json({ slot: presentSlot(s, await unitLabels(property.id)) });
  } catch (e) {
    if (P2002(e)) fail("already-exists", REASONS.CONFLICT, "This slot number already exists.");
    throw e;
  }
}

/** PATCH /api/v1/properties/:propertyId/parking-slots/:slotId — e.g. { unitId } to allocate, { unitId: null } to free. */
export async function updateSlot(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const slot = found(await prisma.parkingSlot.findFirst({ where: { id: idParam(req, "slotId"), propertyId: property.id } }), "Parking slot");
  const v = parseInput(parkingSlotUpdateSchema, req.body ?? {});
  try {
    const s = await prisma.parkingSlot.update({ where: { id: slot.id }, data: { ...v, ...(v.unitId !== undefined ? { unitId: (await liveUnit(property.id, v.unitId)) ?? null } : {}) } });
    res.locals.message = "Parking slot updated";
    res.json({ slot: presentSlot(s, await unitLabels(property.id)) });
  } catch (e) {
    if (P2002(e)) fail("already-exists", REASONS.CONFLICT, "This slot number already exists.");
    throw e;
  }
}

/** DELETE /api/v1/properties/:propertyId/parking-slots/:slotId */
export async function deleteSlot(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const done = await prisma.parkingSlot.deleteMany({ where: { id: idParam(req, "slotId"), propertyId: property.id } });
  if (!done.count) fail("not-found", REASONS.NOT_FOUND, "Parking slot not found.");
  res.locals.message = "Parking slot removed";
  res.json({ ok: true });
}

/** Tenants browsing a listing (no contacts, no registration number). */
export async function societyForListing(propertyId: string) {
  const r = present(await prisma.propertySociety.findUnique({ where: { propertyId } }));
  if (!r || !r.isSociety) return null;
  const slots = await prisma.parkingSlot.groupBy({ by: ["vehicleType", "covered"], where: { propertyId }, _count: { _all: true } });
  return {
    associationName: r.associationName,
    maintenanceAmount: r.maintenanceAmount,
    maintenanceFrequency: r.maintenanceFrequency,
    maintenanceMonthly: r.maintenanceMonthly,
    maintenancePaidBy: r.maintenancePaidBy,
    rules: r.rules,
    visitorPolicy: r.visitorPolicy,
    gateAccessMethods: r.gateAccessMethods,
    clubhouseRules: r.clubhouseRules,
    commonAreas: r.commonAreas,
    move: { requiresPermission: r.moveRequiresPermission, noticeDays: r.moveNoticeDays, allowedTimings: r.moveAllowedTimings, charge: r.moveChargeAmount, deposit: r.moveDepositAmount, liftBooking: r.moveLiftBooking, notes: r.moveNotes },
    parking: slots.map((s) => ({ vehicleType: s.vehicleType, covered: s.covered, count: s._count._all })),
  };
}

async function leaseFor(req: Request) {
  const user = me(req);
  const scope = propertyWhere(user, "leases.manage");
  const lease = found(await prisma.lease.findFirst({ where: { id: idParam(req, "leaseId"), OR: [{ tenantId: user.id }, { landlordId: user.id }, ...(scope ? [{ property: and(scope, {}) }] : [])] } }), "Lease");
  return { lease, isTenant: lease.tenantId === user.id && lease.landlordId !== user.id };
}

/** GET /api/v1/leases/:leaseId/society — the tenant and the landlord side. */
export async function leaseSociety(req: Request, res: Response): Promise<void> {
  const { lease, isTenant } = await leaseFor(req);
  if (isTenant && lease.status !== "ACTIVE") fail("failed-precondition", REASONS.LEASE_ENDED, "Society details are for your current rental.");
  const [r, slots, labels, doc] = await Promise.all([
    prisma.propertySociety.findUnique({ where: { propertyId: lease.propertyId } }),
    lease.unitId ? prisma.parkingSlot.findMany({ where: { propertyId: lease.propertyId, unitId: lease.unitId }, orderBy: { slotNumber: "asc" } }) : Promise.resolve([]),
    unitLabels(lease.propertyId),
    rulesDocument(lease.propertyId),
  ]);
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    society: r?.isSociety ? present(r) : null,
    myParking: slots.map((s) => presentSlot(s, labels)),
    rulesDocument: doc && (!isTenant || doc.sharedWithTenant) ? doc : null,
    approval: { status: lease.societyApprovalStatus ?? null, date: lease.societyApprovalDate ? lease.societyApprovalDate.toISOString().slice(0, 10) : null, note: lease.societyApprovalNote },
    can: { editApproval: !isTenant && lease.status === "ACTIVE" },
  });
}

/** PUT /api/v1/leases/:leaseId/society-approval { status, date?, note? } — landlord / lease managers. */
export async function putSocietyApproval(req: Request, res: Response): Promise<void> {
  const { lease, isTenant } = await leaseFor(req);
  if (isTenant) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the landlord can update the society approval.");
  if (lease.status !== "ACTIVE") fail("failed-precondition", REASONS.LEASE_ENDED, "This lease has ended.");
  const v = parseInput(approvalSchema, req.body ?? {});
  await withProperty(lease.propertyId, async (tx) => {
    await tx.lease.update({ where: { id: lease.id }, data: { societyApprovalStatus: v.status, societyApprovalDate: v.date ?? null, societyApprovalNote: v.note ?? null } });
    await audit(tx, req, { propertyId: lease.propertyId, entityType: "LEASE", entityId: lease.id, action: "lease.society_approval", newValue: { status: v.status } });
  });
  if (v.status !== lease.societyApprovalStatus && v.status !== "NOT_REQUIRED") {
    const text = { PENDING: "Your society approval is pending.", APPROVED: "The society approved your stay. 🎉", REJECTED: `The society didn't approve: ${v.note ?? ""}` }[v.status];
    await notify(lease.tenantId, "Society approval", text, `/leases/${lease.id}`, undefined, { type: "SOCIETY_APPROVAL", leaseId: lease.id });
  }
  res.locals.message = "Saved";
  await leaseSociety(req, res);
}
