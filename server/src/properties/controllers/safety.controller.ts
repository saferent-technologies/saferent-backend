import { Prisma, type PropertySafety } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found, idParam } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { SAFETY_CERTIFICATES, extinguisherState, safetySchema, safetyScore, type SafetyInput } from "../../lib/safety";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { audit, scopedProperty, withProperty } from "../service";

/*
 * Safety & emergency information of a property.
 *   Owner / manager: GET / PUT /properties/:id/safety (+ safety certificates as property documents).
 *   Tenants browsing: safety features only (browse view).
 *   Tenant with an active lease (and the landlord): GET /leases/:leaseId/emergency — contacts, hospital,
 *   police station, security, instructions. Logs: ids only.
 */

type Place = { name: string; phone?: string | null; address?: string | null; distanceKm?: number | null; latitude?: number | null; longitude?: number | null };

function asInput(r: PropertySafety | null): SafetyInput | null {
  if (!r) return null;
  return {
    fireExtinguisher: r.fireExtinguisher,
    fireExtinguisherCount: r.fireExtinguisherCount,
    fireExtinguisherExpiry: r.fireExtinguisherExpiry,
    smokeDetectors: r.smokeDetectors,
    smokeDetectorLocations: r.smokeDetectorLocations,
    emergencyExits: r.emergencyExits,
    emergencyStaircase: r.emergencyStaircase,
    firstAidKit: r.firstAidKit,
    firstAidLocation: r.firstAidLocation,
    securityName: r.securityName,
    securityPhone: r.securityPhone,
    security24x7: r.security24x7,
    emergencyContacts: (r.emergencyContacts as SafetyInput["emergencyContacts"]) ?? null,
    nearestHospital: (r.nearestHospital as Place | null) ?? null,
    nearestPoliceStation: (r.nearestPoliceStation as Place | null) ?? null,
    instructions: r.instructions,
  };
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Safety certificates uploaded for the property (or its open change-request copy). */
async function certificates(liveId: string) {
  const draft = await prisma.property.findFirst({ where: { revisionOfId: liveId }, select: { id: true } });
  const docs = await prisma.propertyDocument.findMany({ where: { propertyId: { in: [liveId, ...(draft ? [draft.id] : [])] }, docType: { in: [...SAFETY_CERTIFICATES] }, isCurrent: true, archivedAt: null }, select: { docType: true, status: true } });
  return SAFETY_CERTIFICATES.map((t) => {
    const d = docs.find((x) => x.docType === t);
    return { docType: t, uploaded: !!d, status: d?.status ?? null };
  });
}

async function fullView(propertyId: string) {
  const row = await prisma.propertySafety.findUnique({ where: { propertyId } });
  const input = asInput(row);
  return {
    safety: input ? { ...input, fireExtinguisherExpiry: day(input.fireExtinguisherExpiry) } : null,
    extinguisherState: extinguisherState(row?.fireExtinguisher, row?.fireExtinguisherExpiry),
    score: safetyScore(input),
    certificates: await certificates(propertyId),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** GET /api/v1/properties/:propertyId/safety — owner / managers / staff. */
export async function getSafety(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  res.setHeader("Cache-Control", "no-store, private");
  res.json(await fullView(property.id));
}

/** PUT /api/v1/properties/:propertyId/safety — the whole object. */
export async function putSafety(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(safetySchema, req.body ?? {});
  const before = await prisma.propertySafety.findUnique({ where: { propertyId: property.id }, select: { fireExtinguisherExpiry: true } });
  const expiryChanged = day(before?.fireExtinguisherExpiry) !== day(input.fireExtinguisherExpiry ?? null);
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  const data = {
    fireExtinguisher: input.fireExtinguisher ?? null,
    fireExtinguisherCount: input.fireExtinguisherCount ?? null,
    fireExtinguisherExpiry: input.fireExtinguisherExpiry ?? null,
    ...(expiryChanged ? { expiryNoticeStage: 0 } : {}),
    smokeDetectors: input.smokeDetectors ?? null,
    smokeDetectorLocations: input.smokeDetectorLocations ?? null,
    emergencyExits: input.emergencyExits ?? null,
    emergencyStaircase: input.emergencyStaircase ?? null,
    firstAidKit: input.firstAidKit ?? null,
    firstAidLocation: input.firstAidLocation ?? null,
    securityName: input.securityName ?? null,
    securityPhone: input.securityPhone ?? null,
    security24x7: input.security24x7 ?? null,
    emergencyContacts: input.emergencyContacts?.length ? json(input.emergencyContacts) : undefined,
    nearestHospital: input.nearestHospital ? json(input.nearestHospital) : undefined,
    nearestPoliceStation: input.nearestPoliceStation ? json(input.nearestPoliceStation) : undefined,
    instructions: input.instructions ?? null,
    updatedById: me(req).id,
  };
  await withProperty(property.id, async (tx) => {
    await tx.propertySafety.upsert({ where: { propertyId: property.id }, create: { propertyId: property.id, ...data }, update: data });
    // JSON columns: clear explicitly when removed.
    const clear: Prisma.PropertySafetyUpdateInput = {};
    const nul = Prisma.DbNull;
    if (!input.emergencyContacts?.length) clear.emergencyContacts = nul;
    if (!input.nearestHospital) clear.nearestHospital = nul;
    if (!input.nearestPoliceStation) clear.nearestPoliceStation = nul;
    if (Object.keys(clear).length) await tx.propertySafety.update({ where: { propertyId: property.id }, data: clear });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "safety.update", newValue: { score: safetyScore(input) } });
  });
  res.locals.message = "Safety details saved";
  res.json(await fullView(property.id));
}

/** Tenants browsing a listing: which safety features exist (no contacts, no instructions). */
export async function safetyForListing(propertyId: string) {
  const row = await prisma.propertySafety.findUnique({ where: { propertyId } });
  const certs = await certificates(propertyId);
  if (!row && !certs.some((c) => c.uploaded)) return null;
  return {
    fireExtinguisher: row?.fireExtinguisher ?? null,
    fireExtinguisherState: extinguisherState(row?.fireExtinguisher, row?.fireExtinguisherExpiry),
    smokeDetectors: row?.smokeDetectors ?? null,
    emergencyExits: row?.emergencyExits ?? null,
    emergencyStaircase: row?.emergencyStaircase ?? null,
    firstAidKit: row?.firstAidKit ?? null,
    security: row?.securityPhone ? (row.security24x7 ? "24X7" : "AVAILABLE") : row?.security24x7 === false ? "NONE" : null,
    certificates: certs.filter((c) => c.uploaded).map((c) => ({ docType: c.docType, verified: c.status === "APPROVED" })),
  };
}

/** GET /api/v1/leases/:leaseId/emergency — the tenant of an active lease, or the landlord. */
export async function leaseEmergency(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = found(await prisma.lease.findFirst({ where: { id: idParam(req, "leaseId"), OR: [{ tenantId: user.id }, { landlordId: user.id }] }, select: { id: true, status: true, propertyId: true, tenantId: true, landlordId: true } }), "Lease");
  if (lease.tenantId === user.id && lease.status !== "ACTIVE") fail("failed-precondition", REASONS.LEASE_ENDED, "Emergency details are for your current rental.");
  const [row, landlord, property] = await Promise.all([
    prisma.propertySafety.findUnique({ where: { propertyId: lease.propertyId } }),
    prisma.user.findUnique({ where: { id: lease.landlordId }, select: { fullName: true, phoneNumber: true } }),
    prisma.property.findUnique({ where: { id: lease.propertyId }, select: { title: true, code: true, addressLine: true, locality: true, city: true } }),
  ]);
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    property: property ? { title: property.title ?? property.code, address: [property.addressLine, property.locality, property.city].filter(Boolean).join(", ") } : null,
    landlord: landlord ? { fullName: landlord.fullName, phoneNumber: landlord.phoneNumber } : null,
    security: row?.securityPhone ? { name: row.securityName, phone: row.securityPhone, available24x7: row.security24x7 } : null,
    emergencyContacts: (row?.emergencyContacts as Array<{ label: string; phone: string }> | null) ?? [],
    // National helplines in India, always shown.
    helplines: [
      { label: "Emergency (all services)", phone: "112" },
      { label: "Police", phone: "100" },
      { label: "Fire", phone: "101" },
      { label: "Ambulance", phone: "108" },
      { label: "Women helpline", phone: "1091" },
    ],
    nearestHospital: (row?.nearestHospital as Place | null) ?? null,
    nearestPoliceStation: (row?.nearestPoliceStation as Place | null) ?? null,
    firstAid: row?.firstAidKit ? { location: row.firstAidLocation } : null,
    fireExtinguisher: row?.fireExtinguisher ? { count: row.fireExtinguisherCount, expiry: day(row.fireExtinguisherExpiry), state: extinguisherState(true, row.fireExtinguisherExpiry) } : null,
    smokeDetectors: row?.smokeDetectors ? { locations: row.smokeDetectorLocations } : null,
    emergencyExits: row?.emergencyExits ?? null,
    emergencyStaircase: row?.emergencyStaircase ?? null,
    instructions: row?.instructions ?? null,
  });
}

