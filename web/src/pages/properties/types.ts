/** Shapes returned by /api/v1 property endpoints (see docs/openapi.json). */

export type Disclosure = "YES" | "NO" | "NOT_APPLICABLE" | "NOT_DISCLOSED";
export const DISCLOSURE: Disclosure[] = ["YES", "NO", "NOT_APPLICABLE", "NOT_DISCLOSED"];
export const PUBLICATION_STATUSES = ["DRAFT", "PENDING_VERIFICATION", "APPROVED", "REJECTED", "PUBLISHED"] as const;
export const ACTIVE_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export const AVAILABILITY = ["AVAILABLE", "OCCUPIED", "RESERVED", "UNDER_MAINTENANCE", "NOT_AVAILABLE"] as const;

export type FieldType = "text" | "textarea" | "integer" | "decimal" | "money" | "boolean" | "disclosure" | "select" | "date";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  help?: string;
  requiredWhen?: { field: string; equals: string };
}

export interface PropertyTypeDef {
  key: string;
  label: string;
  structure: "MULTI_UNIT" | "VILLA" | "SINGLE_UNIT" | "ROOMS_BEDS";
  /** False when an admin has turned this type off: existing listings still open, new ones can't be added. */
  enabled: boolean;
  category: string;
  unitKind: string | null;
  unitLabel: string | null;
  listingTypes: string[];
  floorWise: boolean;
  buildingFields: FieldDef[];
  unitFields: FieldDef[];
}

export interface PropertyTypesResponse {
  categories: Array<{ key: string; label: string; types: PropertyTypeDef[] }>;
  wizardSteps: Array<{ step: number; key: string; title: string }>;
  enums: Record<string, string[]>;
}

export interface Charge {
  id?: string;
  kind: string;
  label: string;
  billing: string;
  amount: string | null;
  frequency: string | null;
  notes?: string | null;
}

export interface CostLine {
  kind: string;
  label: string;
  amount: string | null;
  frequency: string | null;
  monthlyEquivalent: string | null;
  notes: string | null;
}

export interface CostBreakdown {
  monthlyRent: string | null;
  securityDeposit: string | null;
  includedInRent: CostLine[];
  fixed: CostLine[];
  usageBased: CostLine[];
  oneTime: CostLine[];
  notDisclosed: CostLine[];
  notApplicable: CostLine[];
  estimate: { monthly: string; isEstimate: true; basis: string; excludes: string[] } | null;
  estimateUnavailableReason: string | null;
}

export interface Pricing {
  id: string;
  monthlyRent: string | null;
  salePrice: string | null;
  securityDeposit: string | null;
  advanceRentMonths: number | null;
  rentDueDay: number | null;
  lateFeePolicy: string | null;
  lockInPeriodMonths: number | null;
  noticePeriodDays: number | null;
  rentIncreasePolicy: string | null;
  agreementCharges: string | null;
  agreementChargesPaidBy: string;
  refundPolicy: string | null;
  otherTerms: string | null;
  rentNegotiable: Disclosure;
  charges: Charge[];
  breakdown?: CostBreakdown;
}

export type Utilities = Record<string, string | number | null> & { id?: string };
export type Policy = Record<string, unknown> & { additionalRules?: Array<{ title: string; description: string }> | null };

export interface Unit {
  id: string;
  code: string;
  kind: string;
  name: string | null;
  unitNumber: string | null;
  floorNumber: number | null;
  bhkType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  balconies: number | null;
  kitchenCount: number | null;
  livingRoomCount: number | null;
  builtUpArea: string | null;
  carpetArea: string | null;
  plotArea: string | null;
  furnishing: string;
  configuration: string | null;
  totalFloors: number | null;
  parkingCapacity: number | null;
  parkingDetails: string | null;
  availableFrom: string | null;
  availabilityStatus: string;
  activeStatus: string;
  attributes: Record<string, unknown>;
  floors?: Array<{ id: string; floorNumber: number; label: string | null; bedrooms: number; bathrooms: number; kitchens: number; livingRooms: number; balconies: number; additionalDetails: string | null }>;
  pricing?: Pricing | null;
  utilities?: Utilities | null;
  version: number;
}

