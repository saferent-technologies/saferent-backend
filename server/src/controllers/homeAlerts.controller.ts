import type { HomeAlert } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { cleanPlace, normKey, placeCentre } from "../properties/locations";

/** Tenant "Open to new homes" alert — GET / PUT /api/v1/me/home-alert. Location is never shown to landlords. */

function shape(a: HomeAlert | null) {
  if (!a) return { enabled: false, latitude: null, longitude: null, areaLabel: null, locality: null, city: null, radiusKm: 5, maxRent: null, propertyTypes: [], updatedAt: null };
  return {
    enabled: a.enabled,
    latitude: a.latitude === null ? null : Number(a.latitude),
    longitude: a.longitude === null ? null : Number(a.longitude),
    areaLabel: a.areaLabel,
    locality: a.locality,
    city: a.city,
    radiusKm: a.radiusKm,
    maxRent: a.maxRent,
    propertyTypes: Array.isArray(a.propertyTypes) ? (a.propertyTypes as string[]) : [],
    updatedAt: a.updatedAt,
  };
}

/** GET /api/v1/me/home-alert — not set yet → enabled:false. */
export async function getHomeAlert(req: Request, res: Response): Promise<void> {
  res.setHeader("Cache-Control", "no-store, private");
  res.json({ alert: shape(await prisma.homeAlert.findUnique({ where: { userId: me(req).id } })) });
}

const putSchema = z
  .object({
    enabled: z.boolean(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    areaLabel: z.string().trim().max(120).nullable().optional(),
    locality: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    radiusKm: z.coerce.number().int().min(1).max(50).default(5),
    maxRent: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
    propertyTypes: z.array(z.string().trim().min(2).max(40)).max(30).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    // enabled needs a point (latitude + longitude) or a place name (locality / city).
    const point = v.latitude !== null && v.latitude !== undefined && v.longitude !== null && v.longitude !== undefined;
    const place = !!(v.locality || v.city);
    if (v.enabled && !point && !place) {
      ctx.addIssue({ code: "custom", path: ["latitude"], message: "Choose the area on the map, or pick a locality / city." });
      ctx.addIssue({ code: "custom", path: ["longitude"], message: "Choose the area on the map, or pick a locality / city." });
    }
  });

/** PUT /api/v1/me/home-alert — one alert per user. */
export async function putHomeAlert(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const input = parseInput(putSchema, req.body ?? {});
  const types = [...new Set(input.propertyTypes)];
  if (types.length) {
    const ok = await prisma.propertyTypeDefinition.count({ where: { key: { in: types }, active: true } });
    if (ok !== types.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose property types from the list.", { issues: [{ path: "propertyTypes", message: "Choose property types from the list." }] });
  }
  const locality = cleanPlace(input.locality);
  const city = cleanPlace(input.city);
  let latitude = input.latitude ?? null;
  let longitude = input.longitude ?? null;
  // Only a place name given → use that place's centre (if we know it); key matching works either way.
  if ((latitude === null || longitude === null) && (locality || city)) {
    const centre = await placeCentre(locality, city);
    latitude = centre?.latitude ?? null;
    longitude = centre?.longitude ?? null;
  }
  const data = {
    enabled: input.enabled,
    latitude,
    longitude,
    areaLabel: input.areaLabel ?? ([locality, city].filter(Boolean).join(", ") || null),
    locality,
    city,
    localityKey: locality ? normKey(locality) : null,
    cityKey: city ? normKey(city) : null,
    radiusKm: input.radiusKm,
    maxRent: input.maxRent ?? null,
    propertyTypes: types,
  };
  const saved = await prisma.homeAlert.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  res.setHeader("Cache-Control", "no-store, private");
  res.locals.message = input.enabled ? "We'll tell you about new homes nearby" : "Home alerts turned off";
  res.json({ alert: shape(saved) });
}

/** Account deletion: the alert (and its match history) goes. */
export async function deleteHomeAlertFor(userId: string): Promise<void> {
  await prisma.homeAlert.deleteMany({ where: { userId } });
  await prisma.homeAlertMatch.deleteMany({ where: { userId } });
}
