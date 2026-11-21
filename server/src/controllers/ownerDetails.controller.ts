import type { Prisma, PropertyOwnership } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { ownerDetailsSchema, ownershipSchema } from "../lib/ownership";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { hasRole, me } from "../middleware/auth";
import { audit, isModerator, scopedProperty } from "../properties/service";

/*
 * Owner details (landlord profile) and property ownership (who owns it, shares, who may act for the owner).
 * Private: never on public / tenant listing views. Logs carry field names only (no phones, names, emails).
 */

const OWNER_FIELDS = {
  address: true,
  city: true,
  state: true,
  pincode: true,
  alternatePhone: true,
  preferredLanguage: true,
  preferredContactMethod: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelation: true,
} as const;

function requireLandlord(req: Request): void {
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Owner details are for property owners.");
}

/** GET /api/v1/landlord/owner-details — name, photo, mobile and email come from the user profile. */
export async function getOwnerDetails(req: Request, res: Response): Promise<void> {
  requireLandlord(req);
  const user = me(req);
  const row = await prisma.landlordProfile.findUnique({ where: { userId: user.id }, select: OWNER_FIELDS });
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    ownerDetails: {
      fullName: user.fullName,
      nameLocked: user.nameLocked,
      profileImage: user.profileImage ? `/api/profile/image/${user.id}` : null,
      phoneNumber: user.phoneNumber,
      email: user.email,
      ...(row ?? Object.fromEntries(Object.keys(OWNER_FIELDS).map((k) => [k, null]))),
    },
  });
}

/** PUT /api/v1/landlord/owner-details — partial update (send what changes; null clears). */
export async function putOwnerDetails(req: Request, res: Response): Promise<void> {
  requireLandlord(req);
  const user = me(req);
  const input = parseInput(ownerDetailsSchema, req.body ?? {});
  if (input.alternatePhone && user.phoneNumber && input.alternatePhone.replace(/^\+?91/, "") === user.phoneNumber.replace(/^\+91/, "")) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "The alternate number must be different from your mobile number.");
  }
  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Prisma.LandlordProfileUncheckedUpdateInput;
  await prisma.landlordProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...(data as object) }, update: data });
  await logActivity(req, "landlord.owner_details", "user", user.id, { fields: Object.keys(data) });
  res.locals.message = "Saved";
  await getOwnerDetails(req, res);
}

export function presentOwnership(o: PropertyOwnership | null) {
  if (!o) return null;
  return {
    ownerType: o.ownerType,
    ownershipType: o.ownershipType,
    companyName: o.companyName,
    ownerSharePercent: o.ownerSharePercent === null ? null : Number(o.ownerSharePercent),
    coOwners: (o.coOwners as unknown[] | null) ?? [],
    representative: o.representative ?? null,
    updatedAt: o.updatedAt,
  };
}

/** GET /api/v1/properties/:propertyId/ownership — owner, assigned managers, staff. */
export async function getOwnership(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const liveId = property.revisionOfId ?? property.id;
  const o = await prisma.propertyOwnership.findUnique({ where: { propertyId: liveId } });
  const [poa, live] = await Promise.all([
    prisma.propertyDocument.count({ where: { propertyId: liveId, docType: "POWER_OF_ATTORNEY", isCurrent: true, archivedAt: null } }),
    prisma.property.findUniqueOrThrow({ where: { id: liveId }, select: { publicationStatus: true } }),
  ]);
  res.setHeader("Cache-Control", "no-store, private");
  res.json({ ownership: presentOwnership(o), powerOfAttorneyUploaded: poa > 0, canEdit: canEditOwnership(req, live.publicationStatus) });
}

/** Owners edit while the listing is a draft / sent back; after approval only SafeRent staff change it. */
function canEditOwnership(req: Request, publicationStatus: string): boolean {
  return isModerator(req) || hasRole(req, "SUPER_ADMIN") || publicationStatus === "DRAFT" || publicationStatus === "REJECTED";
}

/** PUT /api/v1/properties/:propertyId/ownership */
export async function putOwnership(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const liveId = property.revisionOfId ?? property.id;
  const live = await prisma.property.findUniqueOrThrow({ where: { id: liveId }, select: { publicationStatus: true } });
  if (!canEditOwnership(req, live.publicationStatus)) {
    fail("failed-precondition", REASONS.INVALID_STATE, "Ownership details can't be changed after the listing is sent for review or approved. Contact support.");
  }
  const input = parseInput(ownershipSchema, req.body ?? {});
  const data = {
    ownerType: input.ownerType,
    ownershipType: input.ownershipType,
    companyName: input.ownerType === "COMPANY" ? (input.companyName ?? null) : null,
    ownerSharePercent: input.ownershipType === "JOINT" ? (input.ownerSharePercent ?? null) : null,
    coOwners: (input.ownershipType === "JOINT" ? input.coOwners : []) as Prisma.InputJsonValue,
    representative: (input.representative ?? null) as Prisma.InputJsonValue,
    updatedById: me(req).id,
  };
  const saved = await prisma.$transaction(async (tx) => {
    const o = await tx.propertyOwnership.upsert({ where: { propertyId: liveId }, create: { propertyId: liveId, ...data }, update: data });
    await audit(tx, req, { propertyId: liveId, entityType: "PROPERTY", entityId: liveId, action: "ownership.update", newValue: { ownerType: o.ownerType, ownershipType: o.ownershipType, coOwners: input.coOwners.length, representative: !!input.representative } });
    return o;
  });
  res.locals.message = "Ownership details saved";
  res.json({ ownership: presentOwnership(saved) });
}

/** Submit check: a representative acting under a Power of Attorney needs the POA document uploaded. */
export async function ownershipProblems(liveId: string): Promise<string[]> {
  const o = await prisma.propertyOwnership.findUnique({ where: { propertyId: liveId }, select: { representative: true } });
  const rep = o?.representative as { authorityType?: string } | null | undefined;
  if (rep?.authorityType !== "POWER_OF_ATTORNEY") return [];
  const poa = await prisma.propertyDocument.count({ where: { propertyId: liveId, docType: "POWER_OF_ATTORNEY", isCurrent: true, archivedAt: null } });
  return poa ? [] : ["Upload the Power of Attorney document for the representative."];
}
