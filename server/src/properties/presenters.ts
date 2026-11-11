/**
 * API shapes for properties. Two views:
 *   presentProperty() — owner / assigned staff / admins (everything they are allowed to manage)
 *   presentPublic()   — published listing for tenants: no owner identity, no documents, no tenant ids,
 *                       only approved photos, no meter numbers. Undisclosed values stay NOT_DISCLOSED.
 */
import type { Property } from "@prisma/client";
import { propertyTypeDef } from "./catalog";
import { computeCompleteness, type CompletenessResult } from "./completeness";
import { costBreakdown, type ChargeLike } from "./costs";
import { completenessInput, type PropertyAggregate } from "./service";

export const imageUrl = (id: string) => `/api/v1/files/property-images/${id}`;
export const documentUrl = (id: string) => `/api/v1/files/documents/${id}`;

type Pricing = PropertyAggregate["pricing"][number];
type Utility = PropertyAggregate["utilities"][number];

function presentPricing(p: Pricing | undefined, utility: Utility | undefined) {
  if (!p) return null;
  const { charges, ...rest } = p;
  return {
    ...rest,
    charges,
    breakdown: costBreakdown(p, charges as unknown as ChargeLike[], utility ?? null),
  };
}

export function propertySummary(p: Property & { owner?: { id: string; fullName: string } | null; images?: Array<{ id: string; status: string }> }) {
  const type = propertyTypeDef(p.propertyTypeKey);
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    name: p.name,
    category: p.category,
    propertyType: p.propertyTypeKey,
    propertyTypeLabel: type?.label ?? p.propertyTypeKey,
    structure: type?.structure ?? null,
    listingType: p.listingType,
    locality: p.locality,
    city: p.city,
    state: p.state,
    activeStatus: p.activeStatus,
    publicationStatus: p.publicationStatus,
    verificationStatus: p.verificationStatus,
    completenessScore: p.completenessScore,
    rentFrom: p.rentFrom,
    rentTo: p.rentTo,
    availableCount: p.availableCount,
    occupiedCount: p.occupiedCount,
    wizardStep: p.wizardStep,
    owner: p.owner ?? null,
    coverImageId: p.images?.find((i) => i.status !== "REJECTED")?.id ?? null,
    submittedAt: p.submittedAt,
    publishedAt: p.publishedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    version: p.version,
  };
}

export function presentProperty(p: PropertyAggregate, completeness?: CompletenessResult) {
  const type = propertyTypeDef(p.propertyTypeKey);
  const utilityFor = (scope: string) => p.utilities.find((u) => u.scopeKey === scope);
  const propertyUtility = utilityFor("PROPERTY");
  const pricingFor = (scope: string) => p.pricing.find((x) => x.scopeKey === scope);
  return {
    ...propertySummary(p),
    description: p.description,
    addressLine: p.addressLine,
    country: p.country,
    pincode: p.pincode,
    latitude: p.latitude,
    longitude: p.longitude,
    building: { name: p.name, totalFloors: p.totalFloors, totalUnits: p.totalUnits, ...((p.attributes as Record<string, unknown> | null) ?? {}) },
    moderationNote: p.moderationNote,
    reviewedAt: p.reviewedAt,
    archivedAt: p.archivedAt,
    ownerId: p.ownerId,
    type: type ?? null,
    units: p.units.map((u) => ({
      ...u,
      attributes: u.attributes ?? {},
      pricing: presentPricing(pricingFor(u.id), utilityFor(u.id) ?? propertyUtility),
      utilities: utilityFor(u.id) ?? null,
      amenities: p.amenities.filter((a) => a.scopeKey === u.id),
      imageIds: p.images.filter((i) => i.unitId === u.id).map((i) => i.id),
    })),
    rooms: p.rooms.map((r) => ({
      ...r,
      bedCount: r.beds.length,
      availableBeds: r.beds.filter((b) => b.activeStatus === "ACTIVE" && b.availabilityStatus === "AVAILABLE").length,
      occupiedBeds: r.beds.filter((b) => b.availabilityStatus === "OCCUPIED").length,
      imageIds: p.images.filter((i) => i.roomId === r.id).map((i) => i.id),
    })),
    utilities: propertyUtility ?? null,
    policy: p.policy,
    amenities: p.amenities.filter((a) => a.scopeKey === "PROPERTY"),
    pricing: presentPricing(pricingFor("PROPERTY"), propertyUtility),
    images: p.images.map((i) => ({ ...i, url: imageUrl(i.id) })),
    documents: p.documents.map((d) => ({ ...d, url: documentUrl(d.id) })),
    assignments: p.assignments.map((a) => ({ id: a.id, type: a.type, user: a.user, createdAt: a.createdAt })),
    completeness: completeness ?? computeCompleteness(completenessInput(p)),
  };
}

