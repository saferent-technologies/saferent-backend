import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { hasRoleWhere } from "../../controllers/users.controller";
import { ID_PREFIX } from "../catalog";
import { nextCode, nextCodes } from "../ids";
import { bedCapacity } from "../bedCapacity";
import { bedAssignSchema, bedSchema, bedUpdateSchema, roomSchema, roomUpdateSchema } from "../schemas";
import { audit, checkVersion, childKey, diff, isModerator, recordStatus, scopedProperty, typeOf, withProperty } from "../service";
import { canEditContent } from "../workflow";


async function editableRoomsProperty(req: Request) {
  const property = await scopedProperty(req, "properties.manage");
  const decision = canEditContent(property, isModerator(req));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  if (typeOf(property).structure !== "ROOMS_BEDS") fail("failed-precondition", REASONS.INVALID_STATE, "Rooms and beds are only used for PG and hostel properties.");
  return property;
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

async function roomOf(req: Request, propertyId: string) {
  return found(await prisma.propertyRoom.findFirst({ where: { ...childKey(req, "roomId"), propertyId } }), "Room");
}

async function bedOf(req: Request, roomId: string) {
  return found(await prisma.propertyBed.findFirst({ where: { ...childKey(req, "bedId"), roomId } }), "Bed");
}

const roomInclude = { beds: { where: { activeStatus: { not: "ARCHIVED" as const } }, orderBy: { bedNumber: "asc" as const } } };

/** POST /api/v1/properties/:propertyId/rooms — creates the room and (by default) one bed per sharing slot. */
export async function createRoom(req: Request, res: Response): Promise<void> {
  const property = await editableRoomsProperty(req);
  const input = parseInput(roomSchema, req.body);
  const { createBeds, version: _v, ...data } = input;
  void _v;
  const capacity = bedCapacity(data);
  const beds = createBeds ?? capacity;
  if (beds > capacity) fail("invalid-argument", REASONS.INVALID_INPUT, `A ${data.sharingType.toLowerCase().replace("_", " ")} room holds at most ${capacity} beds.`);
  try {
    const room = await withProperty(property.id, async (tx) => {
      const code = await nextCode(tx, ID_PREFIX.ROOM);
      const created = await tx.propertyRoom.create({ data: { ...data, code, propertyId: property.id } });
      const bedCodes = await nextCodes(tx, ID_PREFIX.BED, beds);
      if (beds) {
        await tx.propertyBed.createMany({
          data: bedCodes.map((c, i) => ({ code: c, roomId: created.id, propertyId: property.id, bedNumber: `B${i + 1}`, availabilityStatus: data.availabilityStatus === "OCCUPIED" ? "NOT_AVAILABLE" : (data.availabilityStatus ?? "NOT_AVAILABLE") })),
        });
      }
      await audit(tx, req, { propertyId: property.id, entityType: "ROOM", entityId: created.id, action: "room.create", newValue: { code, ...data, beds } });
      return created;
    });
    res.locals.message = "Room added";
    res.status(201).json({ room: await prisma.propertyRoom.findUniqueOrThrow({ where: { id: room.id }, include: roomInclude }) });
  } catch (e) {
    if (isUnique(e)) fail("already-exists", REASONS.CONFLICT, "This room number already exists in this property.");
    throw e;
  }
}

/** GET /api/v1/properties/:propertyId/rooms */
export async function listRooms(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const rooms = await prisma.propertyRoom.findMany({ where: { propertyId: property.id, activeStatus: { not: "ARCHIVED" } }, include: roomInclude, orderBy: { roomNumber: "asc" } });
  const items = rooms.map((r) => ({
    ...r,
    capacity: bedCapacity(r),
    availableBeds: r.beds.filter((b) => b.activeStatus === "ACTIVE" && b.availabilityStatus === "AVAILABLE").length,
    occupiedBeds: r.beds.filter((b) => b.availabilityStatus === "OCCUPIED").length,
  }));
  res.json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 });
}

