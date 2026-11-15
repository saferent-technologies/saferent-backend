import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { discardUploads, storage } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { applyRentPayment, markOverdue, UNPAID } from "./rent.controller";
import { amountParts, depositAvailable, periodLabel } from "./rentDues.controller";

/*
 * Tenant "I've paid" → landlord approves / rejects.
 *   Tenant:   POST /rent/dues/:id/payment-requests  (amount, transactionId, proof photo)  → PENDING
 *   Landlord: GET  /rent/payment-requests?status=PENDING
 *             POST /rent/payment-requests/:id/approve { amount }   → due PAID / PARTIAL + receipt + transaction
 *             POST /rent/payment-requests/:id/reject  { reason }
 * Tenant can also ask to pay a due from the security deposit: POST /rent/dues/:id/use-deposit → type DEPOSIT,
 * approved / rejected through the same endpoints (approval moves the money from the deposit to the rent).
 * One PENDING request per due (unique pendingKey). The proof photo is private: only that tenant and landlord.
 */

const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
const firstName = (full: string) => full.split(/\s+/)[0] || full;
const proofUrl = (id: string) => `/api/v1/files/payment-proofs/${id}`;

const createSchema = z
  .object({
    amount: z.coerce.number().positive("Enter the amount you paid.").max(100_000_000),
    transactionId: z.string().trim().min(4, "Enter the transaction / UTR ID (at least 4 characters).").max(60).regex(/^[\w\-./ ]+$/, "Transaction ID can only have letters, numbers, - . / and spaces."),
    mode: z.enum(["UPI", "BANK_TRANSFER", "CASH", "CHEQUE"]).optional(),
  })
  .strict();

