import { Prisma, type Property, type PropertyRevision } from "@prisma/client";
import type { Request } from "express";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { me } from "../middleware/auth";
import { computeCompleteness, submissionProblems } from "./completeness";
import { presentProperty } from "./presenters";
import { completenessInput, completenessWeights, isModerator, loadAggregate, refreshAggregates, scopedProperty, type Tx } from "./service";
import { canEditContent } from "./workflow";
import { rememberDraft } from "./draftIds";

/**
 * Change requests for APPROVED / PUBLISHED properties.
 *
 * The live listing never changes while the owner edits it. The first edit makes a hidden working copy
 * of the property (a `properties` row with revision_of_id = live id, status DRAFT + ARCHIVED, so no
 * list, search or count ever shows it) with copies of its units, floors, rooms, beds, pricing, charges,
 * utilities, rules, amenities and photos (copied rows keep source_id = the live row). Every existing
 * wizard endpoint then writes to that copy — same validation, same responses. Submitting sends it to
 * SafeRent; approving merges the copy into the live rows in one transaction (live ids are kept, so
 * leases, applications and links stay valid); rejecting keeps the copy for another round; discarding
 * deletes it. Documents are not part of a change: they stay on the live property (private, verified
 * one by one).
 */

export const OPEN_REVISION = ["DRAFT", "PENDING_VERIFICATION", "REJECTED"] as const;
const PROPERTY_SCOPE = "PROPERTY";

/** Live properties whose content edits go through a change request. */
export function needsRevision(p: Pick<Property, "publicationStatus">): boolean {
  return p.publicationStatus === "APPROVED" || p.publicationStatus === "PUBLISHED";
}

/** The revision that still has a working copy (DRAFT, PENDING_VERIFICATION or REJECTED), if any. */
export async function openRevision(db: Tx | typeof prisma, propertyId: string): Promise<PropertyRevision | null> {
  return db.propertyRevision.findFirst({ where: { propertyId, status: { in: [...OPEN_REVISION] }, draftPropertyId: { not: null } }, orderBy: { createdAt: "desc" } });
}

