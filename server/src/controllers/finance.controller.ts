import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { requestMeta, writeAuditLog } from "../lib/audit";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { periodOf } from "./rent.controller";

/**
 * Finance module — every handler here requires a finance permission (see routes).
 * All refunds, adjustments, reconciliations and commission changes are written to
 * admin_activity_logs and security_audit_logs.
 */

async function auditFinance(req: Request, action: string, metadata: Record<string, unknown>): Promise<void> {
  await writeAuditLog({ action: `finance.${action}`, outcome: "success", userId: me(req).id, metadata, ...requestMeta(req) });
}

const ref = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;

/* ─────────────── Transactions ─────────────── */

const TYPES = ["RENT_PAYMENT", "REFUND", "COMMISSION", "SERVICE_CHARGE", "SUBSCRIPTION", "ADJUSTMENT"] as const;
const TX_STATUS = ["PENDING", "SUCCESS", "FAILED", "REVERSED"] as const;

/** GET /api/finance/transactions */
export async function listTransactions(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const type = enumQuery(req, "type", TYPES);
  const status = enumQuery(req, "status", TX_STATUS);
  const reconciled = req.query.reconciled === "true" ? true : req.query.reconciled === "false" ? false : undefined;
  const where: Prisma.TransactionWhereInput = {
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(reconciled !== undefined ? { reconciled } : {}),
    ...(p.q ? { OR: [{ reference: { contains: p.q } }, { notes: { contains: p.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.transaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, include: { refunds: { select: { id: true, amount: true, status: true } } } }),
    prisma.transaction.count({ where }),
  ]);
  const userIds = [...new Set(items.flatMap((t) => [t.payerId, t.payeeId]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  res.json(paged(items.map((t) => ({ ...t, payerName: t.payerId ? names[t.payerId] ?? null : "SafeRent", payeeName: t.payeeId ? names[t.payeeId] ?? null : "SafeRent" })), total, p));
}

/** POST /api/finance/transactions/:id/reconcile — mark as matched with the bank/gateway statement. */
export async function reconcileTransaction(req: Request, res: Response): Promise<void> {
  const txn = found(await prisma.transaction.findUnique({ where: { id: idParam(req) } }), "Transaction");
  if (txn.reconciled) fail("failed-precondition", REASONS.INVALID_STATE, "Already reconciled.");
  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({ where: { id: txn.id }, data: { reconciled: true, reconciledById: me(req).id, reconciledAt: new Date() } });
    await logActivity(req, "transaction.reconcile", "transaction", txn.id, { reference: txn.reference }, tx);
  });
  await auditFinance(req, "reconcile", { transactionId: txn.id });
  res.json({ ok: true });
}

const commissionSettleSchema = z.object({ status: z.enum(["SUCCESS", "FAILED"]) });

/** POST /api/finance/transactions/:id/commission — settle a pending commission. */
export async function settleCommission(req: Request, res: Response): Promise<void> {
  const txn = found(await prisma.transaction.findFirst({ where: { id: idParam(req), type: "COMMISSION", status: "PENDING" } }), "Pending commission");
  const { status } = parseInput(commissionSettleSchema, req.body);
  await prisma.$transaction(async (tx) => {
    await tx.transaction.update({ where: { id: txn.id }, data: { status } });
    await logActivity(req, "commission.settle", "transaction", txn.id, { status, amount: txn.amount.toString() }, tx);
  });
  await auditFinance(req, "commission_settle", { transactionId: txn.id, status });
  res.json({ ok: true });
}

/* ─────────────── Invoices ─────────────── */

/** GET /api/finance/invoices */
export async function listInvoices(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = enumQuery(req, "status", ["DRAFT", "ISSUED", "PAID", "VOID"] as const);
  const where: Prisma.InvoiceWhereInput = { ...(status ? { status } : {}), ...(p.q ? { OR: [{ number: { contains: p.q } }, { description: { contains: p.q } }] } : {}) };
  const [items, total] = await Promise.all([prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.invoice.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.issuedToId) } }, select: { id: true, fullName: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  res.json(paged(items.map((i) => ({ ...i, issuedToName: names[i.issuedToId] ?? null })), total, p));
}

const invoiceSchema = z.object({
  issuedToPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, "Enter the customer's phone in international format."),
  description: z.string().trim().min(3).max(255),
  amount: z.coerce.number().positive().max(100_000_000),
  taxPercent: z.coerce.number().min(0).max(28).default(18),
  dueDate: z.coerce.date().optional(),
});

/** POST /api/finance/invoices — create a draft invoice (e.g. subscription, listing fee, service charge). */
export async function createInvoice(req: Request, res: Response): Promise<void> {
  const input = parseInput(invoiceSchema, req.body);
  const customer = found(await prisma.user.findFirst({ where: { phoneNumber: input.issuedToPhone }, select: { id: true } }), "Customer");
  const tax = Math.round(input.amount * input.taxPercent) / 100;
  const count = await prisma.invoice.count();
  const invoice = await prisma.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        number: `INV-${periodOf(new Date()).replace("-", "")}-${String(count + 1).padStart(5, "0")}`,
        issuedToId: customer.id,
        description: input.description,
        amount: input.amount,
        tax,
        total: input.amount + tax,
        dueDate: input.dueDate ?? null,
        createdById: me(req).id,
      },
    });
    await logActivity(req, "invoice.create", "invoice", created.id, { number: created.number, total: created.total.toString() }, tx);
    return created;
  });
  res.status(201).json({ invoice });
}

