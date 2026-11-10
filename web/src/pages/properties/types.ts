export const PROPERTY_TYPES = ["APARTMENT", "INDEPENDENT_HOUSE", "VILLA", "PG_HOSTEL", "COMMERCIAL"] as const;
export const FURNISHING = ["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"] as const;
export const PROPERTY_STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "REJECTED", "RENTED", "INACTIVE"] as const;

export interface Property {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  propertyType: (typeof PROPERTY_TYPES)[number];
  addressLine: string;
  locality: string | null;
  city: string;
  state: string;
  pincode: string;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number | null;
  furnishing: (typeof FURNISHING)[number];
  monthlyRent: string;
  securityDeposit: string;
  availableFrom: string | null;
  isAvailable: boolean;
  status: (typeof PROPERTY_STATUSES)[number];
  moderationNote: string | null;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; fullName: string };
  images: Array<{ id: string; status: string; createdAt?: string }>;
  _count?: { applications: number; documents: number };
}

export interface PropertyDetail extends Property {
  documents: Array<{ id: string; docType: string; originalName: string; status: string; note: string | null; createdAt: string }>;
  assignments: Array<{ id: string; type: "MANAGER" | "AGENT"; user: { id: string; fullName: string; role: string } }>;
  inspections: Array<{ id: string; scheduledAt: string; status: string; result: string | null; notes: string | null }>;
}

export type PublicListing = Pick<
  Property,
  "id" | "title" | "description" | "propertyType" | "locality" | "city" | "state" | "pincode" | "bedrooms" | "bathrooms" | "areaSqft" | "furnishing" | "monthlyRent" | "securityDeposit" | "availableFrom" | "verified" | "createdAt"
> & { images: Array<{ id: string }> };

export const imagePath = (imageId: string) => `/files/property-images/${imageId}`;