/** POST /api/v1/rent/dues/:id/payment-requests — tenant sends payment proof (multipart: amount, transactionId, proof). */
export async function createPaymentRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  try {
    const due = await prisma.rentPayment.findFirst({
      where: { id: idParam(req), tenantId: user.id },
      include: { lease: { select: { id: true, propertyId: true, unitId: true, bedId: true, property: { select: { title: true, code: true } } } } },
    });
    if (!due) fail("not-found", REASONS.NOT_FOUND, "Rent due not found.");
    const d = due!;
    if (!(UNPAID as readonly string[]).includes(d.status)) fail("failed-precondition", REASONS.INVALID_STATE, d.status === "PAID" ? "This rent is already paid." : "Nothing to pay for this month.");
    const input = parseInput(createSchema, req.body);
    if (!req.file) fail("invalid-argument", REASONS.INVALID_INPUT, "Attach a photo or screenshot of the payment (proof).");
    const balance = Number(d.amount) - Number(d.paidAmount);
    if (input.amount > balance + 0.001) fail("invalid-argument", REASONS.INVALID_INPUT, `Only ${inr(balance)} is due for ${periodLabel(d.period)}.`);

    const pending = await prisma.rentPaymentRequest.findFirst({ where: { rentPaymentId: d.id, status: "PENDING" } });
    if (pending) fail("already-exists", REASONS.CONFLICT, "You've already sent a payment proof for this month. Wait for your landlord to respond.");
    const reused = await prisma.rentPaymentRequest.findFirst({ where: { tenantId: user.id, transactionId: input.transactionId, status: { in: ["PENDING", "APPROVED"] } } });
    if (reused) fail("already-exists", REASONS.CONFLICT, "This transaction ID was already sent for another payment.");

    let created;
    try {
      created = await prisma.rentPaymentRequest.create({
        data: {
          rentPaymentId: d.id,
          leaseId: d.leaseId,
          propertyId: d.propertyId,
          tenantId: user.id,
          landlordId: d.landlordId,
          amount: input.amount,
          transactionId: input.transactionId,
          mode: input.mode ?? "UPI",
          proofKey: storage.keyFor(req.file!),
          proofMime: req.file!.mimetype,
          pendingKey: d.id,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") fail("already-exists", REASONS.CONFLICT, "You've already sent a payment proof for this month. Wait for your landlord to respond.");
      throw err;
    }
    await logActivity(req, "rent.payment_request", "rent_payment", d.id, { requestId: created.id, amount: input.amount });
    await notify(d.landlordId, "Payment proof received", `${firstName(user.fullName)} sent payment proof for ${periodLabel(d.period)} (${inr(input.amount)}). Please check and approve.`, "/rent/requests", "PAYMENT_SUCCESS");
    res.locals.message = "Sent to your landlord";
    res.status(201).json({ paymentRequest: { id: created.id, type: created.type, status: created.status, amount: Number(created.amount), rejectReason: null, createdAt: created.createdAt } });
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
}

/** POST /api/v1/rent/dues/:id/use-deposit — tenant asks to pay this due from the security deposit. */
export async function useDepositForDue(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const due = await prisma.rentPayment.findFirst({ where: { id: idParam(req), tenantId: user.id }, include: { lease: true } });
  if (!due) fail("not-found", REASONS.NOT_FOUND, "Rent due not found.");
  const d = due!;
  if (!d.lease.depositUsableAsRent) fail("already-exists", REASONS.CONFLICT, "Your landlord doesn't allow paying rent from the deposit");
  if (!(UNPAID as readonly string[]).includes(d.status)) fail("failed-precondition", REASONS.INVALID_STATE, d.status === "PAID" ? "This rent is already paid." : "Nothing to pay for this month.");
  const available = depositAvailable(d.lease);
  if (available <= 0) fail("failed-precondition", REASONS.INVALID_STATE, "There's no deposit left to use.");
  const balance = Number(d.amount) - Number(d.paidAmount);
  const amount = Math.min(balance, available);
  try {
    const created = await prisma.rentPaymentRequest.create({
      data: { type: "DEPOSIT", rentPaymentId: d.id, leaseId: d.leaseId, propertyId: d.propertyId, tenantId: user.id, landlordId: d.landlordId, amount, mode: "DEPOSIT", pendingKey: d.id },
    });
    await logActivity(req, "rent.use_deposit_request", "rent_payment", d.id, { requestId: created.id, amount });
    await notify(d.landlordId, "Pay rent from deposit?", `${firstName(user.fullName)} asked to pay ${periodLabel(d.period)} rent (${inr(amount)}) from the security deposit. Please approve or reject.`, "/rent/requests", "PAYMENT_SUCCESS");
    res.locals.message = amount < balance ? `Sent to your landlord — ${inr(amount)} from the deposit, ${inr(balance - amount)} still to pay` : "Sent to your landlord";
    res.status(201).json({ paymentRequest: { id: created.id, type: created.type, status: created.status, amount, rejectReason: null, createdAt: created.createdAt } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") fail("already-exists", REASONS.CONFLICT, "There's already a pending request for this month. Wait for your landlord to respond.");
    throw err;
  }
}

const requestInclude = {
  rentPayment: { select: { id: true, period: true, amount: true, rentAmount: true, maintenanceAmount: true, paidAmount: true, status: true, dueDate: true } },
} satisfies Prisma.RentPaymentRequestInclude;

/** GET /api/v1/rent/payment-requests?status=PENDING|APPROVED|REJECTED — landlord's inbox, newest first. */
export async function listPaymentRequests(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const p = pagination(req);
  const status = enumQuery(req, "status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const);
  const where: Prisma.RentPaymentRequestWhereInput = { landlordId: user.id, ...(status ? { status } : {}) };
  const [rows, total] = await Promise.all([
    prisma.rentPaymentRequest.findMany({ where, include: requestInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: p.skip, take: p.take }),
    prisma.rentPaymentRequest.count({ where }),
  ]);
  const [leases, tenants, props] = await Promise.all([
    prisma.lease.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.leaseId))] } }, select: { id: true, unitId: true, bedId: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } }, select: { id: true, fullName: true } }),
    prisma.property.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.propertyId))] } }, select: { id: true, title: true, code: true } }),
  ]);
  const leaseOf = new Map(leases.map((l) => [l.id, l]));
  const nameOf = new Map(tenants.map((t) => [t.id, t.fullName]));
  const propOf = new Map(props.map((x) => [x.id, x]));
  const places = await placeLabels(leases);
  res.json(
    paged(
      rows.map((r) => {
        const lease = leaseOf.get(r.leaseId);
        const prop = propOf.get(r.propertyId);
        return {
          id: r.id,
          due: { id: r.rentPayment.id, period: periodLabel(r.rentPayment.period), periodKey: r.rentPayment.period, ...amountParts(r.rentPayment), paidAmount: Number(r.rentPayment.paidAmount), balance: Math.max(0, Number(r.rentPayment.amount) - Number(r.rentPayment.paidAmount)), status: r.rentPayment.status, dueDate: r.rentPayment.dueDate },
          tenant: { fullName: nameOf.get(r.tenantId) ?? "" },
          property: { id: r.propertyId, title: prop?.title ?? prop?.code ?? "" },
          place: lease ? placeOf(places, lease) : null,
          type: r.type,
          amount: Number(r.amount),
          transactionId: r.transactionId,
          mode: r.mode,
          proofUrl: r.proofKey ? proofUrl(r.id) : null,
          createdAt: r.createdAt,
          status: r.status,
          approvedAmount: r.approvedAmount === null ? null : Number(r.approvedAmount),
          rejectReason: r.rejectReason,
          decidedAt: r.decidedAt,
        };
      }),
      total,
      p,
    ),
  );
}

async function landlordRequest(req: Request) {
  const user = me(req);
  const r = await prisma.rentPaymentRequest.findFirst({ where: { id: idParam(req), landlordId: user.id }, include: requestInclude });
  if (!r) fail("not-found", REASONS.NOT_FOUND, "Payment request not found.");
  if (r!.status !== "PENDING") fail("failed-precondition", REASONS.INVALID_STATE, `This request was already ${r!.status.toLowerCase()}.`);
  return r!;
}