const draftCode = (code: string) => `${code}-D`.slice(0, 20);
const jsonOrNull = (v: Prisma.JsonValue | null | undefined) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/** Copies the live property and its listing content into a new hidden working copy. */
async function cloneToDraft(tx: Tx, liveId: string): Promise<Property> {
  const full = await tx.property.findUniqueOrThrow({
    where: { id: liveId },
    include: {
      units: { include: { floors: true } },
      rooms: { include: { beds: true } },
      utilities: true,
      policy: true,
      amenities: true,
      pricing: { include: { charges: true } },
      images: { where: { inspectionId: null } },
    },
  });
  const { id, code, createdAt: _c, updatedAt: _u, units, rooms, utilities, policy, amenities, pricing, images, attributes, ...scalars } = full;
  void _c;
  void _u;
  const draft = await tx.property.create({
    data: { ...scalars, attributes: jsonOrNull(attributes), code: draftCode(code), publicationStatus: "DRAFT", activeStatus: "ARCHIVED", revisionOfId: id } as Prisma.PropertyUncheckedCreateInput,
  });
  rememberDraft(draft.id, id);

  const unitMap = new Map<string, string>();
  for (const u of units) {
    const { id: uid, code: ucode, propertyId: _p, floors, createdAt: _a, updatedAt: _b, sourceId: _s, attributes: ua, ...rest } = u;
    void _p, void _a, void _b, void _s;
    const c = await tx.propertyUnit.create({ data: { ...rest, attributes: jsonOrNull(ua), code: draftCode(ucode), propertyId: draft.id, sourceId: uid } });
    unitMap.set(uid, c.id);
    if (floors.length) await tx.duplexFloor.createMany({ data: floors.map(({ id: _f, unitId: _x, ...f }) => ({ ...f, unitId: c.id })) });
  }
  const roomMap = new Map<string, string>();
  for (const r of rooms) {
    const { id: rid, code: rcode, propertyId: _p, beds, createdAt: _a, updatedAt: _b, sourceId: _s, ...rest } = r;
    void _p, void _a, void _b, void _s;
    const c = await tx.propertyRoom.create({ data: { ...rest, code: draftCode(rcode), propertyId: draft.id, sourceId: rid } });
    roomMap.set(rid, c.id);
    for (const b of beds) {
      const { id: bid, code: bcode, roomId: _r, propertyId: _bp, leaseId: _l, createdAt: _ba, updatedAt: _bb, sourceId: _bs, ...brest } = b;
      void _r, void _bp, void _l, void _ba, void _bb, void _bs;
      // The tenant is kept so "occupied" checks still work in the copy; the lease link stays on the live bed.
      await tx.propertyBed.create({ data: { ...brest, code: draftCode(bcode), roomId: c.id, propertyId: draft.id, leaseId: null, sourceId: bid } });
    }
  }
  const imageMap = new Map<string, string>();
  for (const img of images) {
    const { id: iid, propertyId: _p, unitId, roomId, sourceId: _s, createdAt, ...rest } = img;
    void _p, void _s;
    const c = await tx.propertyImage.create({
      data: { ...rest, createdAt, propertyId: draft.id, unitId: unitId ? (unitMap.get(unitId) ?? null) : null, roomId: roomId ? (roomMap.get(roomId) ?? null) : null, sourceId: iid },
    });
    imageMap.set(iid, c.id);
  }
  const scopeOf = (scopeKey: string, unitId: string | null) => (unitId ? unitMap.get(unitId) : scopeKey === PROPERTY_SCOPE ? PROPERTY_SCOPE : roomMap.get(scopeKey));
  for (const u of utilities) {
    const { id: _i, propertyId: _p, unitId, scopeKey, updatedAt: _a, meterReadingImageId, ...rest } = u;
    void _i, void _p, void _a;
    const key = scopeOf(scopeKey, unitId);
    if (!key) continue;
    await tx.propertyUtility.create({ data: { ...rest, propertyId: draft.id, scopeKey: key, unitId: unitId ? unitMap.get(unitId)! : null, meterReadingImageId: meterReadingImageId ? (imageMap.get(meterReadingImageId) ?? null) : null } });
  }
  if (policy) {
    const { propertyId: _p, updatedAt: _a, additionalRules, ...rest } = policy;
    void _p, void _a;
    await tx.propertyPolicy.create({ data: { ...rest, additionalRules: jsonOrNull(additionalRules), propertyId: draft.id } });
  }
  for (const a of amenities) {
    const { id: _i, propertyId: _p, unitId, scopeKey, ...rest } = a;
    void _i, void _p;
    const key = scopeOf(scopeKey, unitId);
    if (!key) continue;
    await tx.propertyAmenity.create({ data: { ...rest, propertyId: draft.id, scopeKey: key, unitId: unitId ? unitMap.get(unitId)! : null } });
  }
  for (const pr of pricing) {
    const { id: _i, propertyId: _p, unitId, scopeKey, updatedAt: _a, charges, ...rest } = pr;
    void _i, void _p, void _a;
    const key = scopeOf(scopeKey, unitId);
    if (!key) continue;
    const c = await tx.propertyPricing.create({ data: { ...rest, propertyId: draft.id, scopeKey: key, unitId: unitId ? unitMap.get(unitId)! : null } });
    if (charges.length) await tx.pricingCharge.createMany({ data: charges.map(({ id: _x, pricingId: _y, ...ch }) => ({ ...ch, pricingId: c.id })) });
  }
  return draft;
}

/**
 * The property a wizard write should change: the live one for drafts / rejected listings, or the
 * working copy of its change request for APPROVED / PUBLISHED listings (created on the first edit).
 * Writes while the change is being verified → 412.
 */
export async function editTarget(req: Request): Promise<Property> {
  const live = await scopedProperty(req, "properties.manage");
  const decision = canEditContent(live, isModerator(req));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  if (!needsRevision(live)) return live;
  return prisma.$transaction(
    async (tx) => {
      // One working copy per property, even with parallel first edits.
      await tx.$queryRaw`SELECT id FROM properties WHERE id = ${live.id} FOR UPDATE`;
      const rev = await openRevision(tx, live.id);
      if (rev?.status === "PENDING_VERIFICATION") fail("failed-precondition", REASONS.INVALID_STATE, "Your changes are being verified. You can edit again after SafeRent reviews them.");
      if (rev) {
        if (rev.status === "REJECTED") await tx.propertyRevision.update({ where: { id: rev.id }, data: { status: "DRAFT", version: { increment: 1 } } });
        return tx.property.findUniqueOrThrow({ where: { id: rev.draftPropertyId! } });
      }
      const draft = await cloneToDraft(tx, live.id);
      await tx.propertyRevision.create({ data: { propertyId: live.id, landlordId: live.ownerId, draftPropertyId: draft.id, createdById: me(req).id } });
      await refreshAggregates(tx, draft.id);
      return draft;
    },
    { timeout: 30_000 },
  );
}

