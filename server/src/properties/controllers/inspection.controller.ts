import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { imageUrl } from "../presenters";
import { inspectionCreateSchema, inspectionUpdateSchema } from "../schemas";
import { audit, diff, inScope, scopedProperty, withProperty } from "../service";

/** Inspections are managed by inspectors (inspections.manage) or the people who manage the property. */
async function inspectableProperty(req: Request) {
  try {
    return await scopedProperty(req, "inspections.manage");
  } catch {
    return scopedProperty(req, "properties.manage");
  }
}

const photoSelect = { select: { id: true, category: true, createdAt: true } } as const;

/** POST /api/v1/properties/:propertyId/inspections — move-in and move-out are separate records per lease. */
export async function createInspection(req: Request, res: Response): Promise<void> {
  const property = await inspectableProperty(req);
  const input = parseInput(inspectionCreateSchema, req.body);
  if (input.unitId && !(await prisma.propertyUnit.count({ where: { id: input.unitId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Unit not found in this property.");
  if (input.roomId && !(await prisma.propertyRoom.count({ where: { id: input.roomId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Room not found in this property.");
  if (input.bedId && !(await prisma.propertyBed.count({ where: { id: input.bedId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Bed not found in this property.");
  if (input.leaseId && !(await prisma.lease.count({ where: { id: input.leaseId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Lease not found for this property.");
  try {
    const inspection = await withProperty(property.id, async (tx) => {
      const created = await tx.propertyInspection.create({ data: { ...input, propertyId: property.id, inspectorId: me(req).id, notes: input.notes ?? null } });
      await audit(tx, req, { propertyId: property.id, entityType: "INSPECTION", entityId: created.id, action: "inspection.create", newValue: { type: input.type, scheduledAt: input.scheduledAt, leaseId: input.leaseId ?? null } });
      return created;
    });
    if (property.ownerId !== me(req).id) await notify(property.ownerId, "Inspection scheduled", `${input.type.replace("_", "-").toLowerCase()} inspection for "${property.title ?? property.code}" on ${input.scheduledAt.toLocaleString("en-IN")}.`, `/properties/${property.id}`);
    res.status(201).json({ inspection });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") fail("already-exists", REASONS.CONFLICT, `A ${input.type.replace("_", "-").toLowerCase()} inspection already exists for this lease.`);
    throw e;
  }
}

/** GET /api/v1/properties/:propertyId/inspections */
export async function listInspections(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const items = await prisma.propertyInspection.findMany({ where: { propertyId: property.id }, include: { photos: photoSelect }, orderBy: { scheduledAt: "desc" }, take: 100 });
  res.json({ items: items.map((i) => ({ ...i, photos: i.photos.map((p) => ({ ...p, url: imageUrl(p.id) })) })), total: items.length, page: 1, pageSize: items.length, totalPages: 1 });
}

/** PATCH /api/v1/properties/:propertyId/inspections/:inspectionId — record the condition report. */
export async function updateInspection(req: Request, res: Response): Promise<void> {
  const property = await inspectableProperty(req);
  const inspection = found(await prisma.propertyInspection.findFirst({ where: { id: String(req.params.inspectionId), propertyId: property.id } }), "Inspection");
  if (inspection.landlordAcknowledgedAt || inspection.tenantAcknowledgedAt) fail("failed-precondition", REASONS.INVALID_STATE, "This inspection was acknowledged and can no longer be changed. Create a new inspection.");
  const input = parseInput(inspectionUpdateSchema, req.body);
  if (input.status === "COMPLETED" && !input.inspectionDate && !inspection.inspectionDate) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter the inspection date to complete it.");
  const { furnitureInventory, ...rest } = input;
  const data: Prisma.PropertyInspectionUncheckedUpdateInput = { ...rest, ...(furnitureInventory !== undefined ? { furnitureInventory: (furnitureInventory ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}) };
  const delta = diff(inspection as unknown as Record<string, unknown>, input as Record<string, unknown>);
  const updated = await withProperty(property.id, async (tx) => {
    const row = await tx.propertyInspection.update({ where: { id: inspection.id }, data });
    if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "INSPECTION", entityId: inspection.id, action: "inspection.update", oldValue: delta.old, newValue: delta.new });
    return row;
  });
  res.json({ inspection: updated });
}

/** POST /api/v1/properties/:propertyId/inspections/:inspectionId/acknowledge — landlord or the lease tenant. */
export async function acknowledgeInspection(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const inspection = found(await prisma.propertyInspection.findFirst({ where: { id: String(req.params.inspectionId) }, include: { property: { select: { id: true, ownerId: true, code: true } } } }), "Inspection");
  const lease = inspection.leaseId ? await prisma.lease.findUnique({ where: { id: inspection.leaseId }, select: { tenantId: true } }) : null;
  const asLandlord = inspection.property.ownerId === user.id;
  const asTenant = lease?.tenantId === user.id;
  if (!asLandlord && !asTenant) {
    // Not a party — hide existence unless the user can view the property.
    if (!(await inScope(req, "properties.view", inspection.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Inspection not found.");
    fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the landlord or the tenant can acknowledge an inspection.");
  }
  if (inspection.status !== "COMPLETED") fail("failed-precondition", REASONS.INVALID_STATE, "Only completed inspections can be acknowledged.");
  await withProperty(inspection.propertyId, async (tx) => {
    await tx.propertyInspection.update({ where: { id: inspection.id }, data: asLandlord ? { landlordAcknowledgedAt: new Date() } : { tenantAcknowledgedAt: new Date() } });
    await audit(tx, req, { propertyId: inspection.propertyId, entityType: "INSPECTION", entityId: inspection.id, action: asLandlord ? "inspection.ack_landlord" : "inspection.ack_tenant" });
  });
  res.json({ ok: true });
}
