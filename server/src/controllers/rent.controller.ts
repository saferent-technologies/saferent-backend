import { randomBytes } from "node:crypto";
import type { Lease, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { env } from "../config/env";
import { logActivity } from "../lib/activity";
import { writeAuditLog, requestMeta } from "../lib/audit";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { placeCode, placeCodeOf, placeLabels, placeOf, receiptNumberFor } from "../lib/places";
import { parseInput } from "../lib/validation";
import { can, me } from "../middleware/auth";
import { and, rentWhere } from "../rbac/access";
import { escapeHtml } from "../services/templates/layout";
import { printableDoc } from "./rentals.controller";
import { receiptPan } from "./pan.controller";
import { billingPeriods } from "../lib/rentSchedule";

export { periodOf } from "../lib/rentSchedule";

/** Idempotently creates DUE rows for every billing period of an ACTIVE lease up to this month. */
export async function ensureRentSchedule(lease: Pick<Lease, "id" | "propertyId" | "tenantId" | "landlordId" | "startDate" | "endDate" | "monthlyRent" | "rentDueDay" | "status">): Promise<void> {
  if (lease.status !== "ACTIVE") return;
  const periods = billingPeriods(lease.startDate, lease.endDate, new Date());
  if (periods.length === 0) return;
  await prisma.rentPayment.createMany({
    skipDuplicates: true,
    data: periods.map((period) => {
      const [y, m] = period.split("-").map(Number);
      return {
        leaseId: lease.id,
        propertyId: lease.propertyId,
        tenantId: lease.tenantId,
        landlordId: lease.landlordId,
        period,
        amount: lease.monthlyRent,
        dueDate: new Date(y, m - 1, lease.rentDueDay),
      };
    }),
  });
}

async function markOverdue(where: Prisma.RentPaymentWhereInput): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.rentPayment.updateMany({ where: and(where, { status: "DUE", dueDate: { lt: today } }), data: { status: "OVERDUE" } });
}

const rentInclude = {
  lease: { select: { id: true, code: true, unitId: true, bedId: true, property: { select: { id: true, code: true, title: true, city: true } }, tenant: { select: { id: true, fullName: true } }, landlord: { select: { id: true, fullName: true } } } },
} satisfies Prisma.RentPaymentInclude;

