/**
 * Property data access shared by the property controllers: scoped loading (ownership / assignment
 * checks), audit trail, status history, optimistic concurrency and the backend-calculated aggregates
 * (completeness score, rent range, available / occupied counts).
 */
import { randomUUID } from "node:crypto";
import { Prisma, type Property } from "@prisma/client";
import type { Request } from "express";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { found } from "../lib/http";
import { prisma } from "../lib/prisma";
import { can, me } from "../middleware/auth";
import { and, propertyWhere } from "../rbac/access";
import type { PermissionKey } from "../rbac/catalog";
import { hasPermission } from "../rbac/policy";
import { DEFAULT_COMPLETENESS_WEIGHTS, propertyTypeDef, type CompletenessWeights, type PropertyTypeDef } from "./catalog";
import { computeCompleteness, parseWeights, type CompletenessInput } from "./completeness";
import { flatValues } from "./fields";
import { sanitize } from "./diff";

export { diff, sanitize } from "./diff";

export type Tx = Prisma.TransactionClient;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^SR-[A-Z]+-\d{6,}$/;

/** :propertyId accepts the internal UUID or the readable code (SR-PROP-000001). */
export function propertyKey(req: Request, name = "propertyId"): Prisma.PropertyWhereInput {
  const raw = String(req.params[name] ?? "");
  if (UUID.test(raw)) return { id: raw };
  if (CODE.test(raw)) return { code: raw };
  fail("not-found", REASONS.NOT_FOUND, "Property not found.");
}

export function childKey(req: Request, name: string): { id: string } | { code: string } {
  const raw = String(req.params[name] ?? "");
  if (UUID.test(raw)) return { id: raw };
  if (CODE.test(raw)) return { code: raw };
  fail("not-found", REASONS.NOT_FOUND, "Not found.");
}

/**
 * Loads a property only if it is inside the caller's scope for `permission` (landlord: own,
 * manager / agent: assigned, staff: all). Out-of-scope records return 404 so ids cannot be probed (IDOR).
 */
export async function scopedProperty(req: Request, permission: PermissionKey, where: Prisma.PropertyWhereInput = propertyKey(req)): Promise<Property> {
  const scope = propertyWhere(me(req), permission);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to access this property.");
  return found(await prisma.property.findFirst({ where: and(scope, where) }), "Property");
}

export async function inScope(req: Request, permission: PermissionKey, propertyId: string): Promise<boolean> {
  const scope = propertyWhere(me(req), permission);
  if (!scope) return false;
  return (await prisma.property.count({ where: and(scope, { id: propertyId }) })) > 0;
}

/** Moderators verify listings (listings.approve). */
export const isModerator = (req: Request) => can(req, "listings.approve");
/** Admin-level property access (properties.manage with ALL scope). */
export const isPropertyAdmin = (req: Request) => !!req.user && hasPermission(req.user.permissions, "properties.manage", "ALL");

export function typeOf(property: Pick<Property, "propertyTypeKey">): PropertyTypeDef {
  const t = propertyTypeDef(property.propertyTypeKey);
  if (!t) fail("failed-precondition", REASONS.INVALID_STATE, "This property type is no longer supported.");
  return t;
}

/** Optimistic concurrency: reject the update if the client edited an older version. */
export function checkVersion(current: { version: number }, sent: number | undefined): void {
  if (sent !== undefined && sent !== current.version) {
    fail("already-exists", REASONS.VERSION_CONFLICT, "This record was changed by someone else. Reload and try again.", { currentVersion: current.version });
  }
}

/**
 * Conditional update that also bumps `version`. Two concurrent writers holding the same version cannot
 * both succeed: the second one updates 0 rows and gets a 409.
 */
export async function updateWithVersion(tx: Tx, id: string, version: number, data: Prisma.PropertyUncheckedUpdateManyInput): Promise<void> {
  const res = await tx.property.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  if (res.count === 0) fail("already-exists", REASONS.VERSION_CONFLICT, "This property was changed by someone else. Reload and try again.");
}

