import type { InventoryItem, InventoryPhoto, InventoryRepair, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { readFile, writeFile } from "node:fs/promises";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { stripImageMetadata } from "../../lib/imageScrub";
import { INVENTORY_SUGGESTIONS, MAX_ITEMS_PER_PROPERTY, MAX_PHOTOS_PER_ITEM, itemCreateSchema, itemUpdateSchema, repairCreateSchema, repairUpdateSchema, workingStatusAfterRepair } from "../../lib/inventory";
import { prisma } from "../../lib/prisma";
import { discardUploads, storage } from "../../lib/uploads";
import { parseInput } from "../../lib/validation";
import { can, me } from "../../middleware/auth";
import { audit, inScope, isModerator, scopedProperty, withProperty } from "../service";

/*
 * Furniture & appliance register of a property (furnished / semi-furnished): items per flat / PG room or
 * the building, with photos and repair history. Owners / managers edit; staff and the property's team see
 * everything; tenants of a live listing or with an active lease see a reduced view (no serial number,
 * purchase date, notes or repair costs). Logs carry ids and counts only.
 */

const PHOTO_URL = (id: string) => `/api/v1/files/inventory-photos/${id}`;
type Full = InventoryItem & { photos: InventoryPhoto[]; repairs: InventoryRepair[] };
const include = { photos: { orderBy: { createdAt: "asc" } }, repairs: { orderBy: { repairDate: "desc" } } } as const;

function presentRepair(r: InventoryRepair) {
  return { id: r.id, repairDate: r.repairDate.toISOString().slice(0, 10), description: r.description, cost: r.cost == null ? null : Number(r.cost), paidBy: r.paidBy, doneBy: r.doneBy, status: r.status, createdAt: r.createdAt };
}

function presentItem(i: Full, map: (id: string | null) => string | null) {
  return {
    id: i.id,
    unitId: map(i.unitId),
    roomId: map(i.roomId),
    name: i.name,
    category: i.category,
    quantity: i.quantity,
    brand: i.brand,
    model: i.model,
    purchaseDate: i.purchaseDate ? i.purchaseDate.toISOString().slice(0, 10) : null,
    condition: i.condition,
    workingStatus: i.workingStatus,
    serialNumber: i.serialNumber,
    notes: i.notes,
    displayOrder: i.displayOrder,
    photos: i.photos.map((p) => ({ id: p.id, url: PHOTO_URL(p.id) })),
    repairs: i.repairs.map(presentRepair),
    openRepairs: i.repairs.filter((r) => r.status !== "DONE").length,
    updatedAt: i.updatedAt,
  };
}

/** Tenant view: what is in the flat and whether it works. */
function presentForTenant(i: Full) {
  return {
    id: i.id,
    unitId: i.unitId,
    roomId: i.roomId,
    name: i.name,
    category: i.category,
    quantity: i.quantity,
    brand: i.brand,
    model: i.model,
    condition: i.condition,
    workingStatus: i.workingStatus,
    photos: i.photos.map((p) => ({ id: p.id, url: PHOTO_URL(p.id) })),
  };
}

/** Live ↔ change-request copy ids of flats / rooms. */
async function idMaps(liveId: string) {
  const draft = await prisma.property.findFirst({ where: { revisionOfId: liveId }, select: { id: true } });
  if (!draft) return { draftId: null as string | null, toLive: new Map<string, string>(), toDraft: new Map<string, string>() };
  const [units, rooms] = await Promise.all([
    prisma.propertyUnit.findMany({ where: { propertyId: draft.id, sourceId: { not: null } }, select: { id: true, sourceId: true } }),
    prisma.propertyRoom.findMany({ where: { propertyId: draft.id, sourceId: { not: null } }, select: { id: true, sourceId: true } }),
  ]);
  const rows = [...units, ...rooms];
  return { draftId: draft.id, toLive: new Map(rows.map((x) => [x.id, x.sourceId!])), toDraft: new Map(rows.map((x) => [x.sourceId!, x.id])) };
}

/** The live flat / room for an id sent by the app (a live id, or the id of its copy in an open change request). */
async function livePlace(liveId: string, unitId?: string | null, roomId?: string | null) {
  const { draftId, toLive } = await idMaps(liveId);
  const check = async (id: string, kind: "unit" | "room") => {
    const live = toLive.get(id) ?? id;
    const n = kind === "unit" ? await prisma.propertyUnit.count({ where: { id: live, propertyId: liveId } }) : await prisma.propertyRoom.count({ where: { id: live, propertyId: liveId } });
    if (n) return live;
    const inDraft = draftId && (kind === "unit" ? await prisma.propertyUnit.count({ where: { id, propertyId: draftId } }) : await prisma.propertyRoom.count({ where: { id, propertyId: draftId } }));
    if (inDraft) fail("failed-precondition", REASONS.INVALID_STATE, `This ${kind === "unit" ? "flat" : "room"} is new. Add its furniture after the changes are approved.`);
    fail("invalid-argument", REASONS.INVALID_INPUT, `This ${kind === "unit" ? "flat" : "room"} isn't part of this property.`);
  };
  return { unitId: unitId ? await check(unitId, "unit") : unitId === null ? null : undefined, roomId: roomId ? await check(roomId, "room") : roomId === null ? null : undefined };
}

async function activeTenant(req: Request, propertyId: string) {
  return (await prisma.lease.count({ where: { propertyId, tenantId: me(req).id, status: "ACTIVE" } })) > 0;
}

/** GET /api/v1/properties/:propertyId/inventory[?view=draft][&unitId=|&roomId=] */
export async function listInventory(req: Request, res: Response): Promise<void> {
  const where = { OR: [{ id: String(req.params.propertyId) }, { code: String(req.params.propertyId) }], revisionOfId: null } as Prisma.PropertyWhereInput;
  const property = found(await prisma.property.findFirst({ where, select: { id: true } }), "Property");
  const staff = isModerator(req) || (await inScope(req, "properties.view", property.id));
  const tenant = !staff && (await activeTenant(req, property.id));
  if (!staff && !tenant) fail("not-found", REASONS.NOT_FOUND, "Property not found.");
  const filter: Prisma.InventoryItemWhereInput = { propertyId: property.id };
  const rows = await prisma.inventoryItem.findMany({ where: filter, include, orderBy: [{ category: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }], take: MAX_ITEMS_PER_PROPERTY });
  if (tenant) {
    res.setHeader("Cache-Control", "no-store, private");
    res.json({ items: rows.map(presentForTenant), suggestions: INVENTORY_SUGGESTIONS });
    return;
  }
  const { toDraft, toLive } = await idMaps(property.id);
  const draft = req.query.view === "draft";
  const map = (id: string | null) => (id ? (draft ? (toDraft.get(id) ?? id) : id) : null);
  // Optional filter by place (live or copy id).
  const want = (id: unknown) => (typeof id === "string" && id ? (toLive.get(id) ?? id) : null);
  const unitId = want(req.query.unitId);
  const roomId = want(req.query.roomId);
  const items = rows.filter((i) => (!unitId || i.unitId === unitId) && (!roomId || i.roomId === roomId)).map((i) => presentItem(i, map));
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    items,
    summary: {
      total: items.length,
      needsRepair: items.filter((i) => i.workingStatus !== "WORKING").length,
      openRepairs: items.reduce((a, i) => a + i.openRepairs, 0),
    },
    suggestions: INVENTORY_SUGGESTIONS,
  });
}

