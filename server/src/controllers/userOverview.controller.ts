import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { fail } from "../lib/errors";
import { idParam } from "../lib/http";
import { REASONS } from "../config/constants";
import { can } from "../middleware/auth";
import { placeLabels, placeOf } from "../lib/places";
import { ratingStats } from "../lib/reviews";
import { walletSummary } from "../services/referral.service";

/*
 * GET /api/v1/users/:id/overview — "everything about this user" for staff, one call.
 * Each section is included ONLY if the viewer's role has that permission across all records (ALL scope),
 * so Super Admin sees everything, Finance sees money, Support sees tickets, and so on. Hidden sections are
 * simply absent (the client shows what it gets). Recent items only (10–20); the full lists live on their
 * own pages.
 */

const N = 10;
const money = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : Number(v.toString()).toFixed(2));

export async function userOverview(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, fullName: true, role: true, accountStatus: true, createdAt: true, lastLoginAt: true, phoneNumber: true, email: true, extraRoles: { select: { role: true } } } });
  if (!user) fail("not-found", REASONS.NOT_FOUND, "User not found.");
  const all = (perm: Parameters<typeof can>[1]) => can(req, perm, "ALL");
  const out: Record<string, unknown> = {
    user: { id: user.id, fullName: user.fullName, roles: [user.role, ...user.extraRoles.map((r) => r.role)], accountStatus: user.accountStatus, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt },
    sections: [] as string[],
  };
  const add = (key: string, value: unknown) => {
    out[key] = value;
    (out.sections as string[]).push(key);
  };
  const jobs: Array<Promise<void>> = [];

  if (all("properties.view")) {
    jobs.push(
      (async () => {
        const where = { ownerId: id };
        const [items, total, byStatus] = await Promise.all([
          prisma.property.findMany({ where, orderBy: { createdAt: "desc" }, take: N, select: { id: true, code: true, title: true, city: true, propertyTypeKey: true, publicationStatus: true, activeStatus: true, verificationStatus: true, availableCount: true, occupiedCount: true, createdAt: true } }),
          prisma.property.count({ where }),
          prisma.property.groupBy({ by: ["publicationStatus"], where, _count: { _all: true } }),
        ]);
        add("properties", { total, byStatus: Object.fromEntries(byStatus.map((b) => [b.publicationStatus, b._count._all])), items });
      })(),
    );
  }

  if (all("leases.view")) {
    jobs.push(
      (async () => {
        const where = { OR: [{ tenantId: id }, { landlordId: id }] };
        const [items, total, active] = await Promise.all([
          prisma.lease.findMany({ where, orderBy: { startDate: "desc" }, take: N, select: { id: true, code: true, status: true, startDate: true, endDate: true, endedAt: true, monthlyRent: true, tenantId: true, landlordId: true, unitId: true, bedId: true, property: { select: { id: true, title: true, code: true } } } }),
          prisma.lease.count({ where }),
          prisma.lease.count({ where: { ...where, status: "ACTIVE" } }),
        ]);
        const places = await placeLabels(items);
        const people = await prisma.user.findMany({ where: { id: { in: items.flatMap((l) => [l.tenantId, l.landlordId]) } }, select: { id: true, fullName: true } });
        const nameOf = (x: string) => people.find((p) => p.id === x)?.fullName ?? null;
        add("leases", {
          total,
          active,
          items: items.map((l) => ({ ...l, monthlyRent: money(l.monthlyRent), as: l.tenantId === id ? "TENANT" : "LANDLORD", otherParty: nameOf(l.tenantId === id ? l.landlordId : l.tenantId), place: placeOf(places, l) })),
        });
      })(),
    );
  }

  if (all("applications.view")) {
    jobs.push(
      (async () => {
        const [items, total] = await Promise.all([
          prisma.rentalApplication.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, status: true, createdAt: true, property: { select: { id: true, title: true, code: true } } } }),
          prisma.rentalApplication.count({ where: { tenantId: id } }),
        ]);
        add("applications", { total, items });
      })(),
    );
  }

  if (all("rent.view")) {
    jobs.push(
      (async () => {
        const where = { OR: [{ tenantId: id }, { landlordId: id }] };
        const [items, summary] = await Promise.all([
          prisma.rentPayment.findMany({ where, orderBy: { dueDate: "desc" }, take: N * 2, select: { id: true, period: true, amount: true, dueDate: true, status: true, paidAt: true, method: true, receiptNumber: true, tenantId: true, lease: { select: { unitId: true, bedId: true, property: { select: { title: true, code: true } } } } } }),
          prisma.rentPayment.groupBy({ by: ["status"], where: { tenantId: id }, _sum: { amount: true }, _count: { _all: true } }),
        ]);
        const asLandlord = await prisma.rentPayment.groupBy({ by: ["status"], where: { landlordId: id }, _sum: { amount: true }, _count: { _all: true } });
        const places = await placeLabels(items.map((r) => r.lease));
        const sum = (rows: typeof summary) => Object.fromEntries(rows.map((s) => [s.status, { count: s._count._all, amount: money(s._sum.amount) }]));
        add("rent", {
          asTenant: sum(summary),
          asLandlord: sum(asLandlord),
          items: items.map((r) => ({ ...r, amount: money(r.amount), as: r.tenantId === id ? "TENANT" : "LANDLORD", place: placeOf(places, r.lease), property: r.lease.property })),
        });
      })(),
    );
  }

  if (all("payments.view")) {
    jobs.push(
      (async () => {
        const where = { OR: [{ payerId: id }, { payeeId: id }] };
        const [items, total, invoices, refunds] = await Promise.all([
          prisma.transaction.findMany({ where, orderBy: { createdAt: "desc" }, take: N * 2, select: { id: true, type: true, status: true, amount: true, method: true, reference: true, isTest: true, payerId: true, createdAt: true } }),
          prisma.transaction.count({ where }),
          prisma.invoice.findMany({ where: { issuedToId: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, number: true, description: true, total: true, status: true, dueDate: true, createdAt: true } }),
          prisma.refund.findMany({ where: { transaction: where }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, amount: true, reason: true, status: true, createdAt: true } }),
        ]);
        add("transactions", {
          total,
          items: items.map((t) => ({ ...t, amount: money(t.amount), direction: t.payerId === id ? "OUT" : "IN" })),
          invoices: invoices.map((i) => ({ ...i, total: money(i.total) })),
          refunds: refunds.map((r) => ({ ...r, amount: money(r.amount) })),
        });
      })(),
    );
  }

  if (all("payments.view") || all("wallet.adjust")) {
    jobs.push(
      (async () => {
        const [summary, ledger, topups, subs] = await Promise.all([
          walletSummary(id),
          prisma.promoWalletTransaction.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: N * 2, select: { id: true, type: true, bucket: true, amount: true, balanceAfter: true, note: true, createdById: true, createdAt: true } }),
          prisma.walletTopup.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, code: true, provider: true, amount: true, status: true, providerPaymentId: true, testMode: true, createdAt: true, paidAt: true, failureReason: true } }),
          prisma.subscription.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, status: true, startsAt: true, endsAt: true, source: true, plan: { select: { name: true, priceMonthly: true } } } }),
        ]);
        add("wallet", {
          summary,
          ledger: ledger.map((t) => ({ ...t, amount: money(t.amount), balanceAfter: money(t.balanceAfter) })),
          topups: topups.map((t) => ({ ...t, amount: money(t.amount) })),
          subscriptions: subs.map((s) => ({ ...s, plan: { name: s.plan.name, priceMonthly: money(s.plan.priceMonthly) } })),
        });
      })(),
    );
  }

  if (can(req, "referrals.manage")) {
    jobs.push(
      (async () => {
        const [asReferrer, asReferred, codes] = await Promise.all([
          prisma.referral.findMany({ where: { referrerId: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, code: true, type: true, status: true, rewardStatus: true, onHold: true, createdAt: true, referredUserId: true } }),
          prisma.referral.findMany({ where: { referredUserId: id }, select: { id: true, code: true, type: true, status: true, referrerId: true, createdAt: true } }),
          prisma.referralCode.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 5, select: { code: true, kind: true, status: true, opens: true, createdAt: true } }),
        ]);
        const total = await prisma.referral.groupBy({ by: ["status"], where: { referrerId: id }, _count: { _all: true } });
        add("referrals", { byStatus: Object.fromEntries(total.map((t) => [t.status, t._count._all])), asReferrer, asReferred, codes });
      })(),
    );
  }

  if (can(req, "reviews.moderate")) {
    jobs.push(
      (async () => {
        const visible = { status: { in: ["PUBLISHED", "FLAGGED"] as Array<"PUBLISHED" | "FLAGGED"> } };
        const [received, written] = await Promise.all([
          prisma.rentalReview.findMany({ where: { revieweeId: id, ...visible }, select: { revieweeRole: true, overallRating: true, categoryRatings: true } }),
          prisma.rentalReview.findMany({ where: { reviewerId: id }, orderBy: { submittedAt: "desc" }, take: N, select: { id: true, code: true, status: true, overallRating: true, reviewerRole: true, submittedAt: true, property: { select: { title: true, code: true } } } }),
        ]);
        const stats = (role: "LANDLORD" | "TENANT") => ratingStats(received.filter((r) => r.revieweeRole === role).map((r) => ({ overallRating: r.overallRating, categoryRatings: r.categoryRatings as Record<string, number> })));
        add("reviews", { asLandlord: stats("LANDLORD"), asTenant: stats("TENANT"), written });
      })(),
    );
  }

  if (all("maintenance.view")) {
    jobs.push(
      (async () => {
        const where = { OR: [{ raisedById: id }, { landlordId: id }, { assignedProviderId: id }] };
        const [items, total] = await Promise.all([
          prisma.maintenanceRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: N, select: { id: true, title: true, category: true, status: true, priority: true, createdAt: true, raisedById: true, property: { select: { title: true, code: true } } } }),
          prisma.maintenanceRequest.count({ where }),
        ]);
        add("maintenance", { total, items: items.map((m) => ({ ...m, as: m.raisedById === id ? "RAISED" : "INVOLVED" })) });
      })(),
    );
  }

  if (all("support.manage")) {
    jobs.push(
      (async () => {
        const [items, total] = await Promise.all([
          prisma.supportTicket.findMany({ where: { raisedById: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, subject: true, category: true, status: true, priority: true, createdAt: true } }),
          prisma.supportTicket.count({ where: { raisedById: id } }),
        ]);
        add("support", { total, items });
      })(),
    );
  }

  if (all("audit_logs.view")) {
    jobs.push(
      (async () => {
        const [logins, changes] = await Promise.all([
          prisma.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: N * 2, select: { id: true, action: true, outcome: true, reason: true, ip: true, userAgent: true, createdAt: true } }),
          prisma.adminActivityLog.findMany({ where: { targetId: id }, orderBy: { createdAt: "desc" }, take: N, select: { id: true, action: true, actorId: true, createdAt: true, changes: true } }),
        ]);
        const actors = await prisma.user.findMany({ where: { id: { in: changes.map((c) => c.actorId) } }, select: { id: true, fullName: true } });
        add("activity", { logins, adminChanges: changes.map((c) => ({ ...c, actor: actors.find((a) => a.id === c.actorId)?.fullName ?? null })) });
      })(),
    );
  }

  await Promise.all(jobs);
  res.json(out);
}