/** PATCH /api/v1/properties/:propertyId/rooms/:roomId */
export async function updateRoom(req: Request, res: Response): Promise<void> {
  const property = await editableRoomsProperty(req);
  const room = await roomOf(req, property.id);
  const input = parseInput(roomUpdateSchema, req.body);
  checkVersion(room, input.version);
  const { version: _v, ...data } = input;
  void _v;
  const beds = await prisma.propertyBed.count({ where: { roomId: room.id, activeStatus: { not: "ARCHIVED" } } });
  const capacity = bedCapacity({ sharingType: data.sharingType ?? room.sharingType, customSharing: data.customSharing === undefined ? room.customSharing : data.customSharing });
  if (beds > capacity) fail("invalid-argument", REASONS.INVALID_INPUT, `This room already has ${beds} beds; the sharing type allows ${capacity}. Remove beds first.`);
  if (data.activeStatus === "ARCHIVED" && (await prisma.propertyBed.count({ where: { roomId: room.id, tenantId: { not: null } } }))) {
    fail("failed-precondition", REASONS.INVALID_STATE, "Release the occupied beds before archiving this room.");
  }
  const delta = diff(room as unknown as Record<string, unknown>, data as Record<string, unknown>);
  try {
    await withProperty(property.id, async (tx) => {
      const r = await tx.propertyRoom.updateMany({ where: { id: room.id, version: room.version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) fail("already-exists", REASONS.VERSION_CONFLICT, "This room was changed by someone else. Reload and try again.");
      if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "ROOM", entityId: room.id, action: "room.update", oldValue: delta.old, newValue: delta.new });
      if (data.availabilityStatus) await recordStatus(tx, req, { propertyId: property.id, entityType: "ROOM", entityId: room.id, field: "availabilityStatus", from: room.availabilityStatus, to: data.availabilityStatus });
      if (data.activeStatus) await recordStatus(tx, req, { propertyId: property.id, entityType: "ROOM", entityId: room.id, field: "activeStatus", from: room.activeStatus, to: data.activeStatus });
    });
  } catch (e) {
    if (isUnique(e)) fail("already-exists", REASONS.CONFLICT, "This room number already exists in this property.");
    throw e;
  }
  res.json({ room: await prisma.propertyRoom.findUniqueOrThrow({ where: { id: room.id }, include: roomInclude }) });
}

/** POST /api/v1/properties/:propertyId/rooms/:roomId/beds */
export async function createBed(req: Request, res: Response): Promise<void> {
  const property = await editableRoomsProperty(req);
  const room = await roomOf(req, property.id);
  const input = parseInput(bedSchema, req.body);
  try {
    const bed = await withProperty(property.id, async (tx) => {
      const count = await tx.propertyBed.count({ where: { roomId: room.id, activeStatus: { not: "ARCHIVED" } } });
      if (count >= bedCapacity(room)) fail("failed-precondition", REASONS.INVALID_STATE, `Room ${room.roomNumber} already has ${count} of ${bedCapacity(room)} beds.`);
      const code = await nextCode(tx, ID_PREFIX.BED);
      const created = await tx.propertyBed.create({ data: { code, roomId: room.id, propertyId: property.id, bedNumber: input.bedNumber, rent: input.rent ?? null, availabilityStatus: input.availabilityStatus ?? "NOT_AVAILABLE" } });
      await audit(tx, req, { propertyId: property.id, entityType: "BED", entityId: created.id, action: "bed.create", newValue: { code, ...input } });
      return created;
    });
    res.status(201).json({ bed });
  } catch (e) {
    if (isUnique(e)) fail("already-exists", REASONS.CONFLICT, "This bed number already exists in the room.");
    throw e;
  }
}

/** PATCH /api/v1/properties/:propertyId/rooms/:roomId/beds/:bedId — OCCUPIED is only set by assignment. */
export async function updateBed(req: Request, res: Response): Promise<void> {
  const property = await editableRoomsProperty(req);
  const room = await roomOf(req, property.id);
  const bed = await bedOf(req, room.id);
  const input = parseInput(bedUpdateSchema, req.body);
  checkVersion(bed, input.version);
  const { version: _v, ...data } = input;
  void _v;
  if (bed.tenantId && (data.availabilityStatus || data.activeStatus === "ARCHIVED")) fail("failed-precondition", REASONS.INVALID_STATE, "This bed is occupied. Release the tenant first.");
  const delta = diff(bed as unknown as Record<string, unknown>, data as Record<string, unknown>);
  try {
    await withProperty(property.id, async (tx) => {
      const r = await tx.propertyBed.updateMany({ where: { id: bed.id, version: bed.version }, data: { ...data, version: { increment: 1 } } });
      if (r.count === 0) fail("already-exists", REASONS.VERSION_CONFLICT, "This bed was changed by someone else. Reload and try again.");
      if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "BED", entityId: bed.id, action: "bed.update", oldValue: delta.old, newValue: delta.new });
      if (data.availabilityStatus) await recordStatus(tx, req, { propertyId: property.id, entityType: "BED", entityId: bed.id, field: "availabilityStatus", from: bed.availabilityStatus, to: data.availabilityStatus });
    });
  } catch (e) {
    if (isUnique(e)) fail("already-exists", REASONS.CONFLICT, "This bed number already exists in the room.");
    throw e;
  }
  res.json({ bed: await prisma.propertyBed.findUniqueOrThrow({ where: { id: bed.id } }) });
}

