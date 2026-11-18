import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { cleanPlace, normKey, syncLocationsFor } from "../properties/locations";

/*
 * PUT /api/v1/me/location — the app sends the user's approximate area (≈1 km) when location is already
 * allowed. Used only for search ranking, place counts and home alerts; never shown to other users or in
 * listing / landlord APIs. Unchanged area → no write at all. Never logs coordinates or names.
 */

const schema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    locality: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    state: z.string().trim().max(80).nullable().optional(),
    pincode: z.string().trim().regex(/^\d{6}$/, "Pincode must be 6 digits.").nullable().optional(),
    role: z.enum(["LANDLORD", "TENANT"]),
    source: z.enum(["DEVICE"]).default("DEVICE"),
  })
  .strict();

const r2 = (v: number) => Math.round(v * 100) / 100;

export async function putMyLocation(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const input = parseInput(schema, req.body ?? {});
  const next = {
    areaLatitude: r2(input.latitude),
    areaLongitude: r2(input.longitude),
    areaLocality: cleanPlace(input.locality),
    areaCity: cleanPlace(input.city),
    areaState: cleanPlace(input.state),
    areaPincode: input.pincode ?? null,
    areaRole: input.role,
  };
  const cur = await prisma.user.findUnique({ where: { id: user.id }, select: { areaLatitude: true, areaLongitude: true, areaLocality: true, areaCity: true, areaState: true } });
  const same =
    !!cur &&
    cur.areaLatitude !== null &&
    Number(cur.areaLatitude) === next.areaLatitude &&
    Number(cur.areaLongitude) === next.areaLongitude &&
    normKey(cur.areaLocality) === normKey(next.areaLocality) &&
    normKey(cur.areaCity) === normKey(next.areaCity);
  if (same) {
    res.json({ ok: true });
    return;
  }
  await consumeRateLimit(`me-location:${user.id}`, 10, 24 * 60 * 60 * 1000);
  await prisma.user.update({ where: { id: user.id }, data: { ...next, areaUpdatedAt: new Date() } });
  // Places: the new one gains this user, the old one loses them (recounted, never double counted).
  const placeChanged = !cur || normKey(cur.areaLocality) !== normKey(next.areaLocality) || normKey(cur.areaCity) !== normKey(next.areaCity) || normKey(cur.areaState) !== normKey(next.areaState);
  if (placeChanged || cur?.areaLatitude === null) {
    void syncLocationsFor(
      { locality: next.areaLocality, city: next.areaCity, state: next.areaState },
      cur ? { locality: cur.areaLocality, city: cur.areaCity, state: cur.areaState } : null,
    );
  }
  res.json({ ok: true });
}

/** Account deletion: forget the area and update the place counts. */
export async function clearUserArea(userId: string): Promise<void> {
  const cur = await prisma.user.findUnique({ where: { id: userId }, select: { areaLocality: true, areaCity: true, areaState: true } });
  await prisma.user.update({ where: { id: userId }, data: { areaLatitude: null, areaLongitude: null, areaLocality: null, areaCity: null, areaState: null, areaPincode: null, areaRole: null, areaUpdatedAt: null } });
  if (cur) await syncLocationsFor({ locality: cur.areaLocality, city: cur.areaCity, state: cur.areaState });
}
