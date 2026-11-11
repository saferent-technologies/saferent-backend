/**
 * Property lifecycle rules (pure — unit tested).
 *
 *  Publication:   DRAFT → PENDING_VERIFICATION → APPROVED → PUBLISHED
 *                              ↘ REJECTED → (edit) → PENDING_VERIFICATION
 *  Active status: ACTIVE ⇄ INACTIVE (owner) · SUSPENDED (moderators only) · ARCHIVED (soft delete)
 *
 * Active, publication, verification and availability statuses are separate fields and are never merged.
 */
import type { ActiveStatusValue, PublicationStatusValue } from "./catalog";

export type Decision = { ok: true } | { ok: false; reason: string };
const ok: Decision = { ok: true };
const no = (reason: string): Decision => ({ ok: false, reason });

export interface LifecycleState {
  activeStatus: ActiveStatusValue;
  publicationStatus: PublicationStatusValue;
}

/** Fields whose change sends an approved / published listing back for verification. */
export const MATERIAL_FIELDS = ["title", "description", "addressLine", "locality", "city", "state", "pincode", "latitude", "longitude", "listingType", "building"] as const;

export function canEditContent(p: LifecycleState, isModerator: boolean): Decision {
  if (p.activeStatus === "ARCHIVED") return no("Archived properties cannot be edited. Restore it first.");
  if (p.activeStatus === "SUSPENDED" && !isModerator) return no("This property is suspended. Contact SafeRent support.");
  if (p.publicationStatus === "PENDING_VERIFICATION" && !isModerator) return no("This property is being verified. You can edit it after the review.");
  return ok;
}

export function canSubmit(p: LifecycleState): Decision {
  if (p.activeStatus !== "ACTIVE") return no("Only active properties can be submitted.");
  if (p.publicationStatus !== "DRAFT" && p.publicationStatus !== "REJECTED") return no(`A ${p.publicationStatus.toLowerCase().replace(/_/g, " ")} property cannot be submitted again.`);
  return ok;
}

export function canReview(p: LifecycleState): Decision {
  if (p.publicationStatus !== "PENDING_VERIFICATION") return no("Only properties pending verification can be reviewed.");
  return ok;
}

export function canPublish(p: LifecycleState): Decision {
  if (p.activeStatus !== "ACTIVE") return no("Only active properties can be published.");
  if (p.publicationStatus === "PUBLISHED") return no("This property is already published.");
  if (p.publicationStatus !== "APPROVED") return no("A property must be approved by SafeRent before it can be published.");
  return ok;
}

export function canUnpublish(p: LifecycleState): Decision {
  return p.publicationStatus === "PUBLISHED" ? ok : no("Only published properties can be unpublished.");
}

/** What a content edit does to the publication status. */
export function publicationAfterEdit(p: LifecycleState, changedFields: readonly string[]): PublicationStatusValue {
  const material = changedFields.some((f) => (MATERIAL_FIELDS as readonly string[]).includes(f));
  if (material && (p.publicationStatus === "APPROVED" || p.publicationStatus === "PUBLISHED")) return "PENDING_VERIFICATION";
  return p.publicationStatus;
}

export function canChangeActiveStatus(from: ActiveStatusValue, to: ActiveStatusValue, actor: { isModerator: boolean; isAdmin: boolean }, hasActiveLeases: boolean): Decision {
  if (from === to) return no(`The property is already ${to.toLowerCase()}.`);
  if (to === "SUSPENDED") return actor.isModerator ? ok : no("Only SafeRent moderators can suspend a property.");
  if (from === "SUSPENDED") return actor.isModerator ? ok : no("Only SafeRent moderators can lift a suspension.");
  if (to === "ARCHIVED" && hasActiveLeases) return no("End the active leases before archiving this property.");
  if (to === "INACTIVE" && hasActiveLeases) return no("End the active leases before deactivating this property.");
  if (from === "ARCHIVED") return actor.isAdmin ? ok : no("Only an admin can restore an archived property.");
  return ok;
}