/** GET /api/rent — tenant: own; landlord: own properties; finance: all. */
export async function listRent(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = rentWhere(user);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");

  // Tenants/landlords: make sure this month's dues exist for their active leases.
  if (!can(req, "rent.view", "ALL")) {
    const leases = await prisma.lease.findMany({ where: { status: "ACTIVE", OR: [{ tenantId: user.id }, { landlordId: user.id }] } });
    for (const l of leases) await ensureRentSchedule(l);
  }
  await markOverdue(scope);

  const p = pagination(req);
  const status = enumQuery(req, "status", ["DUE", "PAID", "OVERDUE", "WAIVED"] as const);
  const where = and<Prisma.RentPaymentWhereInput>(scope, status && { status }, p.q ? { OR: [{ period: { contains: p.q } }, { receiptNumber: { contains: p.q } }] } : undefined);
  const [items, total, summary] = await Promise.all([
    prisma.rentPayment.findMany({ where, include: rentInclude, orderBy: [{ dueDate: "desc" }], skip: p.skip, take: p.take }),
    prisma.rentPayment.count({ where }),
    prisma.rentPayment.groupBy({ by: ["status"], where: scope, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const places = await placeLabels(items.map((r) => r.lease));
  res.json({
    ...paged(items.map((r) => ({ ...r, lease: { ...r.lease, place: placeOf(places, r.lease), placeCode: placeCodeOf(places, r.lease) ?? r.lease.property.code } })), total, p),
    summary: Object.fromEntries(summary.map((s) => [s.status, { count: s._count._all, amount: s._sum.amount ?? 0 }])),
    paymentMode: env.PAYMENT_MODE,
  });
}

function reference(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function settle(req: Request, rentId: string, method: string, isTest: boolean, actorId: string, notes?: string) {
  return prisma.$transaction(async (tx) => {
    const rent = found(await tx.rentPayment.findUnique({ where: { id: rentId } }), "Rent record");
    if (rent.status === "PAID" || rent.status === "WAIVED") fail("failed-precondition", REASONS.INVALID_STATE, "This rent is already settled.");
    // Receipt number from the flat / bed / property unique ID + rent month (see receiptNumberFor).
    const lease = await tx.lease.findUniqueOrThrow({ where: { id: rent.leaseId }, select: { propertyId: true, unitId: true, bedId: true } });
    const code = await placeCode(tx, lease);
    let receiptNumber = receiptNumberFor(code, rent.period);
    for (let attempt = 2; await tx.rentPayment.count({ where: { receiptNumber } }); attempt++) receiptNumber = receiptNumberFor(code, rent.period, attempt);
    // Conditional update prevents double payment under concurrency.
    const updated = await tx.rentPayment.updateMany({
      where: { id: rent.id, status: { in: ["DUE", "OVERDUE"] } },
      data: { status: "PAID", paidAt: new Date(), method, receiptNumber, recordedById: actorId },
    });
    if (updated.count !== 1) fail("failed-precondition", REASONS.INVALID_STATE, "This rent is already settled.");

    const txn = await tx.transaction.create({
      data: {
        type: "RENT_PAYMENT",
        status: "SUCCESS",
        amount: rent.amount,
        payerId: rent.tenantId,
        payeeId: rent.landlordId,
        propertyId: rent.propertyId,
        rentPaymentId: rent.id,
        method,
        reference: reference(isTest ? "TEST" : "TXN"),
        isTest,
        notes: notes ?? null,
        createdById: actorId,
      },
    });
    const commissionSetting = await tx.platformSetting.findUnique({ where: { key: "commission_percent" } });
    const percent = Math.max(0, Math.min(50, Number(commissionSetting?.value ?? 0)));
    if (percent > 0) {
      await tx.transaction.create({
        data: {
          type: "COMMISSION",
          status: "PENDING",
          amount: (Number(rent.amount) * percent) / 100,
          payerId: rent.landlordId,
          propertyId: rent.propertyId,
          rentPaymentId: rent.id,
          method: "PLATFORM",
          reference: reference("COM"),
          isTest,
          notes: `${percent}% commission on ${rent.period} rent`,
          createdById: actorId,
        },
      });
    }
    if (actorId !== rent.tenantId) await logActivity(req, "rent.record_payment", "rent_payment", rent.id, { amount: rent.amount.toString(), method, transaction: txn.reference }, tx);
    return { rent, txn };
  });
}

/**
 * POST /api/rent/:id/pay — tenant pays own rent online.
 * PAYMENT_MODE=test: instantly marked paid and flagged as TEST (no money moves).
 * PAYMENT_MODE=disabled: online payment unavailable (pay offline; finance records it).
 */
export async function payRent(req: Request, res: Response): Promise<void> {
  const user = me(req);
  if (env.PAYMENT_MODE === "disabled") {
    fail("failed-precondition", REASONS.PAYMENTS_NOT_CONFIGURED, "Online payment isn't available yet. Please pay your landlord directly; the payment will be recorded by SafeRent.");
  }
  const rent = found(await prisma.rentPayment.findFirst({ where: { id: idParam(req), tenantId: user.id } }), "Rent record");
  const { rent: paid, txn } = await settle(req, rent.id, "ONLINE_TEST", true, user.id);
  await writeAuditLog({ action: "rent.paid", outcome: "success", userId: user.id, metadata: { rentId: paid.id, reference: txn.reference, test: true }, ...requestMeta(req) });
  await notify(paid.landlordId, "Rent received", `Rent for ${paid.period} was paid (test mode).`, "/rent");
  res.json({ ok: true, reference: txn.reference, test: true });
}

const recordSchema = z.object({ method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE"]), notes: z.string().trim().max(500).optional() });

/** POST /api/rent/:id/record — finance records an offline collection (rent.collect). */
export async function recordRent(req: Request, res: Response): Promise<void> {
  const scope = rentWhere(me(req), "rent.collect");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const rent = found(await prisma.rentPayment.findFirst({ where: and(scope, { id: idParam(req) }) }), "Rent record");
  const input = parseInput(recordSchema, req.body);
  const { txn } = await settle(req, rent.id, input.method, false, me(req).id, input.notes);
  await notify(rent.tenantId, "Payment recorded", `Your rent for ${rent.period} was recorded as paid.`, "/rent");
  await notify(rent.landlordId, "Rent received", `Rent for ${rent.period} was recorded (${input.method}).`, "/rent");
  res.json({ ok: true, reference: txn.reference });
}

const waiveSchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** POST /api/rent/:id/waive — finance waives a due (audited financial adjustment). */
export async function waiveRent(req: Request, res: Response): Promise<void> {
  const scope = rentWhere(me(req), "rent.collect");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const rent = found(await prisma.rentPayment.findFirst({ where: and(scope, { id: idParam(req) }) }), "Rent record");
  if (!["DUE", "OVERDUE"].includes(rent.status)) fail("failed-precondition", REASONS.INVALID_STATE, "Only unpaid rent can be waived.");
  const { reason } = parseInput(waiveSchema, req.body);
  await prisma.$transaction(async (tx) => {
    await tx.rentPayment.update({ where: { id: rent.id }, data: { status: "WAIVED", recordedById: me(req).id } });
    await tx.transaction.create({
      data: { type: "ADJUSTMENT", status: "SUCCESS", amount: rent.amount, payerId: rent.landlordId, payeeId: rent.tenantId, propertyId: rent.propertyId, rentPaymentId: rent.id, method: "WAIVER", reference: reference("ADJ"), notes: reason, createdById: me(req).id },
    });
    await logActivity(req, "rent.waive", "rent_payment", rent.id, { amount: rent.amount.toString(), reason }, tx);
  });
  await writeAuditLog({ action: "finance.adjustment", outcome: "success", userId: me(req).id, metadata: { rentId: rent.id, type: "waiver" }, ...requestMeta(req) });
  await notify(rent.tenantId, "Rent waived", `Your rent for ${rent.period} was waived.`, "/rent");
  res.json({ ok: true });
}

/** POST /api/rent/generate — finance generates dues for all active leases up to this month. */
export async function generateDues(req: Request, res: Response): Promise<void> {
  const leases = await prisma.lease.findMany({ where: { status: "ACTIVE" } });
  for (const l of leases) await ensureRentSchedule(l);
  await markOverdue({});
  await logActivity(req, "rent.generate_dues", "lease", null, { leases: leases.length });
  res.json({ ok: true, leases: leases.length });
}

const inr = (v: Prisma.Decimal | number) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** GET /api/rent/:id/receipt — printable receipt for a PAID record (tenant, landlord or finance). */
export async function rentReceipt(req: Request, res: Response): Promise<void> {
  const scope = rentWhere(me(req));
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const rent = found(await prisma.rentPayment.findFirst({ where: and(scope, { id: idParam(req) }), include: rentInclude }), "Rent record");
  if (rent.status !== "PAID") fail("failed-precondition", REASONS.INVALID_STATE, "A receipt is available once the rent is paid.");
  const test = rent.method === "ONLINE_TEST";
  const places = await placeLabels([rent.lease]);
  const place = placeOf(places, rent.lease);
  const code = placeCodeOf(places, rent.lease) ?? rent.lease.property.code;
  // Shown only with the owner's consent (Profile → PAN & tax, or approved on this lease).
  const landlordPan = await receiptPan(rent.lease.id, rent.lease.landlord.id);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(printableDoc(`Rent receipt ${rent.receiptNumber}`, `
    <h1>Rent Receipt${test ? " (TEST — no money received)" : ""}</h1>
    <p class="muted">Receipt no. ${escapeHtml(rent.receiptNumber ?? "")}</p>
    <table>
      <tr><th>Property</th><td>${place ? `${escapeHtml(place)}, ` : ""}${escapeHtml(rent.lease.property.title ?? rent.lease.property.code)}, ${escapeHtml(rent.lease.property.city ?? "")}</td></tr>
      <tr><th>Unit ID</th><td>${escapeHtml(code)}</td></tr>
      <tr><th>Lease</th><td>${escapeHtml(rent.lease.code ?? "")}</td></tr>
      <tr><th>Tenant</th><td>${escapeHtml(rent.lease.tenant.fullName)}</td></tr>
      <tr><th>Landlord</th><td>${escapeHtml(rent.lease.landlord.fullName)}</td></tr>
      ${landlordPan ? `<tr><th>Landlord PAN</th><td>${escapeHtml(landlordPan)}</td></tr>` : ""}
      <tr><th>Rent period</th><td>${escapeHtml(rent.period)}</td></tr>
      <tr><th>Amount</th><td>${inr(rent.amount)}</td></tr>
      <tr><th>Paid on</th><td>${rent.paidAt?.toLocaleString("en-IN") ?? ""}</td></tr>
      <tr><th>Method</th><td>${escapeHtml(rent.method ?? "")}</td></tr>
    </table>
    <p class="muted">Generated by SafeRent. This receipt reflects the payment recorded on the SafeRent platform.</p>
  `));
}