const invoiceActionSchema = z.object({ action: z.enum(["ISSUE", "MARK_PAID", "VOID"]), method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "CHEQUE"]).optional() });

/** POST /api/finance/invoices/:id/action — issue, mark paid (creates a transaction) or void. */
export async function invoiceAction(req: Request, res: Response): Promise<void> {
  const invoice = found(await prisma.invoice.findUnique({ where: { id: idParam(req) } }), "Invoice");
  const { action, method } = parseInput(invoiceActionSchema, req.body);
  const allowed: Record<string, string[]> = { ISSUE: ["DRAFT"], MARK_PAID: ["ISSUED"], VOID: ["DRAFT", "ISSUED"] };
  if (!allowed[action].includes(invoice.status)) fail("failed-precondition", REASONS.INVALID_STATE, `Cannot ${action.toLowerCase().replace("_", " ")} an invoice that is ${invoice.status}.`);

  await prisma.$transaction(async (tx) => {
    if (action === "ISSUE") await tx.invoice.update({ where: { id: invoice.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    if (action === "VOID") await tx.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
    if (action === "MARK_PAID") {
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
      await tx.transaction.create({
        data: { type: "SUBSCRIPTION", status: "SUCCESS", amount: invoice.total, payerId: invoice.issuedToId, invoiceId: invoice.id, method: method ?? "BANK_TRANSFER", reference: ref("INVP"), createdById: me(req).id, notes: invoice.number },
      });
    }
    await logActivity(req, `invoice.${action.toLowerCase()}`, "invoice", invoice.id, { number: invoice.number }, tx);
  });
  await auditFinance(req, `invoice_${action.toLowerCase()}`, { invoiceId: invoice.id });
  if (action === "ISSUE") await notify(invoice.issuedToId, "New invoice", `Invoice ${invoice.number} for ₹${invoice.total} has been issued.`);
  res.json({ ok: true });
}

/* ─────────────── Refunds ─────────────── */

/** GET /api/finance/refunds */
export async function listRefunds(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = enumQuery(req, "status", ["REQUESTED", "APPROVED", "REJECTED", "PROCESSED"] as const);
  const where: Prisma.RefundWhereInput = status ? { status } : {};
  const [items, total] = await Promise.all([
    prisma.refund.findMany({ where, include: { transaction: { select: { reference: true, amount: true, type: true } } }, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.refund.count({ where }),
  ]);
  res.json(paged(items, total, p));
}

const refundSchema = z.object({ transactionId: z.string().uuid(), amount: z.coerce.number().positive(), reason: z.string().trim().min(5).max(500) });

/** POST /api/finance/refunds — request a refund against a successful transaction. */
export async function requestRefund(req: Request, res: Response): Promise<void> {
  const input = parseInput(refundSchema, req.body);
  const txn = found(await prisma.transaction.findFirst({ where: { id: input.transactionId, status: "SUCCESS", type: { in: ["RENT_PAYMENT", "SUBSCRIPTION", "SERVICE_CHARGE"] } } }), "Refundable transaction");
  const already = await prisma.refund.aggregate({ where: { transactionId: txn.id, status: { in: ["REQUESTED", "APPROVED", "PROCESSED"] } }, _sum: { amount: true } });
  const remaining = Number(txn.amount) - Number(already._sum.amount ?? 0);
  if (input.amount > remaining) fail("invalid-argument", REASONS.INVALID_INPUT, `At most ₹${remaining.toFixed(2)} can still be refunded on this transaction.`);

  const refund = await prisma.$transaction(async (tx) => {
    const created = await tx.refund.create({ data: { transactionId: txn.id, amount: input.amount, reason: input.reason, requestedById: me(req).id } });
    await logActivity(req, "refund.request", "refund", created.id, { transaction: txn.reference, amount: input.amount, reason: input.reason }, tx);
    return created;
  });
  await auditFinance(req, "refund_request", { refundId: refund.id, amount: input.amount });
  res.status(201).json({ refund });
}

const refundDecisionSchema = z.object({ action: z.enum(["APPROVE", "REJECT", "PROCESS"]) });

/**
 * POST /api/finance/refunds/:id/decision — four-eyes rule: the person who requested a refund
 * cannot approve it (the founder is the only exception). Processing creates a REFUND transaction.
 */
export async function decideRefund(req: Request, res: Response): Promise<void> {
  const refund = found(await prisma.refund.findUnique({ where: { id: idParam(req) }, include: { transaction: true } }), "Refund");
  const { action } = parseInput(refundDecisionSchema, req.body);
  const actor = me(req);

  if (action !== "PROCESS" && refund.status !== "REQUESTED") fail("failed-precondition", REASONS.INVALID_STATE, "This refund has already been decided.");
  if (action === "PROCESS" && refund.status !== "APPROVED") fail("failed-precondition", REASONS.INVALID_STATE, "Only approved refunds can be processed.");
  if (action === "APPROVE" && refund.requestedById === actor.id && !actor.isFounder) {
    fail("permission-denied", REASONS.PERMISSION_DENIED, "A refund must be approved by someone other than the requester.");
  }

  await prisma.$transaction(async (tx) => {
    if (action === "APPROVE" || action === "REJECT") {
      await tx.refund.update({ where: { id: refund.id }, data: { status: action === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: actor.id, decidedAt: new Date() } });
    } else {
      await tx.refund.update({ where: { id: refund.id }, data: { status: "PROCESSED", processedAt: new Date() } });
      await tx.transaction.create({
        data: {
          type: "REFUND",
          status: "SUCCESS",
          amount: refund.amount,
          payerId: refund.transaction.payeeId,
          payeeId: refund.transaction.payerId,
          propertyId: refund.transaction.propertyId,
          method: refund.transaction.method,
          reference: ref("RFND"),
          notes: refund.reason,
          isTest: refund.transaction.isTest,
          createdById: actor.id,
        },
      });
      const processed = await tx.refund.aggregate({ where: { transactionId: refund.transactionId, status: "PROCESSED" }, _sum: { amount: true } });
      if (Number(processed._sum.amount ?? 0) >= Number(refund.transaction.amount)) {
        await tx.transaction.update({ where: { id: refund.transactionId }, data: { status: "REVERSED" } });
      }
    }
    await logActivity(req, `refund.${action.toLowerCase()}`, "refund", refund.id, { amount: refund.amount.toString() }, tx);
  });
  await auditFinance(req, `refund_${action.toLowerCase()}`, { refundId: refund.id });
  if (action === "PROCESS" && refund.transaction.payerId) await notify(refund.transaction.payerId, "Refund processed", `A refund of ₹${refund.amount} was processed.`);
  res.json({ ok: true });
}

/* ─────────────── Commission ─────────────── */

/** GET /api/finance/commission */
export async function getCommission(_req: Request, res: Response): Promise<void> {
  const setting = await prisma.platformSetting.findUnique({ where: { key: "commission_percent" } });
  const pending = await prisma.transaction.aggregate({ where: { type: "COMMISSION", status: "PENDING" }, _sum: { amount: true }, _count: { _all: true } });
  const earned = await prisma.transaction.aggregate({ where: { type: "COMMISSION", status: "SUCCESS" }, _sum: { amount: true } });
  res.json({ percent: Number(setting?.value ?? 0), pending: { count: pending._count._all, amount: pending._sum.amount ?? 0 }, earned: earned._sum.amount ?? 0 });
}

const commissionSchema = z.object({ percent: z.coerce.number().min(0).max(50) });

/** PUT /api/finance/commission — change the commission rate (applies to future payments). */
export async function setCommission(req: Request, res: Response): Promise<void> {
  const { percent } = parseInput(commissionSchema, req.body);
  const before = await prisma.platformSetting.findUnique({ where: { key: "commission_percent" } });
  await prisma.$transaction(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: "commission_percent" }, create: { key: "commission_percent", value: String(percent), updatedById: me(req).id }, update: { value: String(percent), updatedById: me(req).id } });
    await logActivity(req, "commission.update", "platform_setting", "commission_percent", { from: before?.value, to: percent }, tx);
  });
  await auditFinance(req, "commission_update", { from: before?.value, to: percent });
  res.json({ ok: true });
}

/* ─────────────── Reports ─────────────── */

/** GET /api/finance/reports — revenue analytics for the last 12 months. */
export async function financeReport(_req: Request, res: Response): Promise<void> {
  const since = new Date();
  since.setMonth(since.getMonth() - 11, 1);
  since.setHours(0, 0, 0, 0);

  const [txns, dues, refunds] = await Promise.all([
    prisma.transaction.findMany({ where: { createdAt: { gte: since }, status: { in: ["SUCCESS", "PENDING", "REVERSED"] } }, select: { type: true, status: true, amount: true, createdAt: true, isTest: true } }),
    prisma.rentPayment.groupBy({ by: ["status"], _sum: { amount: true }, _count: { _all: true } }),
    prisma.refund.aggregate({ where: { status: "PROCESSED" }, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const months: Record<string, { rent: number; commission: number; refunds: number }> = {};
  for (let i = 0; i < 12; i++) {
    const d = new Date(since);
    d.setMonth(since.getMonth() + i);
    months[periodOf(d)] = { rent: 0, commission: 0, refunds: 0 };
  }
  for (const t of txns) {
    const m = months[periodOf(t.createdAt)];
    if (!m) continue;
    if (t.type === "RENT_PAYMENT" && t.status !== "FAILED") m.rent += Number(t.amount);
    if (t.type === "COMMISSION" && t.status === "SUCCESS") m.commission += Number(t.amount);
    if (t.type === "REFUND") m.refunds += Number(t.amount);
  }
  const thisMonth = months[periodOf(new Date())];
  res.json({
    monthly: Object.entries(months).map(([period, v]) => ({ period, ...v })),
    totals: {
      collectedThisMonth: thisMonth?.rent ?? 0,
      dues: Object.fromEntries(dues.map((d) => [d.status, { count: d._count._all, amount: Number(d._sum.amount ?? 0) }])),
      refundsProcessed: { count: refunds._count._all, amount: Number(refunds._sum.amount ?? 0) },
      testTransactions: txns.filter((t) => t.isTest).length,
    },
  });
}