// ───── Audit trail ─────

export interface AuditInput {
  propertyId: string | null;
  entityType: "PROPERTY" | "UNIT" | "ROOM" | "BED" | "UTILITY" | "POLICY" | "AMENITY" | "PRICING" | "DOCUMENT" | "IMAGE" | "INSPECTION" | "ASSIGNMENT" | "LEASE" | "INVITATION";
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Append-only property audit log entry (never contains passwords, OTPs or tokens). */
export async function audit(tx: Tx, req: Request, entry: AuditInput): Promise<void> {
  const user = req.user;
  await tx.propertyAuditLog.create({
    data: {
      eventId: randomUUID(),
      propertyId: entry.propertyId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      oldValue: sanitize(entry.oldValue),
      newValue: sanitize(entry.newValue),
      performedById: user?.id ?? null,
      actorRole: user ? user.roles.join(",").slice(0, 32) : null,
      sourcePlatform: req.platform ?? "BACKEND",
      requestId: req.requestId ?? null,
    },
  });
}

export async function recordStatus(
  tx: Tx,
  req: Request,
  e: { propertyId: string; entityType: "PROPERTY" | "UNIT" | "ROOM" | "BED"; entityId: string; field: string; from: string | null; to: string; reason?: string | null },
): Promise<void> {
  if (e.from === e.to) return;
  await tx.propertyStatusHistory.create({
    data: { propertyId: e.propertyId, entityType: e.entityType, entityId: e.entityId, field: e.field, fromValue: e.from, toValue: e.to, reason: e.reason ?? null, actorId: req.user?.id ?? null },
  });
  await audit(tx, req, { propertyId: e.propertyId, entityType: e.entityType, entityId: e.entityId, action: `status.${e.field}`, oldValue: { [e.field]: e.from }, newValue: { [e.field]: e.to, reason: e.reason ?? null } });
}

// ───── Aggregate (full property) ─────

export const aggregateInclude = {
  owner: { select: { id: true, fullName: true } },
  units: { where: { activeStatus: { not: "ARCHIVED" } }, include: { floors: { orderBy: { floorNumber: "asc" } } }, orderBy: [{ floorNumber: "asc" }, { unitNumber: "asc" }] },
  rooms: { where: { activeStatus: { not: "ARCHIVED" } }, include: { beds: { where: { activeStatus: { not: "ARCHIVED" } }, orderBy: { bedNumber: "asc" } } }, orderBy: { roomNumber: "asc" } },
  utilities: true,
  policy: true,
  amenities: { orderBy: { label: "asc" } },
  pricing: { include: { charges: { orderBy: { kind: "asc" } } } },
  images: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, unitId: true, roomId: true, inspectionId: true, category: true, slot: true, displayOrder: true, status: true, createdAt: true } },
  documents: { orderBy: { createdAt: "desc" }, select: { id: true, code: true, unitId: true, docType: true, originalName: true, status: true, verifiedAt: true, rejectionReason: true, createdAt: true } },
  assignments: { include: { user: { select: { id: true, fullName: true, role: true } } } },
} satisfies Prisma.PropertyInclude;

export type PropertyAggregate = Prisma.PropertyGetPayload<{ include: typeof aggregateInclude }>;

export async function loadAggregate(db: Tx | typeof prisma, id: string): Promise<PropertyAggregate> {
  return db.property.findUniqueOrThrow({ where: { id }, include: aggregateInclude });
}