async function itemOf(propertyId: string, itemId: string) {
  return found(await prisma.inventoryItem.findFirst({ where: { id: itemId, propertyId }, include }), "Item");
}

/** POST /api/v1/properties/:propertyId/inventory */
export async function createItem(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(itemCreateSchema, req.body ?? {});
  if ((await prisma.inventoryItem.count({ where: { propertyId: property.id } })) >= MAX_ITEMS_PER_PROPERTY) fail("failed-precondition", REASONS.INVALID_STATE, `A property can have at most ${MAX_ITEMS_PER_PROPERTY} items.`);
  const place = await livePlace(property.id, input.unitId, input.roomId);
  const item = await withProperty(property.id, async (tx) => {
    const created = await tx.inventoryItem.create({ data: { ...input, unitId: place.unitId ?? null, roomId: place.roomId ?? null, propertyId: property.id, createdById: me(req).id }, include });
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: created.id, action: "inventory.create", newValue: { category: created.category, quantity: created.quantity } });
    return created;
  });
  res.locals.message = "Item added";
  res.status(201).json({ item: presentItem(item, (id) => id) });
}

/** PATCH /api/v1/properties/:propertyId/inventory/:itemId */
export async function updateItem(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const item = await itemOf(property.id, String(req.params.itemId));
  const input = parseInput(itemUpdateSchema, req.body ?? {});
  const place = await livePlace(property.id, input.unitId, input.roomId);
  const data: Prisma.InventoryItemUncheckedUpdateInput = { ...input, unitId: place.unitId, roomId: place.roomId };
  if (data.unitId) data.roomId = null;
  if (data.roomId) data.unitId = null;
  const updated = await withProperty(property.id, async (tx) => {
    const row = await tx.inventoryItem.update({ where: { id: item.id }, data, include });
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.update", newValue: { fields: Object.keys(input) } });
    return row;
  });
  res.locals.message = "Item updated";
  res.json({ item: presentItem(updated, (id) => id) });
}

