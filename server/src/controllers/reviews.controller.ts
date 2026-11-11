import { Prisma, type RentalReview } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import {
  DEFAULT_REVIEW_WINDOW_DAYS,
  ELIGIBILITY_MESSAGES,
  PUBLIC_STATUSES,
  canEditResponse,
  categoriesFor,
  contentProblem,
  isPublic,
  publicName,
  ratingStats,
  reviewEligibility,
  reviewerRoleOf,
  sanitizeText,
  tagsFor,
  windowClosesAt,
  type ReviewerRole,
} from "../lib/reviews";
import { parseInput } from "../lib/validation";
import { can, me } from "../middleware/auth";
import { ID_PREFIX } from "../properties/catalog";
import { nextCode } from "../properties/ids";
import { inScope } from "../properties/service";

/*
 * Two-way rental reviews. Every rule about who may review what comes from the lease in the database —
 * never from ids sent by the client. Reviews are optional: nothing in move-out, leases or invitations
 * checks for them.
 */

const DAY = 24 * 60 * 60 * 1000;
const PUBLIC = [...PUBLIC_STATUSES] as Array<"PUBLISHED" | "FLAGGED">;

let windowCache: { at: number; days: number } | null = null;
async function reviewWindowDays(): Promise<number> {
  if (windowCache && Date.now() - windowCache.at < 60_000) return windowCache.days;
  const row = await prisma.platformSetting.findUnique({ where: { key: "review_window_days" } });
  const n = Number(row?.value);
  const days = Number.isInteger(n) && n >= 1 && n <= 60 ? n : DEFAULT_REVIEW_WINDOW_DAYS;
  windowCache = { at: Date.now(), days };
  return days;
}

const leaseSelect = { id: true, code: true, propertyId: true, unitId: true, bedId: true, tenantId: true, landlordId: true, status: true, startDate: true, endDate: true, endedAt: true, property: { select: { id: true, code: true, title: true, city: true, locality: true } } } satisfies Prisma.LeaseSelect;

/**
 * Publishes reviews whose window has closed (the other side never reviewed). Runs before any review
 * read, so results never depend on a timer having fired. Each row is claimed with a conditional update,
 * so concurrent requests publish (and notify) once.
 */
