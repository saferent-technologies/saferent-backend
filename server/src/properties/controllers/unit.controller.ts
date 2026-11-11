import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { maxUnits, UNIT_COLUMNS, unitPrefix, type PropertyTypeDef } from "../catalog";
import { fieldsSchema, flatValues, mergeAttributes, splitValues } from "../fields";
import { nextCode, nextCodes } from "../ids";
import { duplexFloorsSchema, versionField } from "../schemas";
import { audit, checkVersion, childKey, diff, isModerator, recordStatus, scopedProperty, typeOf, withProperty, type Tx } from "../service";
import { canEditContent } from "../workflow";
import { savePricing } from "./details.controller";

const SETTABLE_AVAILABILITY = ["AVAILABLE", "RESERVED", "UNDER_MAINTENANCE", "NOT_AVAILABLE"];

function unitFor(type: PropertyTypeDef) {
  if (type.structure === "ROOMS_BEDS" || !type.unitKind) fail("failed-precondition", REASONS.INVALID_STATE, `${type.label} properties use rooms and beds, not units.`);
  return type.unitKind;
}

/** Validates the type-specific unit fields of one unit body. `pricing` is saved alongside. */
function parseUnitBody(type: PropertyTypeDef, body: unknown) {
  const raw = (body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const pricing = raw.pricing;
  const version = parseInput(versionField, raw.version);
  delete raw.pricing;
  delete raw.version;
  const values = parseInput(fieldsSchema(type.unitFields), raw) as Record<string, unknown>;
  if (values.availabilityStatus === "OCCUPIED") fail("invalid-argument", REASONS.INVALID_INPUT, "A unit becomes OCCUPIED only through a lease or tenant assignment.");
  if (values.availabilityStatus && !SETTABLE_AVAILABILITY.includes(String(values.availabilityStatus))) fail("invalid-argument", REASONS.INVALID_INPUT, "Invalid availability status.");
  const split = splitValues(values, UNIT_COLUMNS);
  return { values, pricing, version, ...split };
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function loadEditable(req: Request) {
  const property = await scopedProperty(req, "properties.manage");
  const decision = canEditContent(property, isModerator(req));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  return property;
}

async function activeUnitCount(tx: Tx | typeof prisma, propertyId: string): Promise<number> {
  return tx.propertyUnit.count({ where: { propertyId, activeStatus: { not: "ARCHIVED" } } });
}

/** POST /api/v1/properties/:propertyId/units — add one flat / villa / office space … */
export async function createUnit(req: Request, res: Response): Promise<void> {
  const property = await loadEditable(req);
  const type = typeOf(property);
  const kind = unitFor(type);
  const body = parseUnitBody(type, req.body);
  const limit = maxUnits(type, property.attributes as Record<string, unknown> | null);
  try {
    const unit = await withProperty(property.id, async (tx) => {
      if (limit !== null && (await activeUnitCount(tx, property.id)) >= limit) {
        fail("failed-precondition", REASONS.INVALID_STATE, limit === 1 ? `A ${type.label.toLowerCase()} has exactly one ${type.unitLabel?.toLowerCase() ?? "unit"}. Edit the existing one.` : `This property allows at most ${limit} units.`);
      }
      const code = await nextCode(tx, unitPrefix(kind));
      const created = await tx.propertyUnit.create({
        data: {
          ...(body.columns as Prisma.PropertyUnitUncheckedCreateInput),
          code,
          propertyId: property.id,
          kind,
          attributes: mergeAttributes(null, body.attributes) as Prisma.InputJsonValue,
        },
      });
      if (body.pricing !== undefined) await savePricing(tx, req, property, created.id, body.pricing);
      await audit(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: created.id, action: "unit.create", newValue: { code, ...body.values } });
      await recordStatus(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: created.id, field: "availabilityStatus", from: null, to: created.availabilityStatus });
      return created;
    });
    res.locals.message = `${type.unitLabel ?? "Unit"} added`;
    res.status(201).json({ unit: await unitWithDetails(unit.id) });
  } catch (error) {
    if (uniqueViolation(error)) fail("already-exists", REASONS.CONFLICT, `${type.unitLabel ?? "Unit"} number already exists in this property.`);
    throw error;
  }
}

const bulkSchema = z.object({ units: z.array(z.record(z.string(), z.unknown())).min(1).max(200) }).strict();

