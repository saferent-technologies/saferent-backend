import type { Request, Response } from "express";
import { videosFor } from "./videos.controller";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { storage } from "../../lib/uploads";
import { presentPublic } from "../presenters";
import { loadAggregate, propertyKey } from "../service";
import { browseProperties } from "./browse.controller";

/*
 * Public website (saferenttechnologies.com) — no login. Read-only and limited to what a signed-in
 * tenant already sees on /browse: PUBLISHED + ACTIVE listings, APPROVED photos, never the owner's
 * identity or contact details. Applying, enquiring and reporting still need a signed-in account.
 */

const PUBLIC = { publicationStatus: "PUBLISHED", activeStatus: "ACTIVE" } as const;

export const publicImageUrl = (id: string) => `/api/v1/public/images/${id}`;

/** GET /api/v1/public/listings — the same search as /browse (that summary is already public-safe). */
export const listPublicListings = browseProperties;

/** GET /api/v1/public/listings/:propertyId — listing details for visitors. */
export async function getPublicListing(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findFirst({ where: { ...propertyKey(req), ...PUBLIC }, select: { id: true } }), "Listing");
  const agg = await loadAggregate(prisma, property.id);
  const ownerVerified = (await prisma.landlordProfile.findUnique({ where: { userId: agg.ownerId }, select: { kycStatus: true } }))?.kycStatus === "APPROVED";
  const { latitude: _lat, longitude: _lng, ...view } = presentPublic(agg);
  res.json({
    property: {
      ...view,
      // Visitors get the area, not the exact map pin; signed-in tenants see the full listing.
      latitude: null,
      longitude: null,
      images: view.images.map((i) => ({ ...i, url: publicImageUrl(i.id) })),
      ownerVerified,
      videos: await videosFor(property.id, true, true),
    },
  });
}

/** GET /api/v1/public/images/:imageId — only APPROVED photos of PUBLISHED, ACTIVE listings. */
export async function getPublicImage(req: Request, res: Response): Promise<void> {
  const image = await prisma.propertyImage.findUnique({
    where: { id: String(req.params.imageId) },
    select: { filePath: true, mimeType: true, status: true, inspectionId: true, property: { select: { publicationStatus: true, activeStatus: true } } },
  });
  const isPublic = !!image && image.status === "APPROVED" && !image.inspectionId && image.property.publicationStatus === PUBLIC.publicationStatus && image.property.activeStatus === PUBLIC.activeStatus;
  if (!image || !isPublic) fail("not-found", REASONS.NOT_FOUND, "Image not found.");
  // The website may be served from another origin than the API: allow <img> embedding (helmet defaults to same-origin).
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "public, max-age=3600");
  storage.send(res, image.filePath, image.mimeType);
}