/** Job: tell owners 30 days before the fire extinguisher expires, and when it has expired (once each). */
export async function processSafetyReminders(): Promise<void> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const in30 = new Date(today.getTime() + 30 * 86_400_000);
  const rows = await prisma.propertySafety.findMany({
    where: { fireExtinguisher: true, fireExtinguisherExpiry: { not: null, lte: in30 }, expiryNoticeStage: { lt: 2 } },
    select: { propertyId: true, fireExtinguisherExpiry: true, expiryNoticeStage: true },
    take: 500,
  });
  for (const r of rows) {
    const expired = r.fireExtinguisherExpiry! < today;
    const stage = expired ? 2 : 1;
    if (r.expiryNoticeStage >= stage) continue;
    const claimed = await prisma.propertySafety.updateMany({ where: { propertyId: r.propertyId, expiryNoticeStage: r.expiryNoticeStage }, data: { expiryNoticeStage: stage } });
    if (!claimed.count) continue;
    const p = await prisma.property.findUnique({ where: { id: r.propertyId }, select: { ownerId: true, title: true, code: true } });
    if (!p) continue;
    const name = p.title ?? p.code;
    await notify(
      p.ownerId,
      expired ? "Fire extinguisher expired" : "Fire extinguisher expires soon",
      expired ? `The fire extinguisher at "${name}" expired on ${day(r.fireExtinguisherExpiry)}. Refill or replace it and update the date.` : `The fire extinguisher at "${name}" expires on ${day(r.fireExtinguisherExpiry)}. Plan a refill.`,
      `/properties/${r.propertyId}?tab=safety`,
      undefined,
      { type: "SAFETY_EXPIRY", propertyId: r.propertyId },
    );
  }
}