/** Units / beds whose active leases matter for a (possibly copied) row: the row and its live source. */
export function leaseRowIds(row: { id: string; sourceId?: string | null }): string[] {
  return row.sourceId ? [row.id, row.sourceId] : [row.id];
}

// ───── Views ─────

/** Property response for the wizard: the working copy's content under the live identity and status. */
export async function draftView(live: Property, draftId: string) {
  const agg = await loadAggregate(prisma, draftId);
  const view = presentProperty(agg, computeCompleteness(completenessInput(agg), await completenessWeights()));
  return {
    ...view,
    id: live.id,
    code: live.code,
    publicationStatus: live.publicationStatus,
    verificationStatus: live.verificationStatus,
    activeStatus: live.activeStatus,
    publishedAt: live.publishedAt,
    submittedAt: live.submittedAt,
    isDraftView: true,
  };
}

export function revisionSummary(rev: PropertyRevision | null) {
  if (!rev) return null;
  return {
    id: rev.id,
    status: rev.status,
    changedSections: (rev.changedSections as string[] | null) ?? [],
    createdAt: rev.createdAt,
    submittedAt: rev.submittedAt,
    decidedAt: rev.decidedAt,
    moderationNote: rev.moderationNote,
  };
}

// ───── What changed ─────

const IGNORE = new Set(["id", "code", "propertyId", "sourceId", "version", "createdAt", "updatedAt", "unitId", "roomId", "scopeKey", "pricingId", "reviewedById", "uploadedById", "filePath", "mimeType", "url", "imageIds", "status", "availableBeds", "occupiedBeds", "tenantId", "leaseId", "occupiedSince", "meterReadingImageId"]);
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) if (!IGNORE.has(k)) out[k] = strip(x);
    return out;
  }
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object") return String(v);
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

/** Sections of the listing that differ between the live property and the working copy. */
export async function changedSectionsOf(liveId: string, draftId: string): Promise<string[]> {
  const [live, draft] = await Promise.all([loadAggregate(prisma, liveId), loadAggregate(prisma, draftId)]);
  const pick = (p: typeof live, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (p as unknown as Record<string, unknown>)[k]]));
  const origin = (rows: Array<{ id: string; sourceId?: string | null }>) => rows.map((r) => r.sourceId ?? r.id);
  const unitPricing = (p: typeof live) => p.pricing.filter((x) => x.scopeKey !== PROPERTY_SCOPE).map((x) => ({ ...x, unit: p.units.find((u) => u.id === x.unitId)?.unitNumber }));
  const photoRows = async (propertyId: string) =>
    (await prisma.propertyImage.findMany({ where: { propertyId, inspectionId: null }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, sourceId: true, category: true, slot: true, displayOrder: true } })).map((i) => ({
      origin: propertyId === draftId ? (i.sourceId ?? `new:${i.id}`) : i.id,
      category: i.category,
      slot: i.slot,
      order: i.displayOrder,
    }));
  const [livePhotos, draftPhotos] = await Promise.all([photoRows(liveId), photoRows(draftId)]);
  const sections: Array<[string, boolean]> = [
    ["basic", !same(pick(live, ["title", "description", "listingType"]), pick(draft, ["title", "description", "listingType"]))],
    ["location", !same(pick(live, ["addressLine", "locality", "city", "state", "pincode", "country", "latitude", "longitude"]), pick(draft, ["addressLine", "locality", "city", "state", "pincode", "country", "latitude", "longitude"]))],
    ["building", !same(pick(live, ["name", "totalFloors", "totalUnits", "attributes"]), pick(draft, ["name", "totalFloors", "totalUnits", "attributes"]))],
    ["units", !same(live.units, draft.units) || JSON.stringify(live.units.map((u) => u.id)) !== JSON.stringify(origin(draft.units))],
    ["rooms", !same(live.rooms, draft.rooms) || JSON.stringify(live.rooms.map((r) => r.id)) !== JSON.stringify(origin(draft.rooms))],
    ["pricing", !same(live.pricing.filter((x) => x.scopeKey === PROPERTY_SCOPE), draft.pricing.filter((x) => x.scopeKey === PROPERTY_SCOPE)) || !same(unitPricing(live), unitPricing(draft))],
    ["utilities", !same(live.utilities, draft.utilities)],
    ["policies", !same(live.policy, draft.policy)],
    ["amenities", !same(live.amenities, draft.amenities)],
    ["photos", JSON.stringify(livePhotos) !== JSON.stringify(draftPhotos)],
  ];
  return sections.filter(([, changed]) => changed).map(([k]) => k);
}

