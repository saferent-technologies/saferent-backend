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

/** lower(trim(collapse spaces)) — the comparison key for names. */
export function normKey(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function placeKeys(place: PlaceRef) {
  return { nameKey: normKey(place.name), cityKey: place.kind === "LOCALITY" ? normKey(place.city) : "", stateKey: normKey(place.state) };
}

/** Properties that make up a place (MySQL comparisons are case-insensitive). */
function whereFor(place: PlaceRef): Prisma.PropertyWhereInput {
  if (place.kind === "STATE") return { state: place.name };
  if (place.kind === "CITY") return { city: place.name, ...(place.state ? { state: place.state } : {}) };
  return { locality: place.name, city: place.city ?? undefined, ...(place.state ? { state: place.state } : {}) };
}

/** Users whose approximate area is this place (deleted accounts excluded). */
function usersIn(place: PlaceRef): Prisma.UserWhereInput {
  const alive: Prisma.UserWhereInput = { accountStatus: { not: "DELETED" } };
  if (place.kind === "STATE") return { ...alive, areaState: place.name };
  if (place.kind === "CITY") return { ...alive, areaCity: place.name, ...(place.state ? { areaState: place.state } : {}) };
  return { ...alive, areaLocality: place.name, areaCity: place.city ?? undefined };
}

const SUBMITTED: Prisma.PropertyWhereInput = { activeStatus: { not: "ARCHIVED" }, publicationStatus: { not: "DRAFT" }, revisionOfId: null };
const LIVE: Prisma.PropertyWhereInput = { publicationStatus: "PUBLISHED", activeStatus: "ACTIVE", revisionOfId: null };

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Recounts one place and saves it — one row per (kind, name, city, state) key, ever:
 * updates the existing row only when something changed; skips creating a spelling variant of a place
 * that already sits at the same ~1 km point; removes the row when no property and no user is left.
 */
async function syncPlace(place: PlaceRef): Promise<void> {
  const key = locationKey(place.kind, place.name, place.city, place.state);
  const keys = placeKeys(place);
  const where = whereFor(place);
  const [propertyCount, listingCount, userCount, avg, userAvg] = await Promise.all([
    prisma.property.count({ where: { AND: [where, SUBMITTED] } }),
    prisma.property.count({ where: { AND: [where, LIVE] } }),
    prisma.user.count({ where: usersIn(place) }),
    prisma.property.aggregate({ where: { AND: [where, SUBMITTED, { latitude: { not: null } }, { longitude: { not: null } }] }, _avg: { latitude: true, longitude: true } }),
    prisma.user.aggregate({ where: { AND: [usersIn(place), { areaLatitude: { not: null } }] }, _avg: { areaLatitude: true, areaLongitude: true } }),
  ]);
  const existing = await prisma.location.findFirst({ where: { OR: [{ key }, { kind: place.kind, ...keys }] }, orderBy: { id: "asc" } });
  if (!propertyCount && !userCount) {
    if (existing) await prisma.location.delete({ where: { id: existing.id } });
    return;
  }
  // Centre: average of its listings' points, else of its users' points.
  const lat = avg._avg.latitude ?? userAvg._avg.areaLatitude;
  const lng = avg._avg.longitude ?? userAvg._avg.areaLongitude;
  const latitude = lat === null || lat === undefined ? null : Math.round(Number(lat) * 1e6) / 1e6;
  const longitude = lng === null || lng === undefined ? null : Math.round(Number(lng) * 1e6) / 1e6;

  if (existing) {
    const moved =
      (existing.latitude === null) !== (latitude === null) ||
      (latitude !== null && existing.latitude !== null && (Math.abs(Number(existing.latitude) - latitude) > 0.001 || Math.abs(Number(existing.longitude) - (longitude ?? 0)) > 0.001));
    const changed = moved || existing.listingCount !== listingCount || existing.propertyCount !== propertyCount || existing.userCount !== userCount;
    if (changed) {
      await prisma.location.update({ where: { id: existing.id }, data: { listingCount, propertyCount, userCount, ...(moved ? { latitude, longitude } : {}) } });
    }
    return;
  }
  // Spelling-variant guard: same name at the same ~1 km point → keep the older row.
  if (latitude !== null && longitude !== null) {
    const near = await prisma.location.findMany({
      where: { kind: place.kind, nameKey: keys.nameKey, latitude: { gte: round2(latitude) - 0.005, lte: round2(latitude) + 0.005 }, longitude: { gte: round2(longitude) - 0.005, lte: round2(longitude) + 0.005 } },
      select: { id: true },
      take: 1,
    });
    if (near.length) return;
  }
  try {
    await prisma.location.create({ data: { key, ...keys, kind: place.kind, name: place.name, city: place.city, state: place.state, listingCount, propertyCount, userCount, latitude, longitude } });
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err; // created meanwhile by another run
  }
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
        console.error("[locations] sync failed", { kind: place.kind }, (err as Error).message);
      }
    }
  }
}

