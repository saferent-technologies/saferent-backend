import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { and, applicationWhere, leaseWhere } from "../rbac/access";
import { escapeHtml } from "../services/templates/layout";
import { toContact, toPublicUser } from "./serializers";
import { ensureRentSchedule } from "./rent.controller";

/* ─────────────── Applications ─────────────── */

const applySchema = z.object({
  proposedMoveIn: z.coerce.date(),
  occupants: z.coerce.number().int().min(1).max(20),
  message: z.string().trim().max(1000).optional(),
});

/** POST /api/browse/:id/apply — tenant applies for an ACTIVE, available listing. */
export async function applyForProperty(req: Request, res: Response): Promise<void> {
  const tenant = me(req);
  const propertyId = idParam(req);
  const property = found(await prisma.property.findFirst({ where: { id: propertyId, status: "ACTIVE", isAvailable: true } }), "Listing");
  if (property.ownerId === tenant.id) fail("invalid-argument", REASONS.INVALID_INPUT, "You cannot apply for your own property.");
  const input = parseInput(applySchema, req.body);
  const pending = await prisma.rentalApplication.count({ where: { propertyId, tenantId: tenant.id, status: "PENDING" } });
  if (pending) fail("already-exists", REASONS.CONFLICT, "You already have a pending application for this property.");

  const application = await prisma.rentalApplication.create({
    data: { propertyId, tenantId: tenant.id, proposedMoveIn: input.proposedMoveIn, occupants: input.occupants, message: input.message ?? null },
  });
  await notify(property.ownerId, "New rental application", `${tenant.fullName} applied for "${property.title}".`, `/applications`);
  res.status(201).json({ application });
}