/** POST /api/v1/properties/:propertyId/units/bulk — many flats in one go (building details are not repeated). */
export async function createUnitsBulk(req: Request, res: Response): Promise<void> {
  const property = await loadEditable(req);
  const type = typeOf(property);
  const kind = unitFor(type);
  const { units } = parseInput(bulkSchema, req.body);
  const parsed = units.map((u, i) => {
    try {
      return parseUnitBody(type, u);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid unit.";
      fail("invalid-argument", REASONS.INVALID_INPUT, `Unit ${i + 1}: ${message}`);
    }
  });
  const numbers = parsed.map((p) => String(p.columns.unitNumber ?? "")).filter(Boolean);
  if (new Set(numbers).size !== numbers.length) fail("invalid-argument", REASONS.INVALID_INPUT, "The same unit number appears more than once.");
  const limit = maxUnits(type, property.attributes as Record<string, unknown> | null);
  try {
    const ids = await withProperty(property.id, async (tx) => {
      if (limit !== null && (await activeUnitCount(tx, property.id)) + parsed.length > limit) fail("failed-precondition", REASONS.INVALID_STATE, `This property allows at most ${limit} units.`);
      const codes = await nextCodes(tx, unitPrefix(kind), parsed.length);
      const out: string[] = [];
      for (const [i, p] of parsed.entries()) {
        const created = await tx.propertyUnit.create({
          data: { ...(p.columns as Prisma.PropertyUnitUncheckedCreateInput), code: codes[i]!, propertyId: property.id, kind, attributes: mergeAttributes(null, p.attributes) as Prisma.InputJsonValue },
        });
        if (p.pricing !== undefined) await savePricing(tx, req, property, created.id, p.pricing);
        out.push(created.id);
      }
      await audit(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: property.id, action: "unit.bulk_create", newValue: { count: out.length, codes } });
      return out;
    });
    res.locals.message = `${ids.length} units added`;
    res.status(201).json({ units: await Promise.all(ids.map(unitWithDetails)) });
  } catch (error) {
    if (uniqueViolation(error)) fail("already-exists", REASONS.CONFLICT, "One of these unit numbers already exists in this property.");
    throw error;
  }
}

async function unitWithDetails(id: string) {
  const unit = await prisma.propertyUnit.findUniqueOrThrow({ where: { id }, include: { floors: { orderBy: { floorNumber: "asc" } } } });
  const [pricing, utilities] = await Promise.all([
    prisma.propertyPricing.findUnique({ where: { propertyId_scopeKey: { propertyId: unit.propertyId, scopeKey: unit.id } }, include: { charges: true } }),
    prisma.propertyUtility.findUnique({ where: { propertyId_scopeKey: { propertyId: unit.propertyId, scopeKey: unit.id } } }),
  ]);
  return { ...unit, attributes: unit.attributes ?? {}, pricing, utilities };
}

async function scopedUnit(req: Request, propertyId: string) {
  return found(await prisma.propertyUnit.findFirst({ where: { ...childKey(req, "unitId"), propertyId } }), "Unit");
}

/** GET /api/v1/properties/:propertyId/units */
export async function listUnits(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const includeArchived = req.query.includeArchived === "true";
  const units = await prisma.propertyUnit.findMany({
    where: { propertyId: property.id, ...(includeArchived ? {} : { activeStatus: { not: "ARCHIVED" } }) },
    include: { floors: { orderBy: { floorNumber: "asc" } } },
    orderBy: [{ floorNumber: "asc" }, { unitNumber: "asc" }],
  });
  res.json({ items: units, total: units.length, page: 1, pageSize: units.length, totalPages: 1 });
}

/** GET /api/v1/properties/:propertyId/units/:unitId */
export async function getUnit(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const unit = await scopedUnit(req, property.id);
  res.json({ unit: await unitWithDetails(unit.id) });
}