/** Refresh the places of a property by id (after any change to it). Never throws. */
export async function syncLocationsForProperty(propertyId: string, previous?: { state?: string | null; city?: string | null; locality?: string | null }): Promise<void> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { state: true, city: true, locality: true } }).catch(() => null);
  await syncLocationsFor(p, previous);
}

/** Rebuilds the whole table from the properties and users' areas (startup + hourly). */
export async function rebuildLocations(): Promise<void> {
  const [groups, userGroups] = await Promise.all([
    prisma.property.groupBy({ by: ["state", "city", "locality"], where: SUBMITTED }),
    prisma.user.groupBy({ by: ["areaState", "areaCity", "areaLocality"], where: { accountStatus: { not: "DELETED" }, OR: [{ areaCity: { not: null } }, { areaLocality: { not: null } }] } }),
  ]);
  const keep = new Set<string>();
  const places = new Map<string, PlaceRef>();
  const addresses = [...groups, ...userGroups.map((g) => ({ state: g.areaState, city: g.areaCity, locality: g.areaLocality }))];
  for (const g of addresses) {
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
      console.error("[locations] rebuild failed", { kind: place.kind }, (err as Error).message);
    }
  }
  const stale = (await prisma.location.findMany({ select: { key: true } })).map((l) => l.key).filter((k) => !keep.has(k));
  if (stale.length) await prisma.location.deleteMany({ where: { key: { in: stale } } });
}

/**
 * Search: name prefix first, then contains (q ≥ 2 chars). Within each: listing count, user count, name.
 * Places with only users (no listings) come after the ones with listings.
 */
export async function suggestLocations(q: string, limit = 8) {
  const text = normKey(q).slice(0, 60);
  if (text.length < 2) return [];
  const order: Prisma.LocationOrderByWithRelationInput[] = [{ listingCount: "desc" }, { userCount: "desc" }, { name: "asc" }];
  const starts = await prisma.location.findMany({ where: { nameKey: { startsWith: text } }, orderBy: order, take: limit * 2 });
  const more =
    starts.length < limit
      ? await prisma.location.findMany({ where: { nameKey: { contains: text }, id: { notIn: starts.map((s) => s.id) } }, orderBy: order, take: limit * 2 })
      : [];
  const byListings = (a: { listingCount: number }, b: { listingCount: number }) => Number(b.listingCount > 0) - Number(a.listingCount > 0);
  const sorted = [...starts.sort(byListings), ...more.sort(byListings)].slice(0, limit);
  return sorted.map((l) => ({
    kind: l.kind,
    name: l.name,
    city: l.city,
    state: l.state,
    /** "Madhapur, Hyderabad" · "Hyderabad, Telangana" · "Telangana" */
    label: [l.name, l.kind === "LOCALITY" ? l.city : l.kind === "CITY" ? l.state : null].filter(Boolean).join(", "),
    listingCount: l.listingCount,
    latitude: l.latitude === null ? null : Number(l.latitude),
    longitude: l.longitude === null ? null : Number(l.longitude),
    /** Ready-made filters for GET /browse (or /public/listings). */
    filters: l.kind === "STATE" ? { state: l.name } : l.kind === "CITY" ? { city: l.name, ...(l.state ? { state: l.state } : {}) } : { locality: l.name, city: l.city, ...(l.state ? { state: l.state } : {}) },
  }));
}

/** Centre of a place by locality (+ city) or city name — for alerts set by area name only. */
export async function placeCentre(locality: string | null, city: string | null): Promise<{ latitude: number; longitude: number } | null> {
  const row = locality
    ? await prisma.location.findFirst({ where: { kind: "LOCALITY", nameKey: normKey(locality), ...(city ? { cityKey: normKey(city) } : {}), latitude: { not: null } }, orderBy: { listingCount: "desc" } })
    : city
      ? await prisma.location.findFirst({ where: { kind: "CITY", nameKey: normKey(city), latitude: { not: null } }, orderBy: { listingCount: "desc" } })
      : null;
  return row && row.latitude !== null && row.longitude !== null ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null;
}