const PRIVATE_UTILITY_FIELDS = ["meterNumber", "meterReadingAtHandover", "meterReadingImageId", "id", "propertyId", "scopeKey", "updatedAt"] as const;

function publicUtility(u: Utility | undefined) {
  if (!u) return null;
  const copy: Record<string, unknown> = { ...u };
  for (const k of PRIVATE_UTILITY_FIELDS) delete copy[k];
  return copy;
}

export function presentPublic(p: PropertyAggregate) {
  const type = propertyTypeDef(p.propertyTypeKey);
  const approved = p.images.filter((i) => i.status === "APPROVED" && !i.inspectionId);
  const utilityFor = (scope: string) => p.utilities.find((u) => u.scopeKey === scope);
  const propertyUtility = utilityFor("PROPERTY");
  const pricingFor = (scope: string) => p.pricing.find((x) => x.scopeKey === scope);
  const completeness = computeCompleteness(completenessInput(p));
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    description: p.description,
    name: p.name,
    category: p.category,
    propertyType: p.propertyTypeKey,
    propertyTypeLabel: type?.label ?? p.propertyTypeKey,
    structure: type?.structure ?? null,
    listingType: p.listingType,
    locality: p.locality,
    city: p.city,
    state: p.state,
    pincode: p.pincode,
    latitude: p.latitude,
    longitude: p.longitude,
    building: { name: p.name, totalFloors: p.totalFloors, totalUnits: p.totalUnits, ...((p.attributes as Record<string, unknown> | null) ?? {}) },
    /** VERIFIED only when a SafeRent admin verified the listing. Landlord-entered data is never auto-verified. */
    verificationStatus: p.verificationStatus,
    completeness: { score: completeness.score, note: completeness.note, missing: completeness.sections.flatMap((s) => s.missing) },
    rentFrom: p.rentFrom,
    rentTo: p.rentTo,
    availableCount: p.availableCount,
    // Occupied flats are not shown to the public; other flats of the building stay visible.
    units: p.units
      .filter((u) => u.activeStatus === "ACTIVE" && u.availabilityStatus !== "OCCUPIED")
      .map((u) => {
        const { attributes, ...rest } = u;
        return {
          ...rest,
          attributes: attributes ?? {},
          pricing: presentPricing(pricingFor(u.id), utilityFor(u.id) ?? propertyUtility),
          utilities: publicUtility(utilityFor(u.id)),
          amenities: p.amenities.filter((a) => a.scopeKey === u.id).map(({ key, label, status, notes }) => ({ key, label, status, notes })),
          imageIds: approved.filter((i) => i.unitId === u.id).map((i) => i.id),
        };
      }),
    rooms: p.rooms
      .filter((r) => r.activeStatus === "ACTIVE")
      .map((r) => ({
        id: r.id,
        code: r.code,
        roomNumber: r.roomNumber,
        floorNumber: r.floorNumber,
        sharingType: r.sharingType,
        customSharing: r.customSharing,
        attachedBathroom: r.attachedBathroom,
        acAvailable: r.acAvailable,
        rentPerBed: r.rentPerBed,
        securityDeposit: r.securityDeposit,
        totalBeds: r.beds.length,
        availableBeds: r.beds.filter((b) => b.activeStatus === "ACTIVE" && b.availabilityStatus === "AVAILABLE").length,
        // Bed occupancy only — never who occupies it.
        beds: r.beds.filter((b) => b.activeStatus === "ACTIVE" && b.availabilityStatus !== "OCCUPIED").map((b) => ({ id: b.id, code: b.code, bedNumber: b.bedNumber, rent: b.rent ?? r.rentPerBed, availabilityStatus: b.availabilityStatus })),
        imageIds: approved.filter((i) => i.roomId === r.id).map((i) => i.id),
      })),
    utilities: publicUtility(propertyUtility),
    policy: p.policy ? { ...p.policy, propertyId: undefined, updatedAt: undefined } : null,
    amenities: p.amenities.filter((a) => a.scopeKey === "PROPERTY").map(({ key, label, status, notes }) => ({ key, label, status, notes })),
    pricing: presentPricing(pricingFor("PROPERTY"), propertyUtility),
    images: approved.map((i) => ({ id: i.id, category: i.category, slot: i.slot, unitId: i.unitId, roomId: i.roomId, url: imageUrl(i.id) })),
    publishedAt: p.publishedAt,
    disclosureLegend: {
      YES: "Yes",
      NO: "No",
      NOT_APPLICABLE: "Not applicable",
      NOT_DISCLOSED: "Not disclosed by the landlord — ask before you rent.",
    },
  };
}
