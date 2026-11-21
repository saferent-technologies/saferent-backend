import type { Prisma } from "@prisma/client";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { distanceMeters } from "../properties/nearby";
import { normKey } from "../properties/locations";
import { publicApiUrl } from "../lib/publicUrl";

/*
 * "Open to new homes" matching. A listing is queued (homeAlertPendingAt) when it goes live or a unit /
 * bed frees up; jobs.ts calls processHomeAlerts() which matches each queued listing against enabled
 * alerts: within radiusKm, an available unit / bed at or under maxRent, type in propertyTypes.
 * Skips the listing's landlord and tenants who already applied. One push per listing per user; at most
 * 3 a day per user, the rest go into one "N new homes near you" push (once a day). Never logs locations.
 */

const DAILY_PUSHES = 3;
const SOON_DAYS = 30;
const DAY = 86_400_000;

/** Queue a live listing for matching (inside the transaction that made it live / freed a unit). */
export async function flagHomeAlertsTx(tx: Prisma.TransactionClient, propertyId: string): Promise<void> {
  const { count } = await tx.property.updateMany({ where: { id: propertyId, revisionOfId: null }, data: { homeAlertPendingAt: new Date() } });
  if (count) runHomeAlertsSoon();
}

/**
 * Match a few seconds after the change commits (the 10-minute job is only the safety net).
 * Debounced: several flags in a row → one run.
 */
let soon: NodeJS.Timeout | null = null;
export function runHomeAlertsSoon(delayMs = 3000): void {
  if (soon) return;
  soon = setTimeout(() => {
    soon = null;
    void processHomeAlerts().catch((err) => console.error("[home-alerts] run failed", (err as Error).message));
  }, delayMs);
  soon.unref?.();
}

/** Absolute, no-login URL of a listing photo (FCM / the app can load it without a token). */
function publicPhotoUrl(imageId: string): string {
  return publicApiUrl(`/api/v1/public/images/${imageId}`);
}

type Offer = { rent: number | null; label: string };