/** PATCH /api/v1/properties/:propertyId/units/:unitId */
export async function updateUnit(req: Request, res: Response): Promise<void> {
  const property = await loadEditable(req);
  const type = typeOf(property);
  const unit = await scopedUnit(req, property.id);
  const body = parseUnitBody(type, req.body);
  checkVersion(unit, body.version);

  const activeLease = await prisma.lease.count({ where: { unitId: unit.id, status: "ACTIVE" } });
  if (activeLease && body.columns.availabilityStatus && body.columns.availabilityStatus !== "OCCUPIED") {
    fail("failed-precondition", REASONS.INVALID_STATE, "This unit has an active lease. End the lease before changing its availability.");
  }
  const delta = diff(flatValues(unit as unknown as Record<string, unknown>), body.values);
  try {
    await withProperty(property.id, async (tx) => {
      const updated = await tx.propertyUnit.updateMany({
        where: { id: unit.id, version: unit.version },
        data: {
          ...(body.columns as Prisma.PropertyUnitUncheckedUpdateManyInput),
          ...(Object.keys(body.attributes).length ? { attributes: mergeAttributes(unit.attributes, body.attributes) as Prisma.InputJsonValue } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) fail("already-exists", REASONS.VERSION_CONFLICT, "This unit was changed by someone else. Reload and try again.");
      if (body.pricing !== undefined) await savePricing(tx, req, property, unit.id, body.pricing);
      if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: unit.id, action: "unit.update", oldValue: delta.old, newValue: delta.new });
      if (body.columns.availabilityStatus) {
        await recordStatus(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: unit.id, field: "availabilityStatus", from: unit.availabilityStatus, to: String(body.columns.availabilityStatus) });
      }
    });
  } catch (error) {
    if (uniqueViolation(error)) fail("already-exists", REASONS.CONFLICT, `${type.unitLabel ?? "Unit"} number already exists in this property.`);
    throw error;
  }
  res.locals.message = "Unit updated";
  res.json({ unit: await unitWithDetails(unit.id) });
}

/** DELETE /api/v1/properties/:propertyId/units/:unitId — soft archive. */
export async function archiveUnit(req: Request, res: Response): Promise<void> {
  const property = await loadEditable(req);
  const type = typeOf(property);
  const unit = await scopedUnit(req, property.id);
  if (type.structure === "SINGLE_UNIT") fail("failed-precondition", REASONS.INVALID_STATE, `The ${type.unitLabel?.toLowerCase() ?? "unit"} of a ${type.label.toLowerCase()} cannot be removed. Archive the property instead.`);
  if (await prisma.lease.count({ where: { unitId: unit.id, status: "ACTIVE" } })) fail("failed-precondition", REASONS.INVALID_STATE, "End the active lease before archiving this unit.");
  await withProperty(property.id, async (tx) => {
    await tx.propertyUnit.update({ where: { id: unit.id }, data: { activeStatus: "ARCHIVED", availabilityStatus: "NOT_AVAILABLE", version: { increment: 1 } } });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: unit.id, field: "activeStatus", from: unit.activeStatus, to: "ARCHIVED" });
  });
  res.json({ ok: true });
}

/** PUT /api/v1/properties/:propertyId/units/:unitId/floors — duplex floor-wise details (replaces the list). */
export async function setDuplexFloors(req: Request, res: Response): Promise<void> {
  const property = await loadEditable(req);
  const type = typeOf(property);
  if (!type.floorWise) fail("failed-precondition", REASONS.INVALID_STATE, `${type.label} does not use floor-wise details.`);
  const unit = await scopedUnit(req, property.id);
  const input = parseInput(duplexFloorsSchema, req.body);
  checkVersion(unit, input.version);
  if (unit.totalFloors && input.floors.length !== unit.totalFloors) {
    fail("invalid-argument", REASONS.INVALID_INPUT, `Enter details for all ${unit.totalFloors} floors (received ${input.floors.length}).`);
  }
  const before = await prisma.duplexFloor.findMany({ where: { unitId: unit.id }, orderBy: { floorNumber: "asc" } });
  await withProperty(property.id, async (tx) => {
    await tx.duplexFloor.deleteMany({ where: { unitId: unit.id } });
    await tx.duplexFloor.createMany({ data: input.floors.map((f) => ({ ...f, unitId: unit.id })) });
    await tx.propertyUnit.update({
      where: { id: unit.id },
      data: {
        version: { increment: 1 },
        totalFloors: unit.totalFloors ?? input.floors.length,
        bedrooms: input.floors.reduce((a, f) => a + f.bedrooms, 0),
        bathrooms: input.floors.reduce((a, f) => a + f.bathrooms, 0),
        kitchenCount: input.floors.reduce((a, f) => a + f.kitchens, 0),
        livingRoomCount: input.floors.reduce((a, f) => a + f.livingRooms, 0),
        balconies: input.floors.reduce((a, f) => a + f.balconies, 0),
      },
    });
    await audit(tx, req, { propertyId: property.id, entityType: "UNIT", entityId: unit.id, action: "unit.floors", oldValue: before, newValue: input.floors });
  });
  res.json({ unit: await unitWithDetails(unit.id) });
}