/** Submission problems of the working copy (same rules as the first submission). */
export async function draftProblems(draftId: string): Promise<string[]> {
  return submissionProblems(completenessInput(await loadAggregate(prisma, draftId)));
}

// ───── Merge (approval) ─────

/** Applies the working copy to the live rows. Live ids are kept; leases are never touched. */
export async function mergeDraft(tx: Tx, liveId: string, draftId: string, reviewerId: string): Promise<{ removedFiles: string[] }> {
  const live = await tx.property.findUniqueOrThrow({ where: { id: liveId } });
  const draft = await tx.property.findUniqueOrThrow({ where: { id: draftId } });

  // 1. Property fields.
  await tx.property.update({
    where: { id: liveId },
    data: {
      listingType: draft.listingType,
      title: draft.title,
      description: draft.description,
      name: draft.name,
      addressLine: draft.addressLine,
      locality: draft.locality,
      city: draft.city,
      state: draft.state,
      country: draft.country,
      pincode: draft.pincode,
      latitude: draft.latitude,
      longitude: draft.longitude,
      totalFloors: draft.totalFloors,
      totalUnits: draft.totalUnits,
      attributes: jsonOrNull(draft.attributes),
      version: { increment: 1 },
    },
  });
  void live;

  const activeUnitLease = (unitId: string) => tx.lease.count({ where: { unitId, status: "ACTIVE" } });

  // 2. Units (+ duplex floors).
  const dUnits = await tx.propertyUnit.findMany({ where: { propertyId: draftId }, include: { floors: true } });
  const lUnits = await tx.propertyUnit.findMany({ where: { propertyId: liveId } });
  const unitMap = new Map<string, string>();
  const keptUnits = new Set<string>();
  for (const d of dUnits) if (d.sourceId && lUnits.some((l) => l.id === d.sourceId)) keptUnits.add(d.sourceId);
  const newUnitNumbers = new Set(dUnits.filter((d) => !d.sourceId && d.unitNumber).map((d) => d.unitNumber!.toLowerCase()));
  for (const l of lUnits) {
    if (keptUnits.has(l.id) || l.activeStatus === "ARCHIVED") {
      if (!keptUnits.has(l.id) && l.unitNumber && newUnitNumbers.has(l.unitNumber.toLowerCase())) await tx.propertyUnit.update({ where: { id: l.id }, data: { unitNumber: null, name: l.name ?? l.unitNumber } });
      continue;
    }
    if (await activeUnitLease(l.id)) fail("already-exists", REASONS.CONFLICT, `${l.unitNumber ?? l.code} has an active lease and can't be removed.`);
    await tx.propertyUnit.update({ where: { id: l.id }, data: { activeStatus: "ARCHIVED", availabilityStatus: "NOT_AVAILABLE", version: { increment: 1 }, ...(l.unitNumber && newUnitNumbers.has(l.unitNumber.toLowerCase()) ? { unitNumber: null, name: l.name ?? l.unitNumber } : {}) } });
  }
  for (const d of dUnits) {
    const { id: did, code: _c, propertyId: _p, sourceId, floors, createdAt: _a, updatedAt: _b, version: _v, attributes, availabilityStatus, ...cols } = d;
    void _c, void _p, void _a, void _b, void _v;
    const l = sourceId ? lUnits.find((x) => x.id === sourceId) : undefined;
    if (l) {
      if (cols.activeStatus !== "ACTIVE" && (await activeUnitLease(l.id))) fail("already-exists", REASONS.CONFLICT, `${l.unitNumber ?? l.code} has an active lease and can't be removed.`);
      const availability = l.availabilityStatus === "OCCUPIED" || availabilityStatus === "OCCUPIED" ? l.availabilityStatus : availabilityStatus;
      await tx.propertyUnit.update({ where: { id: l.id }, data: { ...cols, attributes: jsonOrNull(attributes), availabilityStatus: availability, version: { increment: 1 } } });
      await tx.duplexFloor.deleteMany({ where: { unitId: l.id } });
      if (floors.length) await tx.duplexFloor.updateMany({ where: { unitId: did }, data: { unitId: l.id } });
      unitMap.set(did, l.id);
    } else {
      await tx.propertyUnit.update({ where: { id: did }, data: { propertyId: liveId, sourceId: null, availabilityStatus: availabilityStatus === "OCCUPIED" ? "NOT_AVAILABLE" : availabilityStatus } });
      unitMap.set(did, did);
    }
  }

  // 3. Rooms and beds.
  const dRooms = await tx.propertyRoom.findMany({ where: { propertyId: draftId }, include: { beds: true } });
  const lRooms = await tx.propertyRoom.findMany({ where: { propertyId: liveId }, include: { beds: true } });
  const roomMap = new Map<string, string>();
  const keptRooms = new Set(dRooms.map((d) => d.sourceId).filter((x): x is string => !!x && lRooms.some((l) => l.id === x)));
  const keptBeds = new Set(dRooms.flatMap((r) => r.beds.map((b) => b.sourceId)).filter((x): x is string => !!x));
  for (const l of lRooms) {
    for (const b of l.beds) {
      if (keptBeds.has(b.id) || b.activeStatus === "ARCHIVED") continue;
      if (b.tenantId) fail("already-exists", REASONS.CONFLICT, `Bed ${b.bedNumber} in room ${l.roomNumber} is occupied and can't be removed.`);
      await tx.propertyBed.update({ where: { id: b.id }, data: { activeStatus: "ARCHIVED", availabilityStatus: "NOT_AVAILABLE", version: { increment: 1 } } });
    }
    if (!keptRooms.has(l.id) && l.activeStatus !== "ARCHIVED") await tx.propertyRoom.update({ where: { id: l.id }, data: { activeStatus: "ARCHIVED", version: { increment: 1 } } });
  }
  for (const d of dRooms) {
    const { id: rid, code: _c, propertyId: _p, sourceId, beds, createdAt: _a, updatedAt: _b, version: _v, ...cols } = d;
    void _c, void _p, void _a, void _b, void _v;
    const l = sourceId ? lRooms.find((x) => x.id === sourceId) : undefined;
    if (!l) {
      await tx.propertyRoom.update({ where: { id: rid }, data: { propertyId: liveId, sourceId: null } });
      await tx.propertyBed.updateMany({ where: { roomId: rid }, data: { propertyId: liveId, sourceId: null, tenantId: null, occupiedSince: null } });
      roomMap.set(rid, rid);
      continue;
    }
    await tx.propertyRoom.update({ where: { id: l.id }, data: { ...cols, version: { increment: 1 } } });
    roomMap.set(rid, l.id);
    for (const b of beds) {
      const lb = b.sourceId ? l.beds.find((x) => x.id === b.sourceId) : undefined;
      if (lb) {
        if (b.activeStatus !== "ACTIVE" && lb.tenantId) fail("already-exists", REASONS.CONFLICT, `Bed ${lb.bedNumber} in room ${l.roomNumber} is occupied and can't be removed.`);
        const availability = lb.availabilityStatus === "OCCUPIED" || b.availabilityStatus === "OCCUPIED" ? lb.availabilityStatus : b.availabilityStatus;
        await tx.propertyBed.update({ where: { id: lb.id }, data: { bedNumber: b.bedNumber, rent: b.rent, activeStatus: b.activeStatus, availabilityStatus: availability, version: { increment: 1 } } });
      } else {
        await tx.propertyBed.update({ where: { id: b.id }, data: { roomId: l.id, propertyId: liveId, sourceId: null, tenantId: null, occupiedSince: null, availabilityStatus: b.availabilityStatus === "OCCUPIED" ? "NOT_AVAILABLE" : b.availabilityStatus } });
      }
    }
  }

  // 4. Photos.
  const dImages = await tx.propertyImage.findMany({ where: { propertyId: draftId } });
  const lImages = await tx.propertyImage.findMany({ where: { propertyId: liveId, inspectionId: null } });
  const keptImages = new Set(dImages.map((d) => d.sourceId).filter((x): x is string => !!x));
  const imageMap = new Map<string, string>();
  const removedFiles: string[] = [];
  for (const l of lImages) {
    if (keptImages.has(l.id)) continue;
    await tx.propertyImage.delete({ where: { id: l.id } });
    removedFiles.push(l.filePath);
  }
  const mapUnit = (id: string | null) => (id ? (unitMap.get(id) ?? null) : null);
  const mapRoom = (id: string | null) => (id ? (roomMap.get(id) ?? null) : null);
  for (const d of dImages) {
    const l = d.sourceId ? lImages.find((x) => x.id === d.sourceId) : undefined;
    if (l) {
      await tx.propertyImage.update({ where: { id: l.id }, data: { category: d.category, slot: d.slot, displayOrder: d.displayOrder, unitId: mapUnit(d.unitId), roomId: mapRoom(d.roomId) } });
      imageMap.set(d.id, l.id);
    } else {
      // New photos are approved together with the change.
      await tx.propertyImage.update({ where: { id: d.id }, data: { propertyId: liveId, sourceId: null, unitId: mapUnit(d.unitId), roomId: mapRoom(d.roomId), status: "APPROVED", reviewedById: reviewerId } });
      imageMap.set(d.id, d.id);
    }
  }

  // 5. Pricing (+ charges), utilities, amenities, rules: the copy's rows replace the live ones.
  const scope = (scopeKey: string, unitId: string | null) => (unitId ? unitMap.get(unitId) : scopeKey === PROPERTY_SCOPE ? scopeKey : roomMap.get(scopeKey));
  await tx.propertyPricing.deleteMany({ where: { propertyId: liveId } });
  for (const p of await tx.propertyPricing.findMany({ where: { propertyId: draftId } })) {
    const key = scope(p.scopeKey, p.unitId);
    if (key) await tx.propertyPricing.update({ where: { id: p.id }, data: { propertyId: liveId, scopeKey: key, unitId: p.unitId ? unitMap.get(p.unitId)! : null } });
  }
  await tx.propertyUtility.deleteMany({ where: { propertyId: liveId } });
  for (const u of await tx.propertyUtility.findMany({ where: { propertyId: draftId } })) {
    const key = scope(u.scopeKey, u.unitId);
    if (key)
      await tx.propertyUtility.update({
        where: { id: u.id },
        data: { propertyId: liveId, scopeKey: key, unitId: u.unitId ? unitMap.get(u.unitId)! : null, meterReadingImageId: u.meterReadingImageId ? (imageMap.get(u.meterReadingImageId) ?? null) : null },
      });
  }
  await tx.propertyAmenity.deleteMany({ where: { propertyId: liveId } });
  for (const a of await tx.propertyAmenity.findMany({ where: { propertyId: draftId } })) {
    const key = scope(a.scopeKey, a.unitId);
    if (key) await tx.propertyAmenity.update({ where: { id: a.id }, data: { propertyId: liveId, scopeKey: key, unitId: a.unitId ? unitMap.get(a.unitId)! : null } });
  }
  await tx.propertyPolicy.deleteMany({ where: { propertyId: liveId } });
  const policy = await tx.propertyPolicy.findUnique({ where: { propertyId: draftId } });
  if (policy) {
    const { propertyId: _p, updatedAt: _u, additionalRules, ...rest } = policy;
    void _p, void _u;
    await tx.propertyPolicy.create({ data: { ...rest, additionalRules: jsonOrNull(additionalRules), propertyId: liveId } });
  }

  // 6. The copy (and its now-unused copied rows) goes; aggregates are recalculated.
  await tx.property.delete({ where: { id: draftId } });
  await refreshAggregates(tx, liveId);
  return { removedFiles };
}

/** Deletes a working copy (discard). Files of photos that were only added in the change are returned. */
export async function deleteDraft(tx: Tx, draftId: string): Promise<string[]> {
  const added = await tx.propertyImage.findMany({ where: { propertyId: draftId, sourceId: null }, select: { filePath: true } });
  await tx.property.delete({ where: { id: draftId } });
  return added.map((a) => a.filePath);
}