/** Available-now (or within 30 days) units / beds with their monthly rent. */
async function offersOf(propertyId: string, typeLabel: string): Promise<Offer[]> {
  const soon = new Date(Date.now() + SOON_DAYS * DAY);
  const [units, rooms, pricing] = await Promise.all([
    prisma.propertyUnit.findMany({
      where: { propertyId, activeStatus: "ACTIVE", availabilityStatus: "AVAILABLE", OR: [{ availableFrom: null }, { availableFrom: { lte: soon } }] },
      select: { id: true, bhkType: true },
    }),
    prisma.propertyRoom.findMany({
      where: { propertyId, activeStatus: "ACTIVE", beds: { some: { activeStatus: "ACTIVE", availabilityStatus: "AVAILABLE" } } },
      select: { rentPerBed: true, sharingType: true, beds: { where: { activeStatus: "ACTIVE", availabilityStatus: "AVAILABLE" }, select: { rent: true } } },
    }),
    prisma.propertyPricing.findMany({ where: { propertyId }, select: { scopeKey: true, monthlyRent: true } }),
  ]);
  const rentOf = (scope: string) => pricing.find((p) => p.scopeKey === scope)?.monthlyRent ?? null;
  const offers: Offer[] = units.map((u) => {
    const r = rentOf(u.id) ?? rentOf("PROPERTY");
    return { rent: r === null ? null : Number(r), label: u.bhkType ?? typeLabel };
  });
  for (const room of rooms) {
    for (const b of room.beds) {
      const r = b.rent ?? room.rentPerBed;
      offers.push({ rent: r === null ? null : Number(r), label: `${room.sharingType.charAt(0)}${room.sharingType.slice(1).toLowerCase().replace(/_/g, " ")} sharing bed` });
    }
  }
  return offers;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export async function processHomeAlerts(): Promise<number> {
  const queued = await prisma.property.findMany({ where: { homeAlertPendingAt: { not: null }, revisionOfId: null }, select: { id: true, homeAlertPendingAt: true }, take: 20, orderBy: { homeAlertPendingAt: "asc" } });
  let sent = 0;
  for (const q of queued) {
    const claimed = await prisma.property.updateMany({ where: { id: q.id, homeAlertPendingAt: q.homeAlertPendingAt }, data: { homeAlertPendingAt: null } });
    if (claimed.count) sent += await matchListing(q.id);
  }
  return sent;
}

async function matchListing(propertyId: string): Promise<number> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, ownerId: true, title: true, publicationStatus: true, activeStatus: true, latitude: true, longitude: true, locality: true, city: true, propertyTypeKey: true, type: { select: { label: true } }, images: { where: { status: "APPROVED", inspectionId: null, category: { not: "PANORAMA_360" } }, orderBy: { displayOrder: "asc" }, take: 1, select: { id: true } } },
  });
  if (!p || p.publicationStatus !== "PUBLISHED" || p.activeStatus !== "ACTIVE") {
    console.info("[home-alerts] skipped, not live", { propertyId });
    return 0;
  }
  const hasPoint = p.latitude !== null && p.longitude !== null;
  const offers = await offersOf(p.id, p.type.label);
  if (!offers.length) {
    console.info("[home-alerts] skipped, nothing available", { propertyId: p.id });
    return 0;
  }
  const lat = hasPoint ? Number(p.latitude) : 0;
  const lng = hasPoint ? Number(p.longitude) : 0;

  // Bounding box for the largest radius (50 km), then exact distance per alert.
  const dLat = 50 / 111;
  const dLng = 50 / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  // Alerts near the point, or set for the same locality (or the same city when the alert has no locality).
  const localityKey = normKey(p.locality);
  const cityKey = normKey(p.city);
  const alerts = await prisma.homeAlert.findMany({
    where: {
      enabled: true,
      userId: { not: p.ownerId },
      OR: [
        ...(hasPoint ? [{ latitude: { gte: lat - dLat, lte: lat + dLat }, longitude: { gte: lng - dLng, lte: lng + dLng } }] : []),
        ...(localityKey ? [{ localityKey }] : []),
        ...(cityKey ? [{ localityKey: null, cityKey }] : []),
      ],
    },
    take: 5000,
  });
  if (!alerts.length) {
    console.info("[home-alerts] matched", { propertyId: p.id, candidates: 0, matched: 0, pushed: 0 });
    return 0;
  }
  const [applied, already, leased] = await Promise.all([
    prisma.rentalApplication.findMany({ where: { propertyId: p.id, tenantId: { in: alerts.map((a) => a.userId) } }, select: { tenantId: true } }),
    prisma.homeAlertMatch.findMany({ where: { propertyId: p.id, userId: { in: alerts.map((a) => a.userId) } }, select: { userId: true } }),
    prisma.lease.findMany({ where: { propertyId: p.id, status: "ACTIVE", tenantId: { in: alerts.map((a) => a.userId) } }, select: { tenantId: true } }),
  ]);
  const skip = new Set([...applied.map((x) => x.tenantId), ...already.map((x) => x.userId), ...leased.map((x) => x.tenantId)]);
  const where = p.locality ?? p.city ?? "your area";
  const name = p.title?.trim() || p.type.label;
  const imageUrl = p.images[0] ? publicPhotoUrl(p.images[0].id) : null;
  const since = new Date(Date.now() - DAY);
  let pushed = 0;
  let matched = 0;

  for (const a of alerts) {
    if (skip.has(a.userId)) continue;
    const types = Array.isArray(a.propertyTypes) ? (a.propertyTypes as string[]) : [];
    if (types.length && !types.includes(p.propertyTypeKey)) continue;
    // Both have a point → distance only (haversine ≤ radiusKm). Otherwise same locality / city (case-insensitive keys).
    const alertHasPoint = a.latitude !== null && a.longitude !== null;
    const inArea =
      hasPoint && alertHasPoint
        ? distanceMeters(lat, lng, Number(a.latitude), Number(a.longitude)) <= a.radiusKm * 1000
        : a.localityKey
          ? !!localityKey && a.localityKey === localityKey
          : !!a.cityKey && a.cityKey === cityKey;
    if (!inArea) continue;
    // Lowest available rent must be within maxRent (no limit when maxRent is null).
    const priced = offers.filter((o) => o.rent !== null).sort((x, y) => x.rent! - y.rent!);
    const lowest = priced[0]?.rent ?? null;
    if (a.maxRent !== null && (lowest === null || lowest > a.maxRent)) continue;
    matched++;

    const today = await prisma.homeAlertMatch.count({ where: { userId: a.userId, pushed: true, createdAt: { gte: since } } });
    const push = today < DAILY_PUSHES;
    try {
      await prisma.homeAlertMatch.create({ data: { userId: a.userId, propertyId: p.id, pushed: push } });
    } catch {
      continue; // matched already (another run)
    }
    if (push) {
      const body = `${name} in ${where}${lowest !== null ? `, ${inr(lowest)}/month` : ""}`;
      // In-app row + FCM (notification block on channel saferent_default; data: link, imageUrl, type, propertyId).
      await notify(a.userId, "New home near you", body, `/listings/${p.id}`, undefined, { type: "HOME_ALERT", propertyId: p.id }, { imageUrl });
      pushed++;
    } else {
      await sendDigest(a.userId, a.lastDigestAt);
    }
  }
  console.info("[home-alerts] matched", { propertyId: p.id, candidates: alerts.length, matched, pushed });
  return pushed;
}

/** One "N new homes near you" push a day for matches over the daily limit. */
async function sendDigest(userId: string, lastDigestAt: Date | null) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  if (lastDigestAt && lastDigestAt >= startOfDay) return;
  const claimed = await prisma.homeAlert.updateMany({ where: { userId, OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: startOfDay } }] }, data: { lastDigestAt: new Date() } });
  if (!claimed.count) return;
  const extra = await prisma.homeAlertMatch.count({ where: { userId, pushed: false, createdAt: { gte: startOfDay } } });
  const n = Math.max(1, extra);
  await notify(userId, `${n} new home${n > 1 ? "s" : ""} near you`, "See the latest homes that match your alert.", "/browse", undefined, { type: "HOME_ALERT" });
}
