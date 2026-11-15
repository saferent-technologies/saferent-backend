import type { LocationKind, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Places taken from property addresses, stored separately in `locations` for search suggestions:
 * typing "h" suggests Hyderabad, Hanumakonda, Hitech City … — only places that have live listings.
 *
 * Kept fresh by syncLocationsFor() after every property change (address, publish, availability …)
 * and by rebuildLocations() hourly / at startup, so nothing depends on one path alone.
 */

/** "  hitech   city " → "Hitech City" (spaces collapsed, first letter of each word capitalised). */
export function cleanPlace(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function locationKey(kind: LocationKind, name: string, city: string | null, state: string | null): string {
  return [kind, state ?? "", kind === "LOCALITY" ? (city ?? "") : "", name].map((x) => x.trim().toLowerCase()).join("|");
}

export interface PlaceRef {
  kind: LocationKind;
  name: string;
  city: string | null;
  state: string | null;
}

/** The state, city and locality rows an address belongs to. */
export function placesOf(address: { state?: string | null; city?: string | null; locality?: string | null }): PlaceRef[] {
  const state = cleanPlace(address.state);
  const city = cleanPlace(address.city);
  const locality = cleanPlace(address.locality);
  const out: PlaceRef[] = [];
  if (state) out.push({ kind: "STATE", name: state, city: null, state: null });
  if (city) out.push({ kind: "CITY", name: city, city: null, state });
  if (locality && city && locality.toLowerCase() !== city.toLowerCase()) out.push({ kind: "LOCALITY", name: locality, city, state });
  return out;
}

/** Properties that make up a place (MySQL comparisons are case-insensitive). */
function whereFor(place: PlaceRef): Prisma.PropertyWhereInput {
  if (place.kind === "STATE") return { state: place.name };
  if (place.kind === "CITY") return { city: place.name, ...(place.state ? { state: place.state } : {}) };
  return { locality: place.name, city: place.city ?? undefined, ...(place.state ? { state: place.state } : {}) };
}

const SUBMITTED: Prisma.PropertyWhereInput = { activeStatus: { not: "ARCHIVED" }, publicationStatus: { not: "DRAFT" } };
const LIVE: Prisma.PropertyWhereInput = { publicationStatus: "PUBLISHED", activeStatus: "ACTIVE", availableCount: { gt: 0 } };

/** Recounts one place and saves it (or removes it when no property is left there). */
async function syncPlace(place: PlaceRef): Promise<void> {
  const key = locationKey(place.kind, place.name, place.city, place.state);
  const where = whereFor(place);
  const [propertyCount, listingCount, avg] = await Promise.all([
    prisma.property.count({ where: { AND: [where, SUBMITTED] } }),
    prisma.property.count({ where: { AND: [where, LIVE] } }),
    prisma.property.aggregate({ where: { AND: [where, SUBMITTED, { latitude: { not: null } }, { longitude: { not: null } }] }, _avg: { latitude: true, longitude: true } }),
  ]);
  if (!propertyCount) {
    await prisma.location.deleteMany({ where: { key } });
    return;
  }
  const data = {
    kind: place.kind,
    name: place.name,
    city: place.city,
    state: place.state,
    listingCount,
    propertyCount,
    latitude: avg._avg.latitude,
    longitude: avg._avg.longitude,
  };
  await prisma.location.upsert({ where: { key }, create: { key, ...data }, update: data });
}

/** Refresh the places of one or more addresses (e.g. the property's old and new address). Never throws. */
export async function syncLocationsFor(...addresses: Array<{ state?: string | null; city?: string | null; locality?: string | null } | null | undefined>): Promise<void> {
  const seen = new Set<string>();
  for (const address of addresses) {
    if (!address) continue;
    for (const place of placesOf(address)) {
      const key = locationKey(place.kind, place.name, place.city, place.state);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await syncPlace(place);
      } catch (err) {
        console.error("[locations] sync failed", key, err);
      }
    }
  }
}

/** Refresh the places of a property by id (after any change to it). Never throws. */
export async function syncLocationsForProperty(propertyId: string, previous?: { state?: string | null; city?: string | null; locality?: string | null }): Promise<void> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { state: true, city: true, locality: true } }).catch(() => null);
  await syncLocationsFor(p, previous);
}

/** Rebuilds the whole table from the properties (startup + hourly). */
export async function rebuildLocations(): Promise<void> {
  const groups = await prisma.property.groupBy({ by: ["state", "city", "locality"], where: SUBMITTED });
  const keep = new Set<string>();
  const places = new Map<string, PlaceRef>();
  for (const g of groups) {
    for (const place of placesOf(g)) {
      const key = locationKey(place.kind, place.name, place.city, place.state);
      keep.add(key);
      if (!places.has(key)) places.set(key, place);
    }
  }
  for (const place of places.values()) {
    try {
      await syncPlace(place);
    } catch (err) {
      console.error("[locations] rebuild failed", place.name, err);
    }
  }
  const stale = (await prisma.location.findMany({ select: { key: true } })).map((l) => l.key).filter((k) => !keep.has(k));
  if (stale.length) await prisma.location.deleteMany({ where: { key: { in: stale } } });
}

/** Search suggestions: places that start with `q` first, then places that contain it; only live ones. */
export async function suggestLocations(q: string, limit = 10) {
  const text = q.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return [];
  const live = { listingCount: { gt: 0 } };
  const order: Prisma.LocationOrderByWithRelationInput[] = [{ listingCount: "desc" }, { name: "asc" }];
  const starts = await prisma.location.findMany({ where: { ...live, name: { startsWith: text } }, orderBy: order, take: limit * 2 });
  const more =
    starts.length < limit
      ? await prisma.location.findMany({ where: { ...live, name: { contains: text }, id: { notIn: starts.map((s) => s.id) } }, orderBy: order, take: limit })
      : [];
  const rank: Record<LocationKind, number> = { CITY: 0, LOCALITY: 1, STATE: 2 };
  const sorted = [...starts.sort((a, b) => rank[a.kind] - rank[b.kind] || b.listingCount - a.listingCount), ...more].slice(0, limit);
  return sorted.map((l) => ({
    kind: l.kind,
    name: l.name,
    city: l.city,
    state: l.state,
    /** "Madhapur, Hyderabad" · "Hyderabad, Telangana" · "Telangana" */
    label: [l.name, l.kind === "LOCALITY" ? l.city : l.kind === "CITY" ? l.state : null].filter(Boolean).join(", "),
    listingCount: l.listingCount,
    /** Ready-made filters for GET /browse (or /public/listings). */
    filters: l.kind === "STATE" ? { state: l.name } : l.kind === "CITY" ? { city: l.name, ...(l.state ? { state: l.state } : {}) } : { locality: l.name, city: l.city, ...(l.state ? { state: l.state } : {}) },
  }));
}
