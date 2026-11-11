/**
 * Who may see a property document (pure — unit tested in test/documentAccess.test.ts).
 *
 * Landlord side: the owner, assigned managers and SafeRent verifiers (checked elsewhere with scopes).
 * Tenant side: only documents that are SHARED, CURRENT, NOT ARCHIVED, of the same property as one of the
 * tenant's ACTIVE leases, and either property-level or for exactly the tenant's own flat / room / bed.
 */

export interface DocScope {
  propertyId: string;
  unitId: string | null;
  roomId: string | null;
  bedId: string | null;
  sharedWithTenant: boolean;
  isCurrent: boolean;
  archivedAt: Date | null;
}

export interface TenantLease {
  propertyId: string;
  unitId: string | null;
  bedId: string | null;
  /** Room of the leased bed (PG / hostel), if any. */
  roomId: string | null;
  status: string;
}

export function isPropertyLevel(d: Pick<DocScope, "unitId" | "roomId" | "bedId">): boolean {
  return !d.unitId && !d.roomId && !d.bedId;
}

/** Does this lease give its tenant access to this document? */
export function leaseCovers(d: Pick<DocScope, "propertyId" | "unitId" | "roomId" | "bedId">, l: TenantLease): boolean {
  if (l.status !== "ACTIVE" || d.propertyId !== l.propertyId) return false;
  if (isPropertyLevel(d)) return true;
  if (d.bedId) return d.bedId === l.bedId;
  if (d.roomId) return d.roomId === l.roomId;
  if (d.unitId) return d.unitId === l.unitId;
  return false;
}

export function tenantCanSee(d: DocScope, leases: TenantLease[]): boolean {
  if (!d.sharedWithTenant || !d.isCurrent || d.archivedAt) return false;
  return leases.some((l) => leaseCovers(d, l));
}

/** Document categories offered in the upload form; ownership types also go to SafeRent verification. */
export const DOCUMENT_CATEGORIES = ["RENTAL_AGREEMENT", "ELECTRICITY_BILL", "PROPERTY_TAX_RECEIPT", "OTHER", "OWNERSHIP_PROOF", "SALE_DEED", "BUILDING_PERMISSION", "LANDLORD_IDENTITY"] as const;
export const VERIFICATION_TYPES = ["OWNERSHIP_PROOF", "SALE_DEED", "PROPERTY_TAX_RECEIPT"] as const;

export function needsVerification(docType: string): boolean {
  return (VERIFICATION_TYPES as readonly string[]).includes(docType);
}

/** Display name: the custom name for "Other" (or any titled document), else the category. */
export function documentName(d: { docType: string; customName: string | null }): string {
  if (d.customName?.trim()) return d.customName.trim();
  return d.docType
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Shown to tenants: "Expired" once the expiry date has passed, otherwise "Active" (verified ones say so). */
export function documentState(d: { expiryDate: Date | null; status: string; needsVerification: boolean }, now = new Date()): "EXPIRED" | "VERIFIED" | "ACTIVE" {
  if (d.expiryDate && d.expiryDate.getTime() < now.getTime()) return "EXPIRED";
  if (d.needsVerification && d.status === "APPROVED") return "VERIFIED";
  return "ACTIVE";
}
