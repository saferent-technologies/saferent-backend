import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { propertyTypeDef } from "./catalog";

/**
 * Possible duplicates for verification: other properties whose map pin is within DUPLICATE_RADIUS_M
 * of this one. The reviewer opens them, compares, then approves or rejects as usual.
 */
export const DUPLICATE_RADIUS_M = 40;

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Lat / lng box that contains every point within `meters` (cheap index-friendly prefilter). */
export function boundingBox(lat: number, lng: number, meters: number) {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

const nearbySelect = {
  id: true,
  code: true,
  title: true,
  name: true,
  propertyTypeKey: true,
  addressLine: true,
  locality: true,
  city: true,
  state: true,
  pincode: true,
  latitude: true,
  longitude: true,
  publicationStatus: true,
  activeStatus: true,
  createdAt: true,
  owner: { select: { id: true, fullName: true, phoneNumber: true } },
  images: { where: { status: { not: "REJECTED" }, category: { not: "PANORAMA_360" } }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
} satisfies Prisma.PropertySelect;

/** Other non-archived, submitted properties within `radius` metres, closest first. */
export async function nearbyProperties(propertyId: string, radius = DUPLICATE_RADIUS_M) {
  const self = await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, ownerId: true, latitude: true, longitude: true } });
  if (!self || self.latitude === null || self.longitude === null) return { located: false, radiusMeters: radius, items: [] };
  const lat = Number(self.latitude);
  const lng = Number(self.longitude);
  const box = boundingBox(lat, lng, radius);
  const rows = await prisma.property.findMany({
    where: {
      id: { not: self.id },
      activeStatus: { not: "ARCHIVED" },
      publicationStatus: { not: "DRAFT" },
      latitude: { gte: box.minLat, lte: box.maxLat },
      longitude: { gte: box.minLng, lte: box.maxLng },
    },
    select: nearbySelect,
    take: 100,
  });
  const items = rows
    .map((p) => ({ p, distance: distanceMeters(lat, lng, Number(p.latitude), Number(p.longitude)) }))
    .filter((x) => x.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .map(({ p, distance }) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      name: p.name,
      propertyType: p.propertyTypeKey,
      propertyTypeLabel: propertyTypeDef(p.propertyTypeKey)?.label ?? p.propertyTypeKey,
      address: [p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", "),
      distanceMeters: distance,
      sameOwner: p.owner?.id === self.ownerId,
      owner: p.owner,
      publicationStatus: p.publicationStatus,
      activeStatus: p.activeStatus,
      coverImageId: p.images[0]?.id ?? null,
      createdAt: p.createdAt.toISOString(),
    }));
  return { located: true, radiusMeters: radius, items };
}