/**
 * POST /api/v1/properties/:propertyId/rooms/:roomId/beds/:bedId/assign
 * Atomic conditional update: succeeds only if the bed has no tenant, so two concurrent requests can
 * never put two active tenants on one bed.
 */
export async function assignBed(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const room = await roomOf(req, property.id);
  const bed = await bedOf(req, room.id);
  const { tenantId, leaseId } = parseInput(bedAssignSchema, req.body);
  const tenant = await prisma.user.findFirst({ where: { AND: [{ id: tenantId, accountStatus: "ACTIVE" }, hasRoleWhere("TENANT")] }, select: { id: true, fullName: true } });
  if (!tenant) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose an active tenant.");
  if (leaseId) {
    const lease = await prisma.lease.count({ where: { id: leaseId, propertyId: property.id, tenantId, status: "ACTIVE" } });
    if (!lease) fail("invalid-argument", REASONS.INVALID_INPUT, "The lease does not belong to this tenant and property.");
  }
  await assignBedTx(req, property.id, bed.id, tenantId, leaseId ?? null);
  await notify(tenantId, "Bed assigned", `You were assigned bed ${bed.bedNumber} in room ${room.roomNumber}.`, "/leases");
  res.locals.message = "Bed assigned";
  res.json({ bed: await prisma.propertyBed.findUniqueOrThrow({ where: { id: bed.id } }) });
}

/** Shared by manual assignment and lease approval. Throws 409 if the bed is already taken. */
export async function assignBedTx(req: Request, propertyId: string, bedId: string, tenantId: string, leaseId: string | null, outerTx?: Prisma.TransactionClient): Promise<void> {
  const run = async (tx: Prisma.TransactionClient) => {
    const updated = await tx.propertyBed.updateMany({
      where: { id: bedId, tenantId: null, activeStatus: "ACTIVE", availabilityStatus: { in: ["AVAILABLE", "RESERVED"] } },
      data: { tenantId, leaseId, occupiedSince: new Date(), availabilityStatus: "OCCUPIED", version: { increment: 1 } },
    });
    if (updated.count === 0) fail("already-exists", REASONS.CONFLICT, "This bed is already occupied or not available.");
    await tx.bedAssignment.create({ data: { bedId, tenantId, leaseId, createdById: req.user!.id } });
    await recordStatus(tx, req, { propertyId, entityType: "BED", entityId: bedId, field: "availabilityStatus", from: "AVAILABLE", to: "OCCUPIED" });
    await audit(tx, req, { propertyId, entityType: "BED", entityId: bedId, action: "bed.assign_tenant", newValue: { tenantId, leaseId } });
  };
  if (outerTx) await run(outerTx);
  else await withProperty(propertyId, run);
}

/** Frees a bed (manual release or lease end). */
export async function releaseBedTx(req: Request, tx: Prisma.TransactionClient, propertyId: string, bedId: string, reason: string): Promise<void> {
  const bed = await tx.propertyBed.findUniqueOrThrow({ where: { id: bedId } });
  if (!bed.tenantId) return;
  await tx.propertyBed.update({ where: { id: bedId }, data: { tenantId: null, leaseId: null, occupiedSince: null, availabilityStatus: "AVAILABLE", version: { increment: 1 } } });
  await tx.bedAssignment.updateMany({ where: { bedId, endedAt: null }, data: { endedAt: new Date() } });
  await recordStatus(tx, req, { propertyId, entityType: "BED", entityId: bedId, field: "availabilityStatus", from: "OCCUPIED", to: "AVAILABLE", reason });
  await audit(tx, req, { propertyId, entityType: "BED", entityId: bedId, action: "bed.release_tenant", oldValue: { tenantId: bed.tenantId, leaseId: bed.leaseId }, newValue: { reason } });
}

/** POST /api/v1/properties/:propertyId/rooms/:roomId/beds/:bedId/release */
export async function releaseBed(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const room = await roomOf(req, property.id);
  const bed = await bedOf(req, room.id);
  if (!bed.tenantId) fail("failed-precondition", REASONS.INVALID_STATE, "This bed is not occupied.");
  if (bed.leaseId && (await prisma.lease.count({ where: { id: bed.leaseId, status: "ACTIVE" } }))) fail("failed-precondition", REASONS.INVALID_STATE, "End the tenant's lease to release this bed.");
  await withProperty(property.id, (tx) => releaseBedTx(req, tx, property.id, bed.id, "Released by landlord."));
  res.json({ bed: await prisma.propertyBed.findUniqueOrThrow({ where: { id: bed.id } }) });
}
