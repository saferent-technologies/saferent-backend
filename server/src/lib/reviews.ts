/**
 * Rental review rules (pure — unit tested in test/reviews.test.ts).
 *
 * Two-way, double-blind reviews tied to a real, finished lease:
 *  - the tenant reviews the landlord, the landlord reviews the tenant;
 *  - neither side sees the other's review until both are in, or the review window closes;
 *  - reviews are optional and never block move-out, a new lease or a new invitation.
 */

export type ReviewerRole = "TENANT" | "LANDLORD";

export const TENANT_CATEGORIES = [
  ["overall", "Overall experience"],
  ["propertyCondition", "Property condition"],
  ["communication", "Landlord communication"],
  ["maintenance", "Maintenance response"],
  ["rentTransparency", "Rent transparency"],
  ["depositRefund", "Deposit refund experience"],
  ["agreementTransparency", "Agreement transparency"],
  ["problemResolution", "Problem resolution"],
] as const;

export const LANDLORD_CATEGORIES = [
  ["overall", "Overall experience"],
  ["rentPunctuality", "Rent payment punctuality"],
  ["propertyCare", "Property care"],
  ["cleanliness", "Cleanliness"],
  ["communication", "Communication"],
  ["agreementCompliance", "Agreement compliance"],
  ["moveOutCondition", "Move-out property condition"],
] as const;

export const TENANT_TAGS = ["Responsive", "Fair deposit refund", "Well maintained", "Transparent charges", "Respectful", "Slow repairs", "Hidden charges", "Deposit issues", "Hard to reach"] as const;
export const LANDLORD_TAGS = ["Paid on time", "Kept the home clean", "Easy to communicate", "Followed the rules", "Late payments", "Damage beyond normal wear", "Rule violations"] as const;

export function categoriesFor(role: ReviewerRole) {
  return role === "TENANT" ? TENANT_CATEGORIES : LANDLORD_CATEGORIES;
}
export function tagsFor(role: ReviewerRole): readonly string[] {
  return role === "TENANT" ? TENANT_TAGS : LANDLORD_TAGS;
}

/** Which side of the lease the user is on, or null when they're not a party (no self-reviews: tenant ≠ landlord). */
export function reviewerRoleOf(lease: { tenantId: string; landlordId: string }, userId: string): ReviewerRole | null {
  if (lease.tenantId === lease.landlordId) return null;
  if (userId === lease.tenantId) return "TENANT";
  if (userId === lease.landlordId) return "LANDLORD";
  return null;
}

export const DEFAULT_REVIEW_WINDOW_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export function windowClosesAt(endedAt: Date, windowDays: number): Date {
  return new Date(endedAt.getTime() + windowDays * DAY);
}

export type Eligibility =
  | { eligible: true; role: ReviewerRole; closesAt: Date }
  | { eligible: false; reason: "NOT_A_PARTY" | "NOT_FINISHED" | "NO_RENTAL_EXPERIENCE" | "WINDOW_CLOSED" | "ALREADY_REVIEWED" };

/**
 * A lease can be reviewed when it has finished (ENDED / TERMINATED after it started), by one of its two
 * parties, once each, inside the review window. A lease cancelled before it began has no rental
 * experience and can't be reviewed.
 */
export function reviewEligibility(
  lease: { tenantId: string; landlordId: string; status: string; startDate: Date; endedAt: Date | null },
  userId: string,
  opts: { windowDays: number; alreadyReviewed: boolean; now?: Date },
): Eligibility {
  const role = reviewerRoleOf(lease, userId);
  if (!role) return { eligible: false, reason: "NOT_A_PARTY" };
  if (!["ENDED", "TERMINATED"].includes(lease.status) || !lease.endedAt) return { eligible: false, reason: "NOT_FINISHED" };
  if (lease.endedAt.getTime() < lease.startDate.getTime()) return { eligible: false, reason: "NO_RENTAL_EXPERIENCE" };
  if (opts.alreadyReviewed) return { eligible: false, reason: "ALREADY_REVIEWED" };
  const closesAt = windowClosesAt(lease.endedAt, opts.windowDays);
  if ((opts.now ?? new Date()).getTime() >= closesAt.getTime()) return { eligible: false, reason: "WINDOW_CLOSED" };
  return { eligible: true, role, closesAt };
}