/** DELETE /api/v1/properties/:propertyId/inventory/:itemId — the item, its photos and repair history. */
export async function deleteItem(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const item = await itemOf(property.id, String(req.params.itemId));
  await withProperty(property.id, async (tx) => {
    await tx.inventoryItem.delete({ where: { id: item.id } });
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.delete", oldValue: { category: item.category, photos: item.photos.length, repairs: item.repairs.length } });
  });
  await Promise.all(item.photos.map((p) => storage.remove(p.filePath)));
  res.locals.message = "Item removed";
  res.json({ ok: true });
}

/** POST /api/v1/properties/:propertyId/inventory/:itemId/photos — multipart "files" (JPG / PNG / WebP). */
export async function uploadItemPhotos(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const property = await scopedProperty(req, "properties.manage");
    const item = await itemOf(property.id, String(req.params.itemId));
    if (!files.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one photo (field \"files\").");
    if (item.photos.length + files.length > MAX_PHOTOS_PER_ITEM) fail("invalid-argument", REASONS.INVALID_INPUT, `An item can have at most ${MAX_PHOTOS_PER_ITEM} photos.`);
    for (const f of files) {
      if (f.mimetype === "image/jpeg" || f.mimetype === "image/png") {
        const buf = await readFile(f.path);
        await writeFile(f.path, stripImageMetadata(buf, f.mimetype)).catch(() => undefined);
      }
    }
    const created = await withProperty(property.id, async (tx) => {
      const rows = [];
      for (const f of files) rows.push(await tx.inventoryPhoto.create({ data: { itemId: item.id, filePath: storage.keyFor(f), mimeType: f.mimetype, uploadedById: me(req).id } }));
      await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.photos", newValue: { count: rows.length } });
      return rows;
    });
    res.locals.message = `${created.length} photo(s) added`;
    res.status(201).json({ photos: created.map((p) => ({ id: p.id, url: PHOTO_URL(p.id) })) });
  } catch (e) {
    await discardUploads(req);
    throw e;
  }
}

/** DELETE /api/v1/properties/:propertyId/inventory/:itemId/photos/:photoId */
export async function deleteItemPhoto(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const item = await itemOf(property.id, String(req.params.itemId));
  const photo = found(item.photos.find((p) => p.id === String(req.params.photoId)), "Photo");
  await withProperty(property.id, async (tx) => {
    await tx.inventoryPhoto.delete({ where: { id: photo.id } });
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.photo_delete" });
  });
  await storage.remove(photo.filePath);
  res.json({ ok: true });
}

