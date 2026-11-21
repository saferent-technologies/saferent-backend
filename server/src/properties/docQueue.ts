import type { Prisma } from "@prisma/client";

/**
 * Ownership documents are verified only for properties the owner has sent for review (or that are already
 * approved / live). Drafts and rejected listings don't appear in the queue and can't be verified yet.
 */
export const REVIEWABLE_PROPERTY: Prisma.PropertyWhereInput = { revisionOfId: null, publicationStatus: { in: ["PENDING_VERIFICATION", "APPROVED", "PUBLISHED"] } };
export const isReviewable = (p: { publicationStatus: string; revisionOfId?: string | null }) =>
  !p.revisionOfId && ["PENDING_VERIFICATION", "APPROVED", "PUBLISHED"].includes(p.publicationStatus);