export async function publishDueReviews(): Promise<void> {
  const cutoff = new Date(Date.now() - (await reviewWindowDays()) * DAY);
  const due = await prisma.rentalReview.findMany({ where: { status: "SUBMITTED", lease: { endedAt: { lte: cutoff } } }, select: { id: true, reviewerId: true, revieweeId: true, property: { select: { title: true, code: true } } }, take: 200 });
  for (const r of due) {
    const done = await prisma.rentalReview.updateMany({ where: { id: r.id, status: "SUBMITTED" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    if (!done.count) continue;
    const name = r.property.title ?? r.property.code;
    await notify(r.reviewerId, "Your review is published", `The review window for "${name}" has closed and your review is now visible.`, "/reviews");
    await notify(r.revieweeId, "You received a review", `A review about your rental at "${name}" is now published.`, "/reviews");
  }
}

type ReviewRow = RentalReview & { lease: { startDate: Date; endedAt: Date | null; endDate: Date }; property: { id: string; code: string; title: string | null; city: string | null } };

const reviewInclude = { lease: { select: { startDate: true, endedAt: true, endDate: true } }, property: { select: { id: true, code: true, title: true, city: true } } } satisfies Prisma.RentalReviewInclude;

async function names(ids: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

/** What a viewer may see of a review. Unpublished content is shown only to its author (and moderators). */
async function present(rows: ReviewRow[], viewerId: string, moderator = false) {
  const [who, places] = await Promise.all([names(rows.flatMap((r) => [r.reviewerId, r.revieweeId])), placeLabels(rows)]);
  return rows.map((r) => {
    const mine = r.reviewerId === viewerId;
    const visible = isPublic(r.status) || mine || moderator;
    const responseVisible = !!r.responseText && (!r.responseHidden || moderator || r.revieweeId === viewerId);
    return {
      id: r.id,
      code: r.code,
      leaseId: r.leaseId,
      property: { id: r.property.id, code: r.property.code, name: r.property.title ?? r.property.code, city: r.property.city },
      place: placeOf(places, r),
      stay: { from: r.lease.startDate, to: r.lease.endedAt ?? r.lease.endDate },
      reviewerRole: r.reviewerRole,
      revieweeRole: r.revieweeRole,
      reviewerName: moderator ? (who.get(r.reviewerId) ?? null) : publicName(who.get(r.reviewerId)),
      revieweeName: moderator ? (who.get(r.revieweeId) ?? null) : publicName(who.get(r.revieweeId)),
      status: r.status,
      submittedAt: r.submittedAt,
      publishedAt: r.publishedAt,
      overallRating: visible ? r.overallRating : null,
      categoryRatings: visible ? r.categoryRatings : null,
      reviewText: visible ? r.reviewText : null,
      tags: visible ? r.tags : null,
      evidence: visible ? r.evidence : null,
      response: responseVisible ? { text: r.responseText, respondedAt: r.respondedAt, editedAt: r.responseEditedAt, hidden: r.responseHidden } : null,
      moderationNote: mine || moderator ? r.moderationNote : null,
      isMine: mine,
      canRespond: r.revieweeId === viewerId && isPublic(r.status) && (!r.respondedAt || canEditResponse(r.respondedAt)),
      canReport: !mine && isPublic(r.status),
      ...(moderator ? { reviewerId: r.reviewerId, revieweeId: r.revieweeId, landlordId: r.landlordId, tenantId: r.tenantId } : {}),
    };
  });
}

/* ─────────────── Reviewer side ─────────────── */

/** GET /api/v1/reviews/pending — finished leases I can still review (and until when). */
export async function pendingReviews(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await publishDueReviews();
  const days = await reviewWindowDays();
  const leases = await prisma.lease.findMany({
    where: {
      OR: [{ tenantId: user.id }, { landlordId: user.id }],
      status: { in: ["ENDED", "TERMINATED"] },
      endedAt: { gt: new Date(Date.now() - days * DAY) },
      reviews: { none: { reviewerId: user.id } },
    },
    select: { ...leaseSelect, reviews: { select: { reviewerRole: true } } },
    orderBy: { endedAt: "desc" },
    take: 50,
  });
  const [places, who] = await Promise.all([placeLabels(leases), names(leases.flatMap((l) => [l.tenantId, l.landlordId]))]);
  const items = leases
    .map((l) => ({ l, e: reviewEligibility(l, user.id, { windowDays: days, alreadyReviewed: false }) }))
    .filter((x) => x.e.eligible)
    .map(({ l, e }) => {
      const role = (e as { role: ReviewerRole }).role;
      return {
        leaseId: l.id,
        leaseCode: l.code,
        role,
        question: role === "TENANT" ? "How was your rental experience with this landlord?" : "How was your rental experience with this tenant?",
        property: { id: l.property.id, name: l.property.title ?? l.property.code, city: l.property.city },
        place: placeOf(places, l),
        otherPartyName: publicName(who.get(role === "TENANT" ? l.landlordId : l.tenantId)),
        stay: { from: l.startDate, to: l.endedAt },
        closesAt: (e as { closesAt: Date }).closesAt,
        // Only *whether* the other side has reviewed — never what they wrote.
        otherPartySubmitted: l.reviews.some((r) => r.reviewerRole !== role),
      };
    });
  res.json({ items });
}

async function partyLease(req: Request) {
  const user = me(req);
  const lease = await prisma.lease.findUnique({ where: { id: idParam(req) }, select: leaseSelect });
  // Not a party → same answer as "doesn't exist".
  if (!lease || (!reviewerRoleOf(lease, user.id) && !can(req, "reviews.moderate"))) fail("not-found", REASONS.NOT_FOUND, "Lease not found.");
  return lease;
}

/** GET /api/v1/leases/:id/review — eligibility, my review and publication status for one lease. */
export async function leaseReviewStatus(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await publishDueReviews();
  const lease = await partyLease(req);
  const days = await reviewWindowDays();
  const reviews = await prisma.rentalReview.findMany({ where: { leaseId: lease.id }, include: reviewInclude });
  const mine = reviews.find((r) => r.reviewerId === user.id) ?? null;
  const role = reviewerRoleOf(lease, user.id);
  const e = reviewEligibility(lease, user.id, { windowDays: days, alreadyReviewed: !!mine });
  const presented = await present(reviews.filter((r) => r.id === mine?.id || isPublic(r.status)), user.id, can(req, "reviews.moderate") && !role);
  res.json({
    leaseId: lease.id,
    role,
    eligible: e.eligible,
    reason: e.eligible ? null : e.reason,
    message: e.eligible ? null : ELIGIBILITY_MESSAGES[e.reason],
    closesAt: lease.endedAt ? windowClosesAt(lease.endedAt, days) : null,
    otherPartySubmitted: role ? reviews.some((r) => r.reviewerRole !== role) : null,
    myReview: presented.find((r) => r.isMine) ?? null,
    published: presented.filter((r) => isPublic(r.status)),
    form: role ? { categories: categoriesFor(role).map(([key, label]) => ({ key, label, required: key === "overall" })), tags: tagsFor(role) } : null,
  });
}

const rating = z.coerce.number().int().min(1).max(5);
const submitSchema = z
  .object({
    ratings: z.record(z.string(), rating.nullable()),
    text: z.string().max(3000).optional(),
    tags: z.array(z.string()).max(8).optional(),
    inspectionIds: z.array(z.string().uuid()).max(5).optional(),
  })
  .strict();

export type ReviewInput = z.infer<typeof submitSchema>;
type PartyLease = Awaited<ReturnType<typeof partyLeaseById>>;

async function partyLeaseById(id: string) {
  return prisma.lease.findUnique({ where: { id }, select: leaseSelect });
}

/** Validates a review for this side of the lease (also used to check a draft attached to a close request). */
export async function prepareReview(role: ReviewerRole, lease: { id: string; propertyId: string }, raw: unknown) {
  const input = parseInput(submitSchema, raw);
  const allowed = new Set<string>(categoriesFor(role).map(([k]) => k));
  const unknown = Object.keys(input.ratings).filter((k) => !allowed.has(k));
  if (unknown.length) fail("invalid-argument", REASONS.INVALID_INPUT, `Unknown rating: ${unknown[0]}.`);
  const overall = input.ratings.overall;
  if (!overall) fail("invalid-argument", REASONS.INVALID_INPUT, "Give an overall rating from 1 to 5.");
  const categoryRatings = Object.fromEntries(Object.entries(input.ratings).filter(([, v]) => v !== null)) as Record<string, number>;
  const text = input.text ? sanitizeText(input.text) : "";
  if (text) {
    const problem = contentProblem(text);
    if (problem) fail("invalid-argument", REASONS.INVALID_INPUT, problem);
  }
  const allowedTags = new Set(tagsFor(role));
  const tags = [...new Set(input.tags ?? [])];
  if (tags.some((t) => !allowedTags.has(t))) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose tags from the list.");
  let evidence: Prisma.InputJsonValue | undefined;
  if (input.inspectionIds?.length) {
    // Evidence can only be inspections of this lease's property, linked to this lease.
    const ok = await prisma.propertyInspection.count({ where: { id: { in: input.inspectionIds }, propertyId: lease.propertyId, leaseId: lease.id } });
    if (ok !== new Set(input.inspectionIds).size) fail("invalid-argument", REASONS.INVALID_INPUT, "Evidence must be inspections of this lease.");
    evidence = { inspectionIds: [...new Set(input.inspectionIds)] };
  }
  return { overall: overall!, categoryRatings, text, tags, evidence, raw: { ...input, text: text || undefined, tags } };
}

/**
 * Creates the review (eligibility re-checked from the lease) and, when the other side has already
 * reviewed, publishes both together. Shared by POST /leases/:id/review and the lease-close flow.
 */
export async function createReview(leaseId: string, userId: string, raw: unknown, actor: Request): Promise<{ reviewId: string; code: string; status: "PUBLISHED" | "SUBMITTED" }> {
  const lease: NonNullable<PartyLease> = found(await partyLeaseById(leaseId), "Lease");
  const days = await reviewWindowDays();
  const existing = await prisma.rentalReview.count({ where: { leaseId: lease.id, reviewerId: userId } });
  const e = reviewEligibility(lease, userId, { windowDays: days, alreadyReviewed: existing > 0 });
  if (!e.eligible) fail(e.reason === "NOT_A_PARTY" ? "permission-denied" : "failed-precondition", e.reason === "NOT_A_PARTY" ? REASONS.PERMISSION_DENIED : REASONS.INVALID_STATE, ELIGIBILITY_MESSAGES[e.reason]);
  const role = e.role;
  const r = await prepareReview(role, lease, raw);

  const otherRole: ReviewerRole = role === "TENANT" ? "LANDLORD" : "TENANT";
  let result: { review: RentalReview; publishedBoth: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      const review = await tx.rentalReview.create({
        data: {
          code: await nextCode(tx, ID_PREFIX.REVIEW),
          leaseId: lease.id,
          propertyId: lease.propertyId,
          unitId: lease.unitId,
          bedId: lease.bedId,
          landlordId: lease.landlordId,
          tenantId: lease.tenantId,
          reviewerId: userId,
          reviewerRole: role,
          revieweeId: role === "TENANT" ? lease.landlordId : lease.tenantId,
          revieweeRole: otherRole,
          overallRating: r.overall,
          categoryRatings: r.categoryRatings,
          reviewText: r.text || null,
          tags: r.tags.length ? r.tags : undefined,
          evidence: r.evidence,
        },
      });
      const other = await tx.rentalReview.findFirst({ where: { leaseId: lease.id, reviewerRole: otherRole, status: "SUBMITTED" } });
      let publishedBoth = false;
      if (other) {
        await tx.rentalReview.updateMany({ where: { id: { in: [review.id, other.id] }, status: "SUBMITTED" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
        publishedBoth = true;
      }
      await logActivity(actor, "review.submit", "rental_review", review.id, { leaseId: lease.id, role }, tx);
      return { review, publishedBoth };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") fail("already-exists", REASONS.CONFLICT, ELIGIBILITY_MESSAGES.ALREADY_REVIEWED);
    throw err;
  }

  const name = lease.property.title ?? lease.property.code;
  const otherId = role === "TENANT" ? lease.landlordId : lease.tenantId;
  if (result.publishedBoth) {
    for (const id of [userId, otherId]) await notify(id, "Reviews published", `Both reviews for "${name}" are now visible.`, "/reviews");
  } else {
    // No content, no rating — only that a review exists and the deadline.
    await notify(otherId, role === "TENANT" ? "Your tenant left a review" : "Your landlord left a review", `Share your own experience of "${name}" by ${windowClosesAt(lease.endedAt!, days).toDateString()}. Both reviews are revealed together.`, "/reviews");
  }
  return { reviewId: result.review.id, code: result.review.code, status: result.publishedBoth ? "PUBLISHED" : "SUBMITTED" };
}

/**
 * POST /api/v1/leases/:id/review — submit my review of this lease. Role, landlord, tenant, property and
 * unit all come from the lease. Submitted reviews can't be edited (only moderated).
 */
export async function submitReview(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await consumeRateLimit(`review-submit:${user.id}`, RATE_LIMITS.REVIEW_SUBMIT.limit, RATE_LIMITS.REVIEW_SUBMIT.windowMs);
  const lease = await partyLease(req);
  const out = await createReview(lease.id, user.id, req.body, req);
  res.locals.message = out.status === "PUBLISHED" ? "Thanks! Both reviews are now published." : "Thanks! Your review will be published when the other side reviews, or when the review window closes.";
  res.status(201).json(out);
}

/** GET /api/v1/reviews/mine?direction=written|received */
export async function myReviews(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await publishDueReviews();
  const p = pagination(req);
  const written = req.query.direction === "written";
  const where: Prisma.RentalReviewWhereInput = written ? { reviewerId: user.id } : { revieweeId: user.id, status: { in: PUBLIC } };
  const [rows, total, statsRows] = await Promise.all([
    prisma.rentalReview.findMany({ where, include: reviewInclude, orderBy: { submittedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.rentalReview.count({ where }),
    written ? Promise.resolve([]) : prisma.rentalReview.findMany({ where: { revieweeId: user.id, status: { in: PUBLIC } }, select: { revieweeRole: true, overallRating: true, categoryRatings: true } }),
  ]);
  const byRole = (r: ReviewerRole) => ratingStats(statsRows.filter((x) => x.revieweeRole === r).map((x) => ({ overallRating: x.overallRating, categoryRatings: x.categoryRatings as Record<string, number> })));
  res.json({ ...paged(await present(rows, user.id), total, p), stats: written ? null : { asLandlord: byRole("LANDLORD"), asTenant: byRole("TENANT") } });
}

/** Reviews about a tenant are shown only to that tenant, moderators and landlords they've dealt with. */
async function canSeeTenantReviews(req: Request, tenantId: string): Promise<boolean> {
  const user = me(req);
  if (user.id === tenantId || can(req, "reviews.moderate")) return true;
  const [leases, applications, invites] = await Promise.all([
    prisma.lease.count({ where: { tenantId, landlordId: user.id } }),
    prisma.rentalApplication.count({ where: { tenantId, property: { ownerId: user.id } } }),
    prisma.tenantInvitation.count({ where: { landlordId: user.id, respondedById: tenantId } }),
  ]);
  return leases + applications + invites > 0;
}

/** GET /api/v1/reviews/users/:userId?as=LANDLORD|TENANT — rating summary and published reviews of one person. */
export async function userReviews(req: Request, res: Response): Promise<void> {
  const as = (req.query.as === "TENANT" ? "TENANT" : "LANDLORD") as ReviewerRole;
  const userId = idParam(req, "userId");
  if (as === "TENANT" && !(await canSeeTenantReviews(req, userId))) fail("permission-denied", REASONS.PERMISSION_DENIED, "Tenant reviews are shared only with landlords this tenant has rented from or applied to.");
  await publishDueReviews();
  const p = pagination(req);
  const where: Prisma.RentalReviewWhereInput = { revieweeId: userId, revieweeRole: as, status: { in: PUBLIC } };
  const [rows, total, all, person] = await Promise.all([
    prisma.rentalReview.findMany({ where, include: reviewInclude, orderBy: { publishedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.rentalReview.count({ where }),
    prisma.rentalReview.findMany({ where, select: { overallRating: true, categoryRatings: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
  ]);
  res.json({
    ...paged(await present(rows, me(req).id), total, p),
    person: { id: userId, name: publicName(person?.fullName), role: as },
    stats: ratingStats(all.map((x) => ({ overallRating: x.overallRating, categoryRatings: x.categoryRatings as Record<string, number> }))),
  });
}

/**
 * GET /api/v1/properties/:propertyId/reviews?unitId= — the property's rating (tenants' reviews of their
 * stay there). With unitId: that flat / room only. A review of Flat 102 counts for Flat 102 and the
 * building, never for other flats.
 */
export async function propertyReviews(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const propertyId = idParam(req, "propertyId");
  const property = found(await prisma.property.findUnique({ where: { id: propertyId }, select: { id: true, title: true, code: true, publicationStatus: true } }), "Property");
  const allowed =
    property.publicationStatus === "PUBLISHED" || can(req, "reviews.moderate") || (await inScope(req, "properties.view", propertyId)) || (await prisma.lease.count({ where: { propertyId, tenantId: user.id } })) > 0;
  if (!allowed) fail("not-found", REASONS.NOT_FOUND, "Property not found.");
  await publishDueReviews();
  const unitId = typeof req.query.unitId === "string" && req.query.unitId ? req.query.unitId : undefined;
  const p = pagination(req);
  const where: Prisma.RentalReviewWhereInput = { propertyId, reviewerRole: "TENANT", status: { in: PUBLIC }, ...(unitId ? { OR: [{ unitId }, { bedId: unitId }] } : {}) };
  const [rows, total, all] = await Promise.all([
    prisma.rentalReview.findMany({ where, include: reviewInclude, orderBy: { publishedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.rentalReview.count({ where }),
    prisma.rentalReview.findMany({ where, select: { overallRating: true, categoryRatings: true } }),
  ]);
  res.json({ ...paged(await present(rows, user.id), total, p), property: { id: property.id, name: property.title ?? property.code }, unitId: unitId ?? null, stats: ratingStats(all.map((x) => ({ overallRating: x.overallRating, categoryRatings: x.categoryRatings as Record<string, number> }))) });
}

const responseSchema = z.object({ text: z.string().min(2).max(1500) }).strict();

/** PUT /api/v1/reviews/:id/response — the reviewed person's one public reply (editable for 48 hours). */
export async function respondToReview(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const review = found(await prisma.rentalReview.findUnique({ where: { id: idParam(req) }, include: { property: { select: { title: true, code: true } } } }), "Review");
  if (review.revieweeId !== user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the person who was reviewed can reply.");
  if (!isPublic(review.status)) fail("failed-precondition", REASONS.INVALID_STATE, "You can reply once the review is published.");
  if (review.respondedAt && !canEditResponse(review.respondedAt)) fail("failed-precondition", REASONS.INVALID_STATE, "Replies can be edited only within 48 hours of posting.");
  if (review.responseHidden) fail("failed-precondition", REASONS.INVALID_STATE, "This reply was hidden by SafeRent moderation.");
  const text = sanitizeText(parseInput(responseSchema, req.body).text);
  const problem = contentProblem(text);
  if (problem) fail("invalid-argument", REASONS.INVALID_INPUT, problem);
  const first = !review.respondedAt;
  await prisma.rentalReview.update({ where: { id: review.id }, data: first ? { responseText: text, respondedAt: new Date() } : { responseText: text, responseEditedAt: new Date() } });
  await logActivity(req, first ? "review.respond" : "review.respond_edit", "rental_review", review.id);
  if (first) await notify(review.reviewerId, "Reply to your review", `There's a reply to your review of "${review.property.title ?? review.property.code}".`, "/reviews");
  res.locals.message = first ? "Reply posted" : "Reply updated";
  res.json({ ok: true });
}

const REPORT_REASONS = ["FALSE_INFORMATION", "HARASSMENT", "PERSONAL_INFORMATION", "DISCRIMINATORY", "SPAM", "IRRELEVANT", "OTHER"] as const;
const reportSchema = z
  .object({ reason: z.enum(REPORT_REASONS), description: z.string().trim().max(1000).optional() })
  .strict()
  .refine((v) => v.reason !== "OTHER" || (v.description ?? "").length >= 10, { message: "Tell us what's wrong (at least 10 characters).", path: ["description"] });

/** POST /api/v1/reviews/:id/report — flags the review for moderators. It stays visible until a moderator decides. */
export async function reportReview(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await consumeRateLimit(`review-report:${user.id}`, RATE_LIMITS.REVIEW_REPORT.limit, RATE_LIMITS.REVIEW_REPORT.windowMs);
  const review = found(await prisma.rentalReview.findUnique({ where: { id: idParam(req) } }), "Review");
  if (!isPublic(review.status)) fail("not-found", REASONS.NOT_FOUND, "Review not found.");
  if (review.reviewerId === user.id) fail("failed-precondition", REASONS.INVALID_STATE, "You can't report your own review.");
  const input = parseInput(reportSchema, req.body);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.reviewReport.create({ data: { reviewId: review.id, reportedById: user.id, reason: input.reason, description: input.description ? sanitizeText(input.description) : null } });
      await tx.rentalReview.updateMany({ where: { id: review.id, status: "PUBLISHED" }, data: { status: "FLAGGED" } });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") fail("already-exists", REASONS.CONFLICT, "You've already reported this review.");
    throw err;
  }
  res.locals.message = "Thanks — SafeRent will look at this review.";
  res.status(201).json({ ok: true });
}

/* ─────────────── Moderation (reviews.moderate) ─────────────── */

const STATUSES = ["SUBMITTED", "PUBLISHED", "FLAGGED", "UNDER_REVIEW", "REMOVED", "REJECTED"] as const;

/** GET /api/v1/moderation/reviews?status=&rating=&q= — q matches review code, property, landlord or tenant name. */
export async function moderationListReviews(req: Request, res: Response): Promise<void> {
  await publishDueReviews();
  const p = pagination(req);
  const status = enumQuery(req, "status", STATUSES);
  const ratingQ = Number(req.query.rating);
  const and: Prisma.RentalReviewWhereInput[] = [];
  // Unpublished reviews stay sealed even for moderators unless they're reported or acted on.
  and.push(status ? { status } : { status: { not: "SUBMITTED" } });
  if (Number.isInteger(ratingQ) && ratingQ >= 1 && ratingQ <= 5) and.push({ overallRating: ratingQ });
  if (p.q) {
    const people = await prisma.user.findMany({ where: { OR: [{ fullName: { contains: p.q } }, { phoneNumber: { contains: p.q } }] }, select: { id: true }, take: 50 });
    const ids = people.map((u) => u.id);
    and.push({ OR: [{ code: p.q }, { property: { title: { contains: p.q } } }, { property: { code: p.q } }, { landlordId: { in: ids } }, { tenantId: { in: ids } }] });
  }
  const where: Prisma.RentalReviewWhereInput = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.rentalReview.findMany({ where, include: { ...reviewInclude, _count: { select: { reports: { where: { status: "OPEN" } } } } }, orderBy: { submittedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.rentalReview.count({ where }),
  ]);
  const presented = await present(rows, me(req).id, true);
  res.json(paged(presented.map((r, i) => ({ ...r, openReports: rows[i]!._count.reports })), total, p));
}

/** GET /api/v1/moderation/reviews/:id — full review with reports and moderation history. */
export async function moderationGetReview(req: Request, res: Response): Promise<void> {
  const review = found(await prisma.rentalReview.findUnique({ where: { id: idParam(req) }, include: { ...reviewInclude, reports: { orderBy: { createdAt: "desc" } }, logs: { orderBy: { createdAt: "desc" } } } }), "Review");
  const [presented] = await present([review], me(req).id, true);
  const who = await names([...review.reports.flatMap((r) => [r.reportedById, r.reviewedById ?? ""]), ...review.logs.map((l) => l.moderatorId)].filter(Boolean));
  res.json({
    review: presented,
    reports: review.reports.map((r) => ({ ...r, reportedBy: who.get(r.reportedById) ?? null, reviewedBy: r.reviewedById ? (who.get(r.reviewedById) ?? null) : null })),
    history: review.logs.map((l) => ({ ...l, moderator: who.get(l.moderatorId) ?? null })),
  });
}

const ACTIONS = {
  HIDE: { from: ["PUBLISHED", "FLAGGED", "UNDER_REVIEW"], to: "REMOVED" },
  RESTORE: { from: ["REMOVED", "FLAGGED", "UNDER_REVIEW", "REJECTED"], to: "PUBLISHED" },
  UNDER_REVIEW: { from: ["PUBLISHED", "FLAGGED"], to: "UNDER_REVIEW" },
  REJECT: { from: ["SUBMITTED", "UNDER_REVIEW", "FLAGGED"], to: "REJECTED" },
  HIDE_RESPONSE: { from: null, to: null },
  RESTORE_RESPONSE: { from: null, to: null },
} as const;
const moderateSchema = z.object({ action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS, ...Array<keyof typeof ACTIONS>]), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500) }).strict();

/**
 * POST /api/v1/moderation/reviews/:id — hide, restore, put under review or reject a review, or hide its
 * reply. Ratings and text are never changed; every action is logged with its reason.
 */
export async function moderateReview(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const review = found(await prisma.rentalReview.findUnique({ where: { id: idParam(req) }, include: { property: { select: { title: true, code: true } } } }), "Review");
  if ([review.reviewerId, review.revieweeId].includes(user.id)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can't moderate a review you're part of.");
  const { action, reason } = parseInput(moderateSchema, req.body);
  const rule = ACTIONS[action];
  await prisma.$transaction(async (tx) => {
    if (rule.to) {
      if (!(rule.from as readonly string[]).includes(review.status)) fail("failed-precondition", REASONS.INVALID_STATE, `Can't ${action.toLowerCase().replace("_", " ")} a ${review.status.toLowerCase()} review.`);
      const r = await tx.rentalReview.updateMany({ where: { id: review.id, status: review.status }, data: { status: rule.to, moderationNote: reason, ...(rule.to === "PUBLISHED" && !review.publishedAt ? { publishedAt: new Date() } : {}) } });
      if (!r.count) fail("failed-precondition", REASONS.INVALID_STATE, "This review was just changed. Refresh and try again.");
    } else {
      if (!review.responseText) fail("failed-precondition", REASONS.INVALID_STATE, "This review has no reply.");
      await tx.rentalReview.update({ where: { id: review.id }, data: { responseHidden: action === "HIDE_RESPONSE" } });
    }
    await tx.reviewModerationLog.create({ data: { reviewId: review.id, action, fromStatus: review.status, toStatus: rule.to ?? review.status, reason, moderatorId: user.id } });
    await logActivity(req, `review.${action.toLowerCase()}`, "rental_review", review.id, { from: review.status, to: rule.to ?? review.status, reason }, tx);
  });
  const name = review.property.title ?? review.property.code;
  if (action === "HIDE" || action === "REJECT") await notify(review.reviewerId, "Review removed by SafeRent", `Your review of "${name}" was removed: ${reason}`, "/reviews");
  if (action === "RESTORE") await notify(review.reviewerId, "Review restored", `Your review of "${name}" is visible again.`, "/reviews");
  if (action === "HIDE_RESPONSE") await notify(review.revieweeId, "Reply hidden by SafeRent", `Your reply on a review of "${name}" was hidden: ${reason}`, "/reviews");
  res.locals.message = "Moderation action recorded";
  res.json({ ok: true });
}

/** GET /api/v1/moderation/review-reports?status=OPEN */
export async function moderationListReports(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = enumQuery(req, "status", ["OPEN", "UPHELD", "DISMISSED"] as const) ?? "OPEN";
  const where: Prisma.ReviewReportWhereInput = { status };
  const [rows, total] = await Promise.all([
    prisma.reviewReport.findMany({ where, include: { review: { select: { id: true, code: true, status: true, overallRating: true, reviewText: true, reviewerRole: true, property: { select: { title: true, code: true } } } } }, orderBy: { createdAt: "asc" }, skip: p.skip, take: p.take }),
    prisma.reviewReport.count({ where }),
  ]);
  const who = await names(rows.map((r) => r.reportedById));
  res.json(paged(rows.map((r) => ({ ...r, reportedBy: who.get(r.reportedById) ?? null })), total, p));
}

const resolveSchema = z.object({ decision: z.enum(["UPHELD", "DISMISSED"]), resolution: z.string().trim().min(5).max(500) }).strict();

/**
 * POST /api/v1/moderation/review-reports/:id — close a report. Upholding does not delete the review by
 * itself: use HIDE on the review. Dismissing the last open report un-flags the review.
 */
export async function resolveReviewReport(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const report = found(await prisma.reviewReport.findUnique({ where: { id: idParam(req) }, include: { review: true } }), "Report");
  if (report.status !== "OPEN") fail("failed-precondition", REASONS.INVALID_STATE, "This report is already closed.");
  if ([report.review.reviewerId, report.review.revieweeId].includes(user.id)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can't moderate a review you're part of.");
  const { decision, resolution } = parseInput(resolveSchema, req.body);
  await prisma.$transaction(async (tx) => {
    const r = await tx.reviewReport.updateMany({ where: { id: report.id, status: "OPEN" }, data: { status: decision, resolution, reviewedById: user.id, resolvedAt: new Date() } });
    if (!r.count) fail("failed-precondition", REASONS.INVALID_STATE, "This report is already closed.");
    const open = await tx.reviewReport.count({ where: { reviewId: report.reviewId, status: "OPEN" } });
    if (!open && report.review.status === "FLAGGED" && decision === "DISMISSED") {
      await tx.rentalReview.update({ where: { id: report.reviewId }, data: { status: "PUBLISHED" } });
    }
    await tx.reviewModerationLog.create({ data: { reviewId: report.reviewId, action: `REPORT_${decision}`, fromStatus: report.review.status, toStatus: null, reason: resolution, moderatorId: user.id } });
    await logActivity(req, `review_report.${decision.toLowerCase()}`, "review_report", report.id, { reviewId: report.reviewId, resolution }, tx);
  });
  await notify(report.reportedById, "Your report was reviewed", decision === "UPHELD" ? "Thanks — we acted on the review you reported." : `We reviewed your report and kept the review: ${resolution}`, "/reviews");
  res.locals.message = "Report closed";
  res.json({ ok: true });
}
