import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { found, paged, pagination } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { presentPublic, propertySummary } from "../presenters";
import { browseQuery } from "../schemas";
import { loadAggregate, propertyKey } from "../service";
import { suggestLocations } from "../locations";
import { boundingBox, distanceMeters } from "../nearby";
import { fail } from "../../lib/errors";
import { REASONS } from "../../config/constants";

const PUBLIC: Prisma.PropertyWhereInput = { publicationStatus: "PUBLISHED", activeStatus: "ACTIVE" };

/**
 * GET /api/v1/browse — published listings with availability search. Rent filters use the
 * backend-calculated rent range; "available" means at least one AVAILABLE unit or bed record.
 */
export async function browseProperties(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const f = parseInput(browseQuery, req.query);
  const unitFilter: Prisma.PropertyUnitWhereInput = {
    activeStatus: "ACTIVE",
    ...(f.availableOnly === "true" ? { availabilityStatus: "AVAILABLE" } : {}),
    ...(f.bedrooms !== undefined ? { bedrooms: { gte: f.bedrooms } } : {}),
    ...(f.furnishing ? { furnishing: f.furnishing } : {}),
  };
  const where: Prisma.PropertyWhereInput = {
    AND: [
      PUBLIC,
      f.city ? { city: { contains: f.city } } : {},
      f.locality ? { locality: f.locality } : {},
      f.state ? { state: f.state } : {},
      f.category ? { category: f.category } : {},
      f.propertyType ? { propertyTypeKey: f.propertyType } : {},
      f.listingType ? { listingType: f.listingType } : {},
      // Fully rented listings never appear in public search (availableCount is recalculated from the
      // unit / bed records in the same transaction that creates a lease).
      { availableCount: { gt: 0 } },
      f.minRent !== undefined ? { rentTo: { gte: f.minRent } } : {},
      f.maxRent !== undefined ? { rentFrom: { lte: f.maxRent } } : {},
      f.bedrooms !== undefined || f.furnishing ? { units: { some: unitFilter } } : {},
      p.q ? { OR: [{ title: { contains: p.q } }, { name: { contains: p.q } }, { locality: { contains: p.q } }, { city: { contains: p.q } }, { pincode: { contains: p.q } }, { code: p.q }] } : {},
    ],
  };
  const orderBy: Prisma.PropertyOrderByWithRelationInput =
    f.sort === "rent_asc" ? { rentFrom: "asc" } : f.sort === "rent_desc" ? { rentTo: "desc" } : f.sort === "completeness" ? { completenessScore: "desc" } : { publishedAt: "desc" };
  const include = { images: { where: { status: "APPROVED" as const, inspectionId: null }, select: { id: true, status: true }, orderBy: [{ displayOrder: "asc" as const }, { createdAt: "asc" as const }], take: 1 } };
  const here = f.lat !== undefined && f.lng !== undefined ? { lat: f.lat, lng: f.lng } : null;
  let items: Array<Prisma.PropertyGetPayload<{ include: typeof include }>>;
  let total: number;
  const distances = new Map<string, number>();
  if (here) {
    // Near me: listings inside the radius (box prefilter, then exact distance), paged in memory.
    const box = boundingBox(here.lat, here.lng, f.radiusKm * 1000);
    const near = await prisma.property.findMany({
      where: { AND: [where, { latitude: { gte: box.minLat, lte: box.maxLat } }, { longitude: { gte: box.minLng, lte: box.maxLng } }] },
      orderBy,
      take: 1000,
      include,
    });
    for (const x of near) distances.set(x.id, distanceMeters(here.lat, here.lng, Number(x.latitude), Number(x.longitude)) / 1000);
    const inside = near.filter((x) => (distances.get(x.id) ?? Infinity) <= f.radiusKm);
    if (f.sort === "nearest") inside.sort((a, b) => distances.get(a.id)! - distances.get(b.id)!);
    total = inside.length;
    items = inside.slice(p.skip, p.skip + p.take);
  } else {
    if (f.sort === "nearest") fail("invalid-argument", REASONS.INVALID_INPUT, "Send lat and lng to sort by distance.");
    [items, total] = await Promise.all([prisma.property.findMany({ where, orderBy, skip: p.skip, take: p.take, include }), prisma.property.count({ where })]);
  }
  // "Owner verified ✓" — only the yes/no, never who the owner is.
  const verifiedOwners = new Set(
    (await prisma.landlordProfile.findMany({ where: { userId: { in: [...new Set(items.map((x) => x.ownerId))] }, kycStatus: "APPROVED" }, select: { userId: true } })).map((o) => o.userId),
  );
  // Public summary: no owner, no internal workflow fields.
  res.json(
    paged(
      items.map((x) => {
        const s = propertySummary(x);
        return {
          id: s.id,
          code: s.code,
          title: s.title,
          name: s.name,
          category: s.category,
          propertyType: s.propertyType,
          propertyTypeLabel: s.propertyTypeLabel,
          listingType: s.listingType,
          locality: s.locality,
          city: s.city,
          state: s.state,
          rentFrom: s.rentFrom,
          rentTo: s.rentTo,
          availableCount: s.availableCount,
          completenessScore: s.completenessScore,
          verificationStatus: s.verificationStatus,
          ownerVerified: verifiedOwners.has(x.ownerId),
          coverImageId: s.coverImageId,
          publishedAt: s.publishedAt,
          /** Only with lat / lng: distance from the device in km (1 decimal). */
          distanceKm: distances.has(x.id) ? Math.round(distances.get(x.id)! * 10) / 10 : null,
        };
      }),
      total,
      p,
    ),
  );
}

/** GET /api/v1/browse/:propertyId — tenant-facing disclosure view (+ the caller's own application). */
export async function browseProperty(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findFirst({ where: { ...propertyKey(req), ...PUBLIC }, select: { id: true } }), "Listing");
  const agg = await loadAggregate(prisma, property.id);
  const myApplications = await prisma.rentalApplication.findMany({ where: { propertyId: property.id, tenantId: me(req).id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, unitId: true, bedId: true, createdAt: true }, take: 5 });
  const ownerVerified = (await prisma.landlordProfile.findUnique({ where: { userId: agg.ownerId }, select: { kycStatus: true } }))?.kycStatus === "APPROVED";
  res.json({ property: { ...presentPublic(agg), ownerVerified }, myApplications, myApplication: myApplications[0] ?? null });
}

/**
 * GET /api/v1/browse/locations?q=h (also public: GET /api/v1/public/locations?q=h)
 * Search suggestions from property addresses: cities, localities and states that have live listings.
 * [{ kind: CITY|LOCALITY|STATE, name, city, state, label, listingCount, filters }]
 * Send `filters` as query parameters to /browse to show that place's listings.
 */
export async function locationSuggestions(req: Request, res: Response): Promise<void> {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ items: await suggestLocations(q, limit) });
}