export const ELIGIBILITY_MESSAGES: Record<Exclude<Eligibility, { eligible: true }>["reason"], string> = {
  NOT_A_PARTY: "Only the tenant and the landlord of this lease can review it.",
  NOT_FINISHED: "Reviews open after the lease ends and move-out is complete.",
  NO_RENTAL_EXPERIENCE: "This lease ended before it started, so there's nothing to review.",
  WINDOW_CLOSED: "The review window for this lease has closed.",
  ALREADY_REVIEWED: "You've already reviewed this lease.",
};

/**
 * Double-blind publication: publish when both sides have submitted, or when the window has closed
 * (then whatever was submitted is published on its own).
 */
export function shouldPublish(p: { tenantSubmitted: boolean; landlordSubmitted: boolean; closesAt: Date; now?: Date }): boolean {
  if (p.tenantSubmitted && p.landlordSubmitted) return true;
  return (p.tenantSubmitted || p.landlordSubmitted) && (p.now ?? new Date()).getTime() >= p.closesAt.getTime();
}

/** Visible to everyone (signed in): published, or flagged while a report is looked at. Never removed or unpublished ones. */
export const PUBLIC_STATUSES = ["PUBLISHED", "FLAGGED"] as const;

export function isPublic(status: string): boolean {
  return (PUBLIC_STATUSES as readonly string[]).includes(status);
}

/* ─── Content checks ─── */

const PHONE = /(?:\+?\d[\s-]?){10,}/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const LINK = /\b(?:https?:\/\/|www\.)\S+/i;

/** Trims, removes control characters and collapses runs of blank lines. */
export function sanitizeText(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Reviews must not share personal contact details or links. Returns the problem, or null when fine. */
export function contentProblem(text: string): string | null {
  if (PHONE.test(text)) return "Remove phone numbers — reviews must not share personal contact details.";
  if (EMAIL.test(text)) return "Remove email addresses — reviews must not share personal contact details.";
  if (LINK.test(text)) return "Links aren't allowed in reviews.";
  if (/(.)\1{14,}/.test(text)) return "Please write a real review.";
  return null;
}

/* ─── Ratings ─── */

export interface RatingStats {
  average: number | null;
  count: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  categories: Record<string, { average: number; count: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Stats from published reviews only (the caller filters by status). Averages are rounded to one decimal
 * from the exact sum, so the result doesn't depend on row order.
 */
export function ratingStats(reviews: Array<{ overallRating: number; categoryRatings: Record<string, number | null | undefined> | null }>): RatingStats {
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as RatingStats["distribution"];
  const sums: Record<string, { sum: number; count: number }> = {};
  let total = 0;
  for (const r of reviews) {
    total += r.overallRating;
    const key = String(Math.min(5, Math.max(1, Math.round(r.overallRating)))) as keyof RatingStats["distribution"];
    distribution[key] += 1;
    for (const [k, v] of Object.entries(r.categoryRatings ?? {})) {
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      sums[k] ??= { sum: 0, count: 0 };
      sums[k].sum += v;
      sums[k].count += 1;
    }
  }
  return {
    average: reviews.length ? round1(total / reviews.length) : null,
    count: reviews.length,
    distribution,
    categories: Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, { average: round1(s.sum / s.count), count: s.count }])),
  };
}

/** Public display name: first name + last initial ("Ravi K."). Full names and contact details stay private. */
export function publicName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "SafeRent user";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0]!;
}

/** The reviewee may edit their one public reply for this long after first posting it. */
export const RESPONSE_EDIT_HOURS = 48;

export function canEditResponse(respondedAt: Date | null, now = new Date()): boolean {
  return !!respondedAt && now.getTime() - respondedAt.getTime() < RESPONSE_EDIT_HOURS * 60 * 60 * 1000;
}