/** GET /api/applications — tenant: own; landlord: for own properties; manager: assigned; staff: all. */
export async function listApplications(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = applicationWhere(user);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const status = enumQuery(req, "status", ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const);
  const where = and<Prisma.RentalApplicationWhereInput>(scope, status && { status }, p.q ? { property: { title: { contains: p.q } } } : undefined);
  const [items, total] = await Promise.all([
    prisma.rentalApplication.findMany({
      where,
      include: {
        property: { select: { id: true, title: true, city: true, monthlyRent: true, ownerId: true } },
        tenant: { select: { id: true, fullName: true, tenantProfile: { select: { occupation: true, familySize: true, currentCity: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: p.skip,
      take: p.take,
    }),
    prisma.rentalApplication.count({ where }),
  ]);
  // Landlords see the applicant's name and basic profile — not their phone/email until a lease exists.
  res.json(
    paged(
      items.map((a) => ({
        ...a,
        tenant: { ...toPublicUser(a.tenant), profile: a.tenant.tenantProfile },
        property: { id: a.property.id, title: a.property.title, city: a.property.city, monthlyRent: a.property.monthlyRent },
        isMine: a.tenantId === user.id,
      })),
      total,
      p,
    ),
  );
}

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional(),
  startDate: z.coerce.date().optional(),
  months: z.coerce.number().int().min(1).max(60).default(11),
  rentDueDay: z.coerce.number().int().min(1).max(28).default(5),
});

/**
 * POST /api/applications/:id/decision — landlord (own) / manager (assigned) / admin.
 * Approving creates the lease, marks the property RENTED, rejects other pending applications
 * and generates the first rent due.
 */
export async function decideApplication(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = applicationWhere(user, "applications.manage");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const application = found(
    await prisma.rentalApplication.findFirst({ where: and(scope, { id: idParam(req) }), include: { property: true } }),
    "Application",
  );
  if (application.tenantId === user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "You cannot decide on your own application.");
  if (application.status !== "PENDING") fail("failed-precondition", REASONS.INVALID_STATE, "This application has already been decided.");
  const input = parseInput(decisionSchema, req.body);

  if (input.decision === "REJECT") {
    await prisma.rentalApplication.update({ where: { id: application.id }, data: { status: "REJECTED", decisionNote: input.note ?? null, decidedById: user.id, decidedAt: new Date() } });
    await notify(application.tenantId, "Application update", `Your application for "${application.property.title}" was not accepted.${input.note ? ` Note: ${input.note}` : ""}`, "/applications");
    res.json({ ok: true });
    return;
  }

  const activeLease = await prisma.lease.count({ where: { propertyId: application.propertyId, status: "ACTIVE" } });
  if (activeLease) fail("failed-precondition", REASONS.INVALID_STATE, "This property already has an active lease.");

  const start = input.startDate ?? application.proposedMoveIn;
  const end = new Date(start);
  end.setMonth(end.getMonth() + input.months);
  end.setDate(end.getDate() - 1);

  const lease = await prisma.$transaction(async (tx) => {
    await tx.rentalApplication.update({ where: { id: application.id }, data: { status: "APPROVED", decisionNote: input.note ?? null, decidedById: user.id, decidedAt: new Date() } });
    const others = await tx.rentalApplication.findMany({ where: { propertyId: application.propertyId, status: "PENDING", NOT: { id: application.id } }, select: { tenantId: true } });
    await tx.rentalApplication.updateMany({ where: { propertyId: application.propertyId, status: "PENDING", NOT: { id: application.id } }, data: { status: "REJECTED", decisionNote: "Property has been rented.", decidedAt: new Date() } });
    await tx.property.update({ where: { id: application.propertyId }, data: { status: "RENTED", isAvailable: false } });
    const created = await tx.lease.create({
      data: {
        propertyId: application.propertyId,
        landlordId: application.property.ownerId,
        tenantId: application.tenantId,
        applicationId: application.id,
        startDate: start,
        endDate: end,
        monthlyRent: application.property.monthlyRent,
        securityDeposit: application.property.securityDeposit,
        rentDueDay: input.rentDueDay,
        terms: defaultTerms(input.rentDueDay),
        createdById: user.id,
      },
    });
    if (user.id !== application.property.ownerId) await logActivity(req, "application.approve", "rental_application", application.id, { leaseId: created.id }, tx);
    return { created, others };
  });

  await ensureRentSchedule(lease.created);
  await notify(application.tenantId, "Application approved 🎉", `Your lease for "${application.property.title}" starts ${start.toDateString()}.`, "/leases");
  for (const o of lease.others) await notify(o.tenantId, "Application update", `"${application.property.title}" has been rented to another applicant.`, "/applications");
  res.json({ ok: true, leaseId: lease.created.id });
}

/** POST /api/applications/:id/withdraw — tenant withdraws own pending application. */
export async function withdrawApplication(req: Request, res: Response): Promise<void> {
  const tenant = me(req);
  const application = found(await prisma.rentalApplication.findFirst({ where: { id: idParam(req), tenantId: tenant.id } }), "Application");
  if (application.status !== "PENDING") fail("failed-precondition", REASONS.INVALID_STATE, "Only pending applications can be withdrawn.");
  await prisma.rentalApplication.update({ where: { id: application.id }, data: { status: "WITHDRAWN" } });
  res.json({ ok: true });
}

/* ─────────────── Leases ─────────────── */

function defaultTerms(dueDay: number): string {
  return [
    `1. Rent is payable monthly on or before day ${dueDay} of each month.`,
    "2. The security deposit is refundable at the end of the lease, less any agreed deductions for damages.",
    "3. The tenant shall keep the property in good condition and report maintenance issues promptly through SafeRent.",
    "4. Either party may terminate the lease with 30 days' written notice, subject to applicable law.",
    "5. Subletting is not permitted without the landlord's written consent.",
  ].join("\n");
}

const leaseInclude = {
  property: { select: { id: true, title: true, addressLine: true, locality: true, city: true, state: true, pincode: true } },
  landlord: { select: { id: true, fullName: true, phoneNumber: true, email: true } },
  tenant: { select: { id: true, fullName: true, phoneNumber: true, email: true } },
} satisfies Prisma.LeaseInclude;

type LeaseWithParties = Prisma.LeaseGetPayload<{ include: typeof leaseInclude }>;

/** Contact details are shared only between the two parties of an ACTIVE lease (and staff). */
function presentLease(lease: LeaseWithParties, viewerId: string) {
  const isParty = viewerId === lease.tenantId || viewerId === lease.landlordId;
  const share = lease.status === "ACTIVE" || !isParty;
  return {
    ...lease,
    landlord: share ? toContact(lease.landlord) : toPublicUser(lease.landlord),
    tenant: share ? toContact(lease.tenant) : toPublicUser(lease.tenant),
  };
}

/** GET /api/leases */
export async function listLeases(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = leaseWhere(user);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const status = enumQuery(req, "status", ["ACTIVE", "ENDED", "TERMINATED"] as const);
  const where = and<Prisma.LeaseWhereInput>(scope, status && { status }, p.q ? { property: { title: { contains: p.q } } } : undefined);
  const [items, total] = await Promise.all([
    prisma.lease.findMany({ where, include: leaseInclude, orderBy: { startDate: "desc" }, skip: p.skip, take: p.take }),
    prisma.lease.count({ where }),
  ]);
  res.json(paged(items.map((l) => presentLease(l, user.id)), total, p));
}

async function scopedLease(req: Request, permission: "leases.view" | "leases.manage" = "leases.view") {
  const scope = leaseWhere(me(req), permission);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  return found(await prisma.lease.findFirst({ where: and(scope, { id: idParam(req) }), include: leaseInclude }), "Lease");
}

/** GET /api/leases/:id */
export async function getLease(req: Request, res: Response): Promise<void> {
  const lease = await scopedLease(req);
  res.json({ lease: presentLease(lease, me(req).id) });
}

const terminateSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** POST /api/leases/:id/terminate — landlord (own) / manager (assigned) / admin. */
export async function terminateLease(req: Request, res: Response): Promise<void> {
  const lease = await scopedLease(req, "leases.manage");
  if (lease.status !== "ACTIVE") fail("failed-precondition", REASONS.INVALID_STATE, "Only active leases can be terminated.");
  const { reason } = parseInput(terminateSchema, req.body);
  await prisma.$transaction(async (tx) => {
    await tx.lease.update({ where: { id: lease.id }, data: { status: "TERMINATED", endedAt: new Date() } });
    await tx.property.update({ where: { id: lease.propertyId }, data: { status: "INACTIVE", isAvailable: true } });
    await logActivity(req, "lease.terminate", "lease", lease.id, { reason }, tx);
  });
  for (const id of [lease.tenantId, lease.landlordId].filter((x) => x !== me(req).id)) {
    await notify(id, "Lease terminated", `The lease for "${lease.property.title}" was terminated: ${reason}`, "/leases");
  }
  res.json({ ok: true });
}

const termsSchema = z.object({ terms: z.string().trim().min(10).max(20000) });

/** PATCH /api/leases/:id/terms */
export async function updateLeaseTerms(req: Request, res: Response): Promise<void> {
  const lease = await scopedLease(req, "leases.manage");
  const { terms } = parseInput(termsSchema, req.body);
  await prisma.lease.update({ where: { id: lease.id }, data: { terms } });
  await notify(lease.tenantId, "Lease terms updated", `The terms for "${lease.property.title}" were updated.`, `/leases`);
  res.json({ ok: true });
}

const inr = (v: Prisma.Decimal | number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const d = (v: Date) => v.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** GET /api/leases/:id/agreement — printable lease agreement (HTML; use the browser's "Save as PDF"). */
export async function leaseAgreement(req: Request, res: Response): Promise<void> {
  const lease = await scopedLease(req);
  const p = lease.property;
  const address = [p.addressLine, p.locality, p.city, p.state, p.pincode].filter(Boolean).join(", ");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(printableDoc(`Lease Agreement — ${p.title}`, `
    <h1>Residential Lease Agreement</h1>
    <p class="muted">Agreement ID: ${escapeHtml(lease.id)} · Status: ${lease.status}</p>
    <table>
      <tr><th>Property</th><td>${escapeHtml(p.title)}<br>${escapeHtml(address)}</td></tr>
      <tr><th>Landlord</th><td>${escapeHtml(lease.landlord.fullName)}</td></tr>
      <tr><th>Tenant</th><td>${escapeHtml(lease.tenant.fullName)}</td></tr>
      <tr><th>Term</th><td>${d(lease.startDate)} to ${d(lease.endDate)}</td></tr>
      <tr><th>Monthly rent</th><td>${inr(lease.monthlyRent)} (due on day ${lease.rentDueDay})</td></tr>
      <tr><th>Security deposit</th><td>${inr(lease.securityDeposit)}</td></tr>
    </table>
    <h2>Terms</h2>
    <pre>${escapeHtml(lease.terms ?? "")}</pre>
    <p class="muted">Generated by SafeRent on ${d(new Date())}. This document summarises the digital lease recorded on SafeRent.</p>
  `));
}

export function printableDoc(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1F2937;max-width:760px;margin:32px auto;padding:0 20px}
h1{color:#EA580C;font-size:24px;margin-bottom:4px}h2{font-size:16px;margin-top:24px}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #E5E7EB;padding:10px;text-align:left;vertical-align:top;font-size:14px}th{background:#FFF7ED;width:34%}
pre{white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.6}.muted{color:#6B7280;font-size:12px}
.brand{font-weight:800;color:#F97316;font-size:20px}@media print{button{display:none}}</style></head>
<body><div class="brand">SafeRent</div>${body}<p><button onclick="window.print()">Print / Save as PDF</button></p></body></html>`;
}