export interface Bed {
  id: string;
  code: string;
  bedNumber: string;
  rent: string | null;
  tenantId?: string | null;
  availabilityStatus: string;
  activeStatus?: string;
  version?: number;
}

export interface Room {
  id: string;
  code: string;
  roomNumber: string;
  floorNumber: number | null;
  sharingType: string;
  customSharing: number | null;
  attachedBathroom: Disclosure;
  acAvailable: Disclosure;
  rentPerBed: string | null;
  securityDeposit: string | null;
  availabilityStatus: string;
  beds: Bed[];
  availableBeds?: number;
  occupiedBeds?: number;
  version?: number;
}

export interface CompletenessSection {
  key: string;
  label: string;
  weight: number;
  ratio: number;
  points: number;
  missing: string[];
}

export interface PropertySummary {
  id: string;
  code: string;
  title: string | null;
  name: string | null;
  category: string;
  propertyType: string;
  propertyTypeLabel: string;
  structure: PropertyTypeDef["structure"] | null;
  listingType: string;
  locality: string | null;
  city: string | null;
  state: string | null;
  activeStatus: string;
  publicationStatus: string;
  verificationStatus: string;
  completenessScore: number;
  rentFrom: string | null;
  rentTo: string | null;
  availableCount: number;
  occupiedCount: number;
  wizardStep: number;
  owner: { id: string; fullName: string } | null;
  coverImageId: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PropertyDetail extends PropertySummary {
  description: string | null;
  addressLine: string | null;
  country: string;
  pincode: string | null;
  latitude: string | null;
  longitude: string | null;
  building: Record<string, unknown>;
  moderationNote: string | null;
  ownerId: string;
  type: (Omit<PropertyTypeDef, "unitKind" | "unitLabel" | "floorWise"> & { unitKind?: string; unitLabel?: string; floorWise?: boolean }) | null;
  units: Unit[];
  rooms: Room[];
  utilities: Utilities | null;
  policy: Policy | null;
  amenities: Array<{ id: string; key: string; label: string; status: Disclosure; notes: string | null }>;
  pricing: Pricing | null;
  images: Array<{ id: string; unitId: string | null; roomId: string | null; inspectionId: string | null; category: string; slot: number | null; displayOrder: number; status: string; createdAt: string }>;
  documents: Array<{ id: string; code: string; unitId: string | null; docType: string; originalName: string; status: string; verifiedAt: string | null; rejectionReason: string | null; createdAt: string }>;
  assignments: Array<{ id: string; type: "MANAGER" | "AGENT"; user: { id: string; fullName: string; role: string } }>;
  completeness: { score: number; sections: CompletenessSection[]; note: string };
}

export interface PropertyCan {
  manage: boolean;
  review: boolean;
  verifyDocuments: boolean;
  assign: boolean;
  inspect: boolean;
  suspend: boolean;
  transferOwnership: boolean;
}

export interface PublicListing {
  id: string;
  code: string;
  title: string | null;
  name: string | null;
  propertyType: string;
  propertyTypeLabel: string;
  listingType: string;
  locality: string | null;
  city: string | null;
  state: string | null;
  rentFrom: string | null;
  rentTo: string | null;
  availableCount: number;
  completenessScore: number;
  verificationStatus: string;
  ownerVerified?: boolean;
  coverImageId: string | null;
}

export const imagePath = (imageId: string) => `/files/property-images/${imageId}`;

export function rentRange(from: string | null, to: string | null, money: (v: string) => string): string {
  if (!from) return "Rent not disclosed";
  return to && to !== from ? `${money(from)} – ${money(to)}` : money(from);
}
