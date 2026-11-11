import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { found, paged, pagination } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { presentPublic, propertySummary } from "../presenters";
import { browseQuery } from "../schemas";
import { loadAggregate, propertyKey } from "../service";

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
  const [items, total] = await Promise.all([
    prisma.property.findMany({ where, orderBy, skip: p.skip, take: p.take, include: { images: { where: { status: "APPROVED", inspectionId: null }, select: { id: true, status: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], take: 1 } } }),
    prisma.property.count({ where }),
  ]);
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