const approveSchema = z.object({ amount: z.coerce.number().positive("Amount must be more than 0.").max(100_000_000).optional() }).strict();

/** POST /api/v1/rent/payment-requests/:id/approve { amount } — marks the due PAID (or PARTIAL), with receipt + transaction. */
export async function approvePaymentRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const r = await landlordRequest(req);
  const { amount: given } = parseInput(approveSchema, req.body ?? {});
  const amount = given ?? Number(r.amount);
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.rentPaymentRequest.updateMany({
      where: { id: r.id, status: "PENDING" },
      data: { status: "APPROVED", pendingKey: null, approvedAmount: amount, decidedById: user.id, decidedAt: new Date() },
    });
    if (!claimed.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just answered. Refresh and check.");
    if (r.type === "DEPOSIT") {
      // Take the money from the deposit, guarded against a concurrent use of the same deposit.
      const lease = await tx.lease.findUniqueOrThrow({ where: { id: r.leaseId } });
      const available = depositAvailable(lease);
      if (amount > available + 0.001) fail("failed-precondition", REASONS.INVALID_STATE, available > 0 ? `Only ${inr(available)} of the deposit is left.` : "There's no deposit left to use.");
      const used = await tx.lease.updateMany({ where: { id: lease.id, depositUsedAmount: lease.depositUsedAmount }, data: { depositUsedAmount: Number(lease.depositUsedAmount) + amount } });
      if (!used.count) fail("failed-precondition", REASONS.INVALID_STATE, "The deposit was just updated. Refresh and try again.");
    }
    const paid = await applyRentPayment(tx, r.rentPaymentId, {
      amount,
      method: r.type === "DEPOSIT" ? "DEPOSIT" : r.mode,
      isTest: false,
      actorId: user.id,
      notes: r.type === "DEPOSIT" ? "Paid from the security deposit" : `Tenant payment proof · Txn ${r.transactionId}`,
      referencePrefix: r.type === "DEPOSIT" ? "DPU" : "PRQ",
    });
    await logActivity(req, "rent.payment_request_approve", "rent_payment", r.rentPaymentId, { requestId: r.id, amount, full: paid.full }, tx);
    return paid;
  });
  await markOverdue({ id: r.rentPaymentId });
  const period = periodLabel(r.rentPayment.period);
  await notify(
    r.tenantId,
    result.full ? "Payment approved" : "Part payment approved",
    result.full
      ? r.type === "DEPOSIT"
        ? `Your landlord approved paying ${period} rent (${inr(amount)}) from your deposit. Your receipt is ready.`
        : `Your landlord approved your payment of ${inr(amount)} for ${period}. Your receipt is ready.`
      : `Your landlord approved ${inr(amount)} for ${period}. ${inr(result.outstandingAfter)} is still due.`,
    "/rent",
    "PAYMENT_SUCCESS",
  );
  res.locals.message = result.full ? "Approved — marked as paid" : `Approved — ${inr(result.outstandingAfter)} still due`;
  res.json({ id: r.id, status: "APPROVED", due: { id: r.rentPaymentId, status: result.full ? "PAID" : "PARTIAL", balance: result.outstandingAfter }, receipt: { id: r.rentPaymentId, number: result.receiptNumber } });
}

const rejectSchema = z.object({ reason: z.string().trim().min(5, "Tell the tenant why (at least 5 characters).").max(500) }).strict();

/** POST /api/v1/rent/payment-requests/:id/reject { reason } — the tenant is told why and can send again. */
export async function rejectPaymentRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const r = await landlordRequest(req);
  const { reason } = parseInput(rejectSchema, req.body);
  const done = await prisma.rentPaymentRequest.updateMany({
    where: { id: r.id, status: "PENDING" },
    data: { status: "REJECTED", pendingKey: null, rejectReason: reason, decidedById: user.id, decidedAt: new Date() },
  });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just answered. Refresh and check.");
  await logActivity(req, "rent.payment_request_reject", "rent_payment", r.rentPaymentId, { requestId: r.id, reason });
  await notify(r.tenantId, "Payment not approved", `Your landlord didn't approve your ${r.type === "DEPOSIT" ? "request to pay from the deposit" : "payment proof"} for ${periodLabel(r.rentPayment.period)}: ${reason}`, "/rent");
  res.locals.message = "Rejected. The tenant has been told why.";
  res.json({ id: r.id, status: "REJECTED", rejectReason: reason });
}

/** GET /api/v1/files/payment-proofs/:id — the proof photo; only that tenant and landlord (404 otherwise). */
export async function getPaymentProof(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const r = await prisma.rentPaymentRequest.findFirst({ where: { id: idParam(req), OR: [{ tenantId: user.id }, { landlordId: user.id }] }, select: { proofKey: true, proofMime: true } });
  if (!r?.proofKey) fail("not-found", REASONS.NOT_FOUND, "File not found.");
  storage.send(res, r!.proofKey!, r!.proofMime ?? "image/jpeg");
}
