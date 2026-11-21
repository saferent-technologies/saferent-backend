import type { Request, Response } from "express";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { maskPhone } from "../lib/mask";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { ensureSafeRentId, normalizePhone, normalizeSafeRentId } from "../lib/safeRentId";
import { hasRole, me } from "../middleware/auth";
import { ROLE_INFO } from "../rbac/catalog";

/*
 * Landlord tools to find a tenant:
 *  - GET /users/lookup?phone= | ?safeRentId=   → a small public card (to invite them)
 *  - GET /tenants/report?phone= | ?safeRentId= → their rental history on SafeRent
 * Landlords only, rate limited, every lookup is logged (who looked up whom, ids only).
 * Never returns the full phone number, email, address or date of birth.
 */

function requireLandlord(req: Request): void {
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only landlords can look up tenants.");
}

/** The account named by ?phone= or ?safeRentId= (active, not staff, not yourself), else 404. */
async function findTarget(req: Request) {
  const phoneRaw = typeof req.query.phone === "string" ? req.query.phone.trim() : "";
  const idRaw = typeof req.query.safeRentId === "string" ? req.query.safeRentId.trim() : "";
  if (!phoneRaw && !idRaw) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a phone number or a SafeRent ID.");
  let where: { phoneNumber: string } | { safeRentId: string };
  if (phoneRaw) {
    const phone = normalizePhone(phoneRaw);
    if (!phone) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a valid 10-digit mobile number.");
    where = { phoneNumber: phone };
  } else {
    const id = normalizeSafeRentId(idRaw);
    if (!id) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a valid SafeRent ID, like SR-USER-000123.");
    where = { safeRentId: id };
  }
  const user = await prisma.user.findFirst({
    where: { ...where, accountStatus: "ACTIVE" },
    select: { id: true, fullName: true, safeRentId: true, phoneNumber: true, phoneVerified: true, city: true, role: true, createdAt: true, tenantProfile: { select: { currentCity: true } } },
  });
  // Staff accounts and yourself are "not found" too (nothing to learn from probing).
  if (!user || ROLE_INFO[user.role].isStaff || user.id === me(req).id) fail("not-found", REASONS.NOT_FOUND, "No SafeRent account found. Check the number or ID, or invite them by phone.");
  return { ...user, safeRentId: await ensureSafeRentId(user.id, user.safeRentId), by: phoneRaw ? "phone" : "safeRentId" };
}

function card(u: Awaited<ReturnType<typeof findTarget>>) {
  return {
    id: u.id,
    fullName: u.fullName,
    safeRentId: u.safeRentId,
    phoneMasked: u.phoneNumber ? maskPhone(u.phoneNumber) : null,
    city: u.city ?? u.tenantProfile?.currentCity ?? null,
    verified: u.phoneVerified,
    memberSince: u.createdAt,
  };
}

/** GET /api/v1/users/lookup?phone= | ?safeRentId= (landlord) → { id, fullName, safeRentId, phoneMasked, city, verified, memberSince } */
export async function landlordUserLookup(req: Request, res: Response): Promise<void> {
  requireLandlord(req);
  const viewer = me(req);
  await consumeRateLimit(`user-lookup:${viewer.id}`, RATE_LIMITS.USER_LOOKUP.limit, RATE_LIMITS.USER_LOOKUP.windowMs);
  const u = await findTarget(req);
  await logActivity(req, "user.lookup", "user", u.id, { by: u.by });
  res.json(card(u));
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * GET /api/v1/tenants/report?phone= | ?safeRentId= (landlord)
 * Published reviews landlords wrote about the tenant, their SafeRent leases and rent payment record.
 */
export async function tenantReport(req: Request, res: Response): Promise<void> {
  requireLandlord(req);
  const viewer = me(req);
  await consumeRateLimit(`tenant-report:${viewer.id}`, RATE_LIMITS.TENANT_REPORT.limit, RATE_LIMITS.TENANT_REPORT.windowMs);
  const u = await findTarget(req);

  const [reviewRows, leases, dues] = await Promise.all([
    prisma.rentalReview.findMany({
      where: { revieweeId: u.id, revieweeRole: "TENANT", reviewerRole: "LANDLORD", status: { in: ["PUBLISHED", "FLAGGED"] } },
      orderBy: { publishedAt: "desc" },
      take: 50,
      select: { overallRating: true, reviewText: true, tags: true, reviewerId: true, unitId: true, bedId: true, publishedAt: true, submittedAt: true, property: { select: { title: true, code: true, locality: true, city: true } } },
    }),
    prisma.lease.findMany({
      where: { tenantId: u.id, status: { in: ["ACTIVE", "ENDED", "TERMINATED"] } },
      orderBy: { startDate: "desc" },
      take: 50,
      select: { startDate: true, endDate: true, endedAt: true, status: true, monthlyRent: true, property: { select: { title: true, code: true, city: true } } },
    }),
    prisma.rentPayment.findMany({
      where: { tenantId: u.id, status: { not: "WAIVED" }, dueDate: { lt: new Date() } },
      orderBy: { dueDate: "desc" },
      take: 500,
      select: { period: true, amount: true, status: true, dueDate: true, paidAt: true },
    }),
  ]);

  const reviewers = await prisma.user.findMany({ where: { id: { in: [...new Set(reviewRows.map((r) => r.reviewerId))] } }, select: { id: true, fullName: true } });
  const nameOf = new Map(reviewers.map((r) => [r.id, r.fullName]));
  const places = await placeLabels(reviewRows);
  const reviews = reviewRows.map((r) => {
    const flat = placeOf(places, r);
    const where = [flat, r.property.title ?? r.property.code, r.property.locality ?? r.property.city].filter(Boolean).join(", ");
    return {
      rating: r.overallRating,
      comment: r.reviewText,
      tags: Array.isArray(r.tags) ? r.tags : [],
      landlordName: nameOf.get(r.reviewerId) ?? null,
      place: where || null,
      createdAt: r.publishedAt ?? r.submittedAt,
    };
  });
  const average = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : null;

  // Past dues only. On time = paid by the end of the due date; late = paid after it; missed = still unpaid
  // (or only partly paid) after the due date.
  const graded = dues.map((d) => {
    const endOfDue = new Date(d.dueDate);
    endOfDue.setUTCHours(23, 59, 59, 999);
    const status: "PAID" | "LATE" | "MISSED" = d.status === "PAID" && d.paidAt ? (d.paidAt <= endOfDue ? "PAID" : "LATE") : "MISSED";
    return { period: d.period, amount: d.amount.toFixed(2), status, paidOn: d.status === "PAID" && d.paidAt ? day(d.paidAt) : null };
  });

  await logActivity(req, "tenant.report", "user", u.id, { by: u.by, reviews: reviews.length, leases: leases.length });
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    user: card(u),
    reviewStats: { average, count: reviews.length },
    reviews,
    leases: leases.map((l) => ({
      propertyTitle: l.property.title ?? l.property.code,
      city: l.property.city,
      startDate: day(l.startDate),
      endDate: day(l.endedAt ?? l.endDate),
      status: l.status,
      monthlyRent: l.monthlyRent.toFixed(2),
    })),
    payments: {
      total: graded.length,
      onTime: graded.filter((g) => g.status === "PAID").length,
      late: graded.filter((g) => g.status === "LATE").length,
      missed: graded.filter((g) => g.status === "MISSED").length,
      recent: graded.slice(0, 12),
    },
  });
}