/** GET /api/v1/files/inventory-photos/:photoId — the team, staff, tenants of the live listing or with a lease. */
export async function getItemPhoto(req: Request, res: Response): Promise<void> {
  const photo = found(await prisma.inventoryPhoto.findUnique({ where: { id: String(req.params.photoId) }, include: { item: { select: { propertyId: true, property: { select: { publicationStatus: true, activeStatus: true } } } } } }), "Photo");
  const pid = photo.item.propertyId;
  const live = photo.item.property.publicationStatus === "PUBLISHED" && photo.item.property.activeStatus === "ACTIVE" && can(req, "properties.browse");
  const ok = live || isModerator(req) || (await inScope(req, "properties.view", pid)) || (await activeTenant(req, pid));
  if (!ok) fail("not-found", REASONS.NOT_FOUND, "Photo not found.");
  storage.send(res, photo.filePath, photo.mimeType);
}

/** POST /api/v1/properties/:propertyId/inventory/:itemId/repairs */
export async function addRepair(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const item = await itemOf(property.id, String(req.params.itemId));
  const input = parseInput(repairCreateSchema, req.body ?? {});
  const updated = await withProperty(property.id, async (tx) => {
    const r = await tx.inventoryRepair.create({ data: { ...input, itemId: item.id, createdById: me(req).id } });
    await tx.inventoryItem.update({ where: { id: item.id }, data: { workingStatus: workingStatusAfterRepair(item.workingStatus, r.status) } });
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.repair_add", newValue: { repairId: r.id, status: r.status } });
    return tx.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include });
  });
  res.locals.message = "Repair added";
  res.status(201).json({ item: presentItem(updated, (id) => id) });
}

/** PATCH /api/v1/properties/:propertyId/inventory/:itemId/repairs/:repairId */
export async function updateRepair(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const item = await itemOf(property.id, String(req.params.itemId));
  const repair = found(item.repairs.find((r) => r.id === String(req.params.repairId)), "Repair");
  const input = parseInput(repairUpdateSchema, req.body ?? {});
  const updated = await withProperty(property.id, async (tx) => {
    const r = await tx.inventoryRepair.update({ where: { id: repair.id }, data: input });
    if (input.status && input.status !== repair.status) {
      const stillOpen = await tx.inventoryRepair.count({ where: { itemId: item.id, status: { not: "DONE" } } });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { workingStatus: stillOpen ? workingStatusAfterRepair(item.workingStatus, "OPEN") : workingStatusAfterRepair(item.workingStatus, "DONE") } });
    }
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.repair_update", newValue: { repairId: r.id, fields: Object.keys(input) } });
    return tx.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include });
  });
  res.locals.message = "Repair updated";
  res.json({ item: presentItem(updated, (id) => id) });
}

/** DELETE /api/v1/properties/:propertyId/inventory/:itemId/repairs/:repairId */
export async function deleteRepair(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const item = await itemOf(property.id, String(req.params.itemId));
  const repair = found(item.repairs.find((r) => r.id === String(req.params.repairId)), "Repair");
  await withProperty(property.id, async (tx) => {
    await tx.inventoryRepair.delete({ where: { id: repair.id } });
    await audit(tx, req, { propertyId: property.id, entityType: "INVENTORY", entityId: item.id, action: "inventory.repair_delete", oldValue: { repairId: repair.id } });
  });
  res.json({ ok: true });
}

/** Tenant-facing furniture list for a live listing (browse view). */
export async function furnishingsForListing(propertyId: string) {
  const rows = await prisma.inventoryItem.findMany({ where: { propertyId }, include, orderBy: [{ category: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }], take: MAX_ITEMS_PER_PROPERTY });
  return rows.map(presentForTenant);
}

/**
 * Inspection → register: rows of a completed inspection's furniture / appliance lists that name an
 * inventory item update that item's condition (and working status when given).
 */
export async function syncInventoryFromInspection(tx: Prisma.TransactionClient, propertyId: string, rows: Array<{ inventoryItemId?: string | null; condition?: string; workingStatus?: string | null }>) {
  for (const r of rows) {
    if (!r.inventoryItemId) continue;
    const data: Prisma.InventoryItemUpdateManyMutationInput = {};
    if (r.condition && r.condition !== "NOT_INSPECTED") data.condition = r.condition as InventoryItem["condition"];
    if (r.workingStatus) data.workingStatus = r.workingStatus as InventoryItem["workingStatus"];
    if (Object.keys(data).length) await tx.inventoryItem.updateMany({ where: { id: r.inventoryItemId, propertyId }, data });
  }
}