export function completenessInput(p: PropertyAggregate): CompletenessInput {
  const type = typeOf(p);
  const propertyUtility = p.utilities.find((u) => u.scopeKey === "PROPERTY") ?? null;
  return {
    type,
    listingType: p.listingType,
    property: p,
    building: flatValues({ name: p.name, totalFloors: p.totalFloors, totalUnits: p.totalUnits, attributes: p.attributes }),
    imageCount: p.images.filter((i) => i.status !== "REJECTED" && !i.inspectionId).length,
    units: p.units.map((u) => ({ id: u.id, values: flatValues(u as unknown as Record<string, unknown>), floorCount: u.floors.length })),
    rooms: p.rooms.map((r) => ({ bedCount: r.beds.length, rentPerBed: r.rentPerBed, securityDeposit: r.securityDeposit })),
    bedsWithRent: p.rooms.reduce((n, r) => n + r.beds.filter((b) => b.rent !== null).length, 0),
    utility: propertyUtility as unknown as Record<string, unknown> | null,
    policy: p.policy as unknown as Record<string, unknown> | null,
    amenityCount: p.amenities.filter((a) => a.status !== "NOT_DISCLOSED").length,
    pricing: p.pricing.map((pr) => ({ unitId: pr.unitId, values: pr as unknown as Record<string, unknown>, charges: pr.charges })),
    documents: p.documents,
  };
}

let weightsCache: { at: number; weights: CompletenessWeights } | null = null;

export async function completenessWeights(): Promise<CompletenessWeights> {
  if (weightsCache && Date.now() - weightsCache.at < 60_000) return weightsCache.weights;
  const row = await prisma.platformSetting.findUnique({ where: { key: "completeness_weights" } });
  let weights: CompletenessWeights = { ...DEFAULT_COMPLETENESS_WEIGHTS };
  if (row) {
    try {
      weights = parseWeights(JSON.parse(row.value));
    } catch {
      weights = { ...DEFAULT_COMPLETENESS_WEIGHTS };
    }
  }
  weightsCache = { at: Date.now(), weights };
  return weights;
}

export function invalidateWeights(): void {
  weightsCache = null;
}

const toNum = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * Recalculates the stored aggregates after any change. Available counts always come from the actual
 * unit / bed records, never from the declared totals.
 */
export async function refreshAggregates(tx: Tx, propertyId: string): Promise<PropertyAggregate> {
  const p = await loadAggregate(tx, propertyId);
  const type = typeOf(p);
  const result = computeCompleteness(completenessInput(p), await completenessWeights());

  const rents: number[] = [];
  const propertyPricing = p.pricing.find((x) => x.scopeKey === "PROPERTY");
  let available = 0;
  let occupied = 0;
  if (type.structure === "ROOMS_BEDS") {
    for (const room of p.rooms) {
      if (room.activeStatus !== "ACTIVE") continue;
      for (const bed of room.beds) {
        if (bed.activeStatus !== "ACTIVE") continue;
        const rent = toNum(bed.rent) ?? toNum(room.rentPerBed);
        if (rent !== null) rents.push(rent);
        if (bed.availabilityStatus === "AVAILABLE") available++;
        if (bed.availabilityStatus === "OCCUPIED") occupied++;
      }
    }
  } else {
    for (const unit of p.units) {
      if (unit.activeStatus !== "ACTIVE") continue;
      const unitRent = toNum(p.pricing.find((x) => x.unitId === unit.id)?.monthlyRent) ?? toNum(propertyPricing?.monthlyRent);
      if (unitRent !== null) rents.push(unitRent);
      if (unit.availabilityStatus === "AVAILABLE") available++;
      if (unit.availabilityStatus === "OCCUPIED") occupied++;
    }
  }
  if (rents.length === 0 && toNum(propertyPricing?.monthlyRent) !== null) rents.push(toNum(propertyPricing?.monthlyRent)!);

  await tx.property.update({
    where: { id: propertyId },
    data: {
      completenessScore: result.score,
      rentFrom: rents.length ? Math.min(...rents).toFixed(2) : null,
      rentTo: rents.length ? Math.max(...rents).toFixed(2) : null,
      availableCount: available,
      occupiedCount: occupied,
    },
  });
  return p;
}

/** Runs `fn` in a transaction and refreshes the aggregates of the property before committing. */
export async function withProperty<T>(propertyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const out = await fn(tx);
      await refreshAggregates(tx, propertyId);
      return out;
    },
    { timeout: 20_000 },
  );
}
