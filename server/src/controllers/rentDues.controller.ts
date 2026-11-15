import type { Lease, Prisma, RentPayment } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { placeCode, placeCodeOf, placeLabels, placeOf, receiptNumberFor } from "../lib/places";
import { prisma } from "../lib/prisma";
import { periodOf } from "../lib/rentSchedule";
import { buildPdf, type PdfLine } from "../lib/simplePdf";
import { me } from "../middleware/auth";
import { parseInput } from "../lib/validation";
import { z } from "zod";
import { ensureRentSchedule, markOverdue, rentInclude } from "./rent.controller";
import { receiptPan } from "./pan.controller";

/*
 * Landlord rent screen (Android): one month at a time, three buckets.
 *   EXPECTED  — this month's rent not paid yet and not past its due date
 *   COLLECTED — this month's rent paid
 *   OVERDUE   — unpaid past the due date, for this month and any earlier month (arrears carry forward)
 * Waived rent is in none of them. Only the landlord's own leases; tenant phone numbers are never returned.
 */

export const BUCKETS = ["EXPECTED", "COLLECTED", "OVERDUE"] as const;
export type RentBucket = (typeof BUCKETS)[number];

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" → "Nov 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** ?period=YYYY-MM, default = current month (same value the dashboard returns as rent.period). */
export function periodParam(raw: unknown): string {
  if (raw === undefined || raw === "") return periodOf(new Date());
  if (typeof raw !== "string" || !PERIOD_RE.test(raw)) fail("invalid-argument", REASONS.INVALID_INPUT, "period must look like 2026-11 (YYYY-MM).");
  return raw as string;
}

export function bucketWhere(landlordId: string, bucket: RentBucket, period: string): Prisma.RentPaymentWhereInput {
  switch (bucket) {
    // A part-paid due (PARTIAL) is expected until its due date, overdue after it.
    case "EXPECTED":
      return { landlordId, period, OR: [{ status: "DUE" }, { status: "PARTIAL", dueDate: { gte: startOfToday() } }] };
    case "COLLECTED":
      return { landlordId, period, status: "PAID" };
    case "OVERDUE":
      return { landlordId, period: { lte: period }, OR: [{ status: "OVERDUE" }, { status: "PARTIAL", dueDate: { lt: startOfToday() } }] };
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Makes sure this month's dues exist and overdue ones are marked, before anything is counted. */
async function refreshLandlord(landlordId: string): Promise<void> {
  const leases = await prisma.lease.findMany({ where: { landlordId, status: "ACTIVE" } });
  for (const l of leases) await ensureRentSchedule(l);
  await markOverdue({ landlordId });
}

const sum = (v: Prisma.Decimal | null | undefined) => Number(v ?? 0);
const bucketTotal = (bucket: RentBucket, s: { amount: Prisma.Decimal | null; paidAmount: Prisma.Decimal | null }) =>
  bucket === "COLLECTED" ? sum(s.amount) : sum(s.amount) - sum(s.paidAmount);

/** Dashboard "rent" block — the same buckets and period as GET /rent/dues. */
export async function landlordRentSummary(landlordId: string, period = periodOf(new Date()), refresh = true) {
  if (refresh) await refreshLandlord(landlordId);
  const [expected, collected, overdue] = await Promise.all(
    BUCKETS.map((b) => prisma.rentPayment.aggregate({ where: bucketWhere(landlordId, b, period), _sum: { amount: true, paidAmount: true }, _count: { _all: true } })),
  );
  return {
    period,
    periodLabel: periodLabel(period),
    // Expected / overdue = still to collect (part payments already deducted).
    expected: { amount: bucketTotal("EXPECTED", expected._sum), count: expected._count._all },
    collected: { amount: bucketTotal("COLLECTED", collected._sum), count: collected._count._all },
    overdue: { amount: bucketTotal("OVERDUE", overdue._sum), count: overdue._count._all },
  };
}

type DueRow = RentPayment & Prisma.RentPaymentGetPayload<{ include: typeof rentInclude }>;

/** Receipt for money received on a due (PAID, or PARTIAL so far); its id works with GET /rent/receipts/:id/pdf. */
function receiptOf(r: RentPayment) {
  if (!r.receiptNumber || (r.status !== "PAID" && r.status !== "PARTIAL")) return null;
  return { id: r.id, number: r.receiptNumber, ...amountParts(r), amount: Number(r.paidAmount), paidAt: r.paidAt, mode: modeOf(r.method), period: periodLabel(r.period) };
}

const money = (v: number) => String(Math.round(v * 100) / 100);

/** Rent + maintenance breakup of a due; amount = totalAmount (kept for older clients). Strings, like "17000". */
export function amountParts(r: Pick<RentPayment, "amount" | "rentAmount" | "maintenanceAmount">) {
  const total = Number(r.amount);
  const maintenance = Number(r.maintenanceAmount ?? 0);
  const rent = r.rentAmount !== null && r.rentAmount !== undefined ? Number(r.rentAmount) : total - maintenance;
  return { rentAmount: money(rent), maintenanceAmount: money(maintenance), totalAmount: money(total), amount: money(total) };
}

const isUnpaid = (status: string) => status === "DUE" || status === "OVERDUE" || status === "PARTIAL";

function daysOverdueOf(r: RentPayment): number {
  const late = r.status === "OVERDUE" || (r.status === "PARTIAL" && r.dueDate < startOfToday());
  return late ? Math.max(0, Math.floor((startOfToday().getTime() - new Date(r.dueDate).getTime()) / 86_400_000)) : 0;
}

type LatestRequest = { id: string; type: string; status: string; amount: number; rejectReason: string | null; createdAt: Date } | null;

/** Latest tenant payment proof per due (shown on the due as `paymentRequest`). */
async function latestRequests(dueIds: string[]): Promise<Map<string, LatestRequest>> {
  if (!dueIds.length) return new Map();
  const rows = await prisma.rentPaymentRequest.findMany({ where: { rentPaymentId: { in: dueIds } }, orderBy: { createdAt: "desc" } });
  const map = new Map<string, LatestRequest>();
  for (const r of rows) if (!map.has(r.rentPaymentId)) map.set(r.rentPaymentId, { id: r.id, type: r.type, status: r.status, amount: Number(r.amount), rejectReason: r.rejectReason, createdAt: r.createdAt });
  return map;
}

const modeOf = (method: string | null) => (method === "ONLINE_TEST" ? "ONLINE" : method);

function canRemind(r: RentPayment): boolean {
  return isUnpaid(r.status) && (!r.lastReminderAt || r.lastReminderAt < startOfToday());
}

function presentDue(r: DueRow, places: Map<string, string>, requests: Map<string, LatestRequest>) {
  return {
    id: r.id,
    leaseId: r.leaseId,
    tenant: { fullName: r.lease.tenant.fullName },
    property: { id: r.lease.property.id, title: r.lease.property.title ?? r.lease.property.code },
    place: placeOf(places, r.lease),
    placeCode: placeCodeOf(places, r.lease) ?? r.lease.property.code,
    period: r.period,
    ...amountParts(r),
    dueDate: r.dueDate,
    status: r.status as "DUE" | "PAID" | "PARTIAL" | "OVERDUE",
    paidAmount: Number(r.paidAmount),
    balance: Math.max(0, Number(r.amount) - Number(r.paidAmount)),
    paidAt: r.paidAt,
    daysOverdue: daysOverdueOf(r),
    lastReminderAt: r.lastReminderAt,
    canRemind: canRemind(r),
    receipt: receiptOf(r),
    paymentRequest: requests.get(r.id) ?? null,
  };
}

/** GET /api/v1/rent/dues?status=EXPECTED|COLLECTED|OVERDUE&period=YYYY-MM — landlord's dues for one bucket. */
export async function listDues(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const raw = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "EXPECTED";
  if (!(BUCKETS as readonly string[]).includes(raw)) fail("invalid-argument", REASONS.INVALID_INPUT, "status must be EXPECTED, COLLECTED or OVERDUE.");
  const bucket = raw as RentBucket;
  const period = periodParam(req.query.period);
  await refreshLandlord(user.id);

  const where = bucketWhere(user.id, bucket, period);
  const [rows, agg] = await Promise.all([
    prisma.rentPayment.findMany({
      where,
      include: rentInclude,
      orderBy: bucket === "COLLECTED" ? [{ paidAt: "desc" }] : [{ dueDate: "asc" }],
      take: 500,
    }),
    prisma.rentPayment.aggregate({ where, _sum: { amount: true, paidAmount: true }, _count: { _all: true } }),
  ]);
  const [places, requests] = await Promise.all([placeLabels(rows.map((r) => r.lease)), latestRequests(rows.map((r) => r.id))]);
  // Envelope: data = items; meta = { total (₹ sum of this bucket), count, status, period, periodLabel }.
  res.json({ items: rows.map((r) => presentDue(r as DueRow, places, requests)), total: bucketTotal(bucket, agg._sum), count: agg._count._all, status: bucket, period, periodLabel: periodLabel(period) });
}

/** POST /api/v1/rent/dues/:id/remind — push + in-app reminder to the tenant (one per due per day). */
export async function remindDue(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await markOverdue({ landlordId: user.id });
  const due = found(await prisma.rentPayment.findFirst({ where: { id: idParam(req), landlordId: user.id }, include: rentInclude }), "Rent due");
  if (!isUnpaid(due.status)) fail("failed-precondition", REASONS.INVALID_STATE, due.status === "PAID" ? "This rent is already paid." : "This rent was waived. Nothing to remind.");
  const firstName = due.lease.tenant.fullName.split(/\s+/)[0] || due.lease.tenant.fullName;
  const now = new Date();
  const claimed = await prisma.rentPayment.updateMany({
    where: { id: due.id, status: { in: ["DUE", "OVERDUE", "PARTIAL"] }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday() } }] },
    data: { lastReminderAt: now, reminderCount: { increment: 1 } },
  });
  if (!claimed.count) fail("resource-exhausted", REASONS.RATE_LIMITED, `You already reminded ${firstName} today. You can send another reminder tomorrow.`);

  const places = await placeLabels([due.lease]);
  const where = placeOf(places, due.lease) ?? due.lease.property.title ?? due.lease.property.code;
  const amount = `₹${(Number(due.amount) - Number(due.paidAmount)).toLocaleString("en-IN")}`;
  const overdue = daysOverdueOf(due) > 0;
  await notify(
    due.tenantId,
    overdue ? "Rent overdue" : "Rent reminder",
    overdue
      ? `Rent of ${amount} for ${where} is overdue (due ${due.dueDate.toLocaleDateString("en-IN")}). Please pay your landlord.`
      : `Rent of ${amount} for ${where} is due on ${due.dueDate.toLocaleDateString("en-IN")}.`,
    "/rent",
  );
  await logActivity(req, "rent.remind", "rent_payment", due.id, { period: due.period, status: due.status });
  res.locals.message = `Reminder sent to ${firstName}`;
  res.json({ id: due.id, lastReminderAt: now, canRemind: false });
}

/** GET /api/v1/rent/receipts/:id/pdf — receipt PDF; only the landlord or the tenant of that rent (404 otherwise). */
export async function receiptPdf(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const id = idParam(req);
  const rent = await prisma.rentPayment.findFirst({ where: { id, status: { in: ["PAID", "PARTIAL"] }, receiptNumber: { not: null }, OR: [{ landlordId: user.id }, { tenantId: user.id }] }, include: rentInclude });
  if (!rent) {
    // A deposit receipt's id is the lease id.
    const lease = await prisma.lease.findFirst({ where: { id, depositPaidAt: { not: null }, OR: [{ landlordId: user.id }, { tenantId: user.id }] }, include: depositInclude });
    if (!lease) fail("not-found", REASONS.NOT_FOUND, "Receipt not found.");
    sendPdf(req, res, await depositReceiptLines(lease!), lease!.depositReceiptNumber ?? lease!.id);
    return;
  }
  const r = rent!;
  const places = await placeLabels([r.lease]);
  const place = placeOf(places, r.lease);
  const code = placeCodeOf(places, r.lease) ?? r.lease.property.code;
  const landlordPan = await receiptPan(r.lease.id, r.lease.landlord.id);
  const test = r.method === "ONLINE_TEST";
  const rs = (v: number) => `Rs. ${v.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const paidText = rs(Number(r.paidAmount));
  const lines: PdfLine[] = [
    { kind: "text", text: "SafeRent", size: 20, bold: true, color: [0.13, 0.36, 0.86] },
    { kind: "text", text: test ? "Rent Receipt (TEST, no money received)" : r.status === "PARTIAL" ? "Rent Receipt (part payment)" : "Rent Receipt", size: 15, bold: true },
    { kind: "text", text: `Receipt no. ${r.receiptNumber ?? ""}`, size: 10, color: [0.42, 0.45, 0.5] },
    { kind: "rule" },
    { kind: "row", label: r.status === "PARTIAL" ? "Paid so far" : "Amount paid", value: paidText, size: 13 },
    { kind: "row", label: "Rent", value: rs(Number(amountParts(r).rentAmount)) },
    ...(Number(r.maintenanceAmount) > 0 ? [{ kind: "row", label: "Maintenance", value: rs(Number(r.maintenanceAmount)) } as PdfLine] : []),
    { kind: "row", label: "Total for the month", value: rs(Number(r.amount)) },
    ...(r.status === "PARTIAL"
      ? [
          { kind: "row", label: "Balance due", value: `Rs. ${(Number(r.amount) - Number(r.paidAmount)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` } as PdfLine,
        ]
      : []),
    { kind: "row", label: "Rent period", value: periodLabel(r.period) },
    { kind: "row", label: "Paid on", value: r.paidAt ? r.paidAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "" },
    { kind: "row", label: "Mode", value: test ? "ONLINE (TEST)" : (r.method ?? "") },
    { kind: "rule" },
    { kind: "row", label: "Property", value: `${place ? `${place}, ` : ""}${r.lease.property.title ?? r.lease.property.code}${r.lease.property.city ? `, ${r.lease.property.city}` : ""}` },
    { kind: "row", label: "Unit ID", value: code },
    { kind: "row", label: "Lease", value: r.lease.code ?? "" },
    { kind: "row", label: "Tenant", value: r.lease.tenant.fullName },
    { kind: "row", label: "Landlord", value: r.lease.landlord.fullName },
    ...(landlordPan ? [{ kind: "row", label: "Landlord PAN", value: landlordPan } as PdfLine] : []),
    { kind: "rule" },
    { kind: "text", text: "Generated by SafeRent. This receipt reflects the payment recorded on the SafeRent platform.", size: 9, color: [0.42, 0.45, 0.5] },
  ];
  sendPdf(req, res, lines, r.receiptNumber ?? r.id);
}

function sendPdf(req: Request, res: Response, lines: PdfLine[], number: string): void {
  const pdf = buildPdf(lines, { title: `SafeRent receipt ${number}` });
  const file = `SafeRent-receipt-${number.replace(/[^\w.-]+/g, "_")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${file}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Length", String(pdf.length));
  res.end(pdf);
}

const depositInclude = {
  property: { select: { id: true, code: true, title: true, city: true } },
  tenant: { select: { id: true, fullName: true } },
  landlord: { select: { id: true, fullName: true } },
} satisfies Prisma.LeaseInclude;

async function depositReceiptLines(lease: Prisma.LeaseGetPayload<{ include: typeof depositInclude }>): Promise<PdfLine[]> {
  const places = await placeLabels([lease]);
  const place = placeOf(places, lease);
  const code = placeCodeOf(places, lease) ?? lease.property.code;
  const landlordPan = await receiptPan(lease.id, lease.landlord.id);
  const amount = Number(lease.depositPaidAmount ?? lease.securityDeposit);
  return [
    { kind: "text", text: "SafeRent", size: 20, bold: true, color: [0.13, 0.36, 0.86] },
    { kind: "text", text: "Security Deposit Receipt", size: 15, bold: true },
    { kind: "text", text: `Receipt no. ${lease.depositReceiptNumber ?? ""}`, size: 10, color: [0.42, 0.45, 0.5] },
    { kind: "rule" },
    { kind: "row", label: "Amount", value: `Rs. ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, size: 13 },
    { kind: "row", label: "Received on", value: lease.depositPaidAt ? lease.depositPaidAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "" },
    { kind: "row", label: "Mode", value: lease.depositMethod ?? "" },
    { kind: "rule" },
    { kind: "row", label: "Property", value: `${place ? `${place}, ` : ""}${lease.property.title ?? lease.property.code}${lease.property.city ? `, ${lease.property.city}` : ""}` },
    { kind: "row", label: "Unit ID", value: code },
    { kind: "row", label: "Lease", value: lease.code ?? "" },
    { kind: "row", label: "Tenant", value: lease.tenant.fullName },
    { kind: "row", label: "Landlord", value: lease.landlord.fullName },
    ...(landlordPan ? [{ kind: "row", label: "Landlord PAN", value: landlordPan } as PdfLine] : []),
    { kind: "rule" },
    { kind: "text", text: "Refundable security deposit, as per the lease. Generated by SafeRent from the payment recorded on the platform.", size: 9, color: [0.42, 0.45, 0.5] },
  ];
}

/* ─── Landlord transactions ─── */

const TX_TYPE: Record<string, string> = {
  RENT_PAYMENT: "RENT",
  REFUND: "REFUND",
  COMMISSION: "COMMISSION",
  SERVICE_CHARGE: "SERVICE_CHARGE",
  SUBSCRIPTION: "SUBSCRIPTION",
  ADJUSTMENT: "ADJUSTMENT",
  DEPOSIT: "DEPOSIT",
};

/**
 * GET /api/v1/rent/transactions?page=1&pageSize=30 — money in/out on the landlord's own properties,
 * newest first. IN = paid to the landlord (rent), OUT = paid by the landlord (commission, refunds …).
 */
export async function listTransactions(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const p = pagination(req);
  const owned = await prisma.property.findMany({ where: { ownerId: user.id, revisionOfId: null }, select: { id: true, title: true, code: true } });
  const props = new Map(owned.map((o) => [o.id, o]));
  const where: Prisma.TransactionWhereInput = { propertyId: { in: [...props.keys()] }, OR: [{ payeeId: user.id }, { payerId: user.id }] };
  if (!owned.length) {
    res.json(paged([], 0, p));
    return;
  }
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { rentPayment: { include: { lease: { select: { unitId: true, bedId: true, tenant: { select: { fullName: true } } } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: p.skip,
      take: p.take,
    }),
    prisma.transaction.count({ where }),
  ]);

  // Counterparty name when the row isn't tied to a rent due (refunds, adjustments …).
  const otherIds = [...new Set(rows.filter((t) => !t.rentPayment).map((t) => (t.payeeId === user.id ? t.payerId : t.payeeId)).filter((x): x is string => !!x && x !== user.id))];
  const others = otherIds.length ? await prisma.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, fullName: true } }) : [];
  const nameOf = new Map(others.map((u) => [u.id, u.fullName]));
  // Deposit transactions carry the lease in their reference ("DEP-<leaseId>").
  const depositLeaseIds = rows.filter((t) => t.type === "DEPOSIT" && t.reference.startsWith("DEP-")).map((t) => t.reference.slice(4));
  const depositLeases = depositLeaseIds.length ? await prisma.lease.findMany({ where: { id: { in: depositLeaseIds }, landlordId: user.id } }) : [];
  const depositOf = new Map(depositLeases.map((l) => [l.id, l]));
  const places = await placeLabels([...rows.flatMap((t) => (t.rentPayment ? [t.rentPayment.lease] : [])), ...depositLeases]);

  const items = rows.map((t) => {
    const rp = t.rentPayment;
    const prop = t.propertyId ? props.get(t.propertyId) : undefined;
    const other = t.payeeId === user.id ? t.payerId : t.payeeId;
    const type = t.type === "ADJUSTMENT" && t.method === "WAIVER" ? "WAIVER" : (TX_TYPE[t.type] ?? t.type);
    const dep = t.type === "DEPOSIT" ? depositOf.get(t.reference.slice(4)) : undefined;
    return {
      id: t.id,
      type,
      direction: t.payeeId === user.id ? "IN" : "OUT",
      amount: Number(t.amount),
      status: t.status,
      tenant: rp ? { fullName: rp.lease.tenant.fullName } : other && nameOf.has(other) ? { fullName: nameOf.get(other)! } : null,
      property: prop ? { id: prop.id, title: prop.title ?? prop.code } : null,
      place: rp ? placeOf(places, rp.lease) : dep ? placeOf(places, dep) : null,
      period: rp ? periodLabel(rp.period) : null,
      paidAt: (type === "RENT" ? rp?.paidAt : null) ?? t.createdAt,
      createdAt: t.createdAt,
      mode: modeOf(t.method),
      reference: t.reference,
      isTest: t.isTest,
      receipt: type === "RENT" && t.status === "SUCCESS" && rp ? receiptOf(rp) : dep ? depositReceiptOf(dep) : null,
    };
  });
  res.json(paged(items, total, p));
}

/* ─── Per-lease payments (tenant or landlord) ─── */

function depositReceiptOf(l: Lease) {
  if (!l.depositPaidAt) return null;
  return { id: l.id, number: l.depositReceiptNumber, amount: Number(l.depositPaidAmount ?? l.securityDeposit), paidAt: l.depositPaidAt, mode: l.depositMethod, period: "Security deposit" };
}

async function partyLease(req: Request) {
  const user = me(req);
  const lease = await prisma.lease.findFirst({ where: { id: idParam(req), OR: [{ tenantId: user.id }, { landlordId: user.id }] } });
  if (!lease) fail("not-found", REASONS.NOT_FOUND, "Lease not found.");
  return lease!;
}

/**
 * GET /api/v1/leases/:id/payments — the deposit and every month's rent of this lease so far
 * (newest first). Only the tenant or the landlord of the lease; anyone else gets 404.
 */
export async function leasePayments(req: Request, res: Response): Promise<void> {
  const lease = await partyLease(req);
  await ensureRentSchedule(lease);
  await markOverdue({ leaseId: lease.id });
  const rows = await prisma.rentPayment.findMany({ where: { leaseId: lease.id }, orderBy: { dueDate: "desc" } });
  const requests = await latestRequests(rows.map((r) => r.id));
  // Months paid from the deposit (approved "pay from deposit" requests).
  const depositUses = await prisma.rentPaymentRequest.findMany({ where: { leaseId: lease.id, type: "DEPOSIT", status: "APPROVED" }, orderBy: { decidedAt: "asc" } });
  const periodOfDue = new Map(rows.map((r) => [r.id, r.period]));
  const deposit = Number(lease.securityDeposit) > 0
    ? {
        amount: Number(lease.securityDeposit),
        paid: !!lease.depositPaidAt,
        paidAmount: lease.depositPaidAt ? Number(lease.depositPaidAmount ?? lease.securityDeposit) : 0,
        paidAt: lease.depositPaidAt,
        receipt: depositReceiptOf(lease),
        // `amount` is the original deposit and never changes; these show how much went to rent.
        initial: Number(lease.securityDeposit),
        usableAsRent: lease.depositUsableAsRent,
        used: Number(lease.depositUsedAmount),
        available: depositAvailable(lease),
        remaining: depositAvailable(lease),
        usedForRent: depositUses.map((u) => ({
          dueId: u.rentPaymentId,
          period: periodOfDue.has(u.rentPaymentId) ? periodLabel(periodOfDue.get(u.rentPaymentId)!) : null,
          amount: Number(u.approvedAmount ?? u.amount),
          at: u.decidedAt,
        })),
        refund: lease.depositRefundStatus
          ? { refunded: lease.depositRefundStatus, amount: lease.depositRefundAmount === null ? null : Number(lease.depositRefundAmount), reportedAt: lease.depositRefundReportedAt }
          : null,
      }
    : null;
  res.json({
    leaseId: lease.id,
    leaseStatus: lease.status,
    deposit,
    dues: rows.map((r) => ({
      id: r.id,
      period: periodLabel(r.period),
      periodKey: r.period,
      ...amountParts(r),
      dueDate: r.dueDate,
      // WAIVED = the landlord let this month go (nothing to pay).
      status: r.status as "DUE" | "PARTIAL" | "OVERDUE" | "PAID" | "WAIVED",
      paidAmount: Number(r.paidAmount),
      balance: r.status === "WAIVED" ? 0 : Math.max(0, Number(r.amount) - Number(r.paidAmount)),
      paidAt: r.paidAt,
      daysOverdue: daysOverdueOf(r),
      receipt: receiptOf(r),
      paymentRequest: requests.get(r.id) ?? null,
    })),
  });
}

const depositSchema = z
  .object({
    mode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE"]).optional(),
    amount: z.coerce.number().positive().max(100_000_000).optional(),
    paidAt: z.coerce.date().optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

/** POST /api/v1/leases/:id/deposit — the landlord records the security deposit as received (once). */
export async function recordDeposit(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = await partyLease(req);
  if (lease.landlordId !== user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the landlord can record the deposit.");
  if (Number(lease.securityDeposit) <= 0) fail("failed-precondition", REASONS.INVALID_STATE, "This lease has no security deposit.");
  if (lease.depositPaidAt) fail("failed-precondition", REASONS.INVALID_STATE, "The deposit is already recorded.");
  const input = parseInput(depositSchema, req.body);
  const paidAt = input.paidAt ?? new Date();
  if (paidAt.getTime() > Date.now() + 60_000) fail("invalid-argument", REASONS.INVALID_INPUT, "The received date can't be in the future.");
  const amount = input.amount ?? Number(lease.securityDeposit);

  await prisma.$transaction(async (tx) => {
    const code = await placeCode(tx, lease);
    let number = receiptNumberFor(code, "DEP");
    for (let attempt = 2; await tx.lease.count({ where: { depositReceiptNumber: number } }); attempt++) number = receiptNumberFor(code, "DEP", attempt);
    const claimed = await tx.lease.updateMany({
      where: { id: lease.id, depositPaidAt: null },
      data: { depositPaidAt: paidAt, depositPaidAmount: amount, depositMethod: input.mode ?? null, depositReceiptNumber: number, depositRecordedById: user.id },
    });
    if (!claimed.count) fail("failed-precondition", REASONS.INVALID_STATE, "The deposit is already recorded.");
    await tx.transaction.create({
      data: { type: "DEPOSIT", status: "SUCCESS", amount, payerId: lease.tenantId, payeeId: lease.landlordId, propertyId: lease.propertyId, method: input.mode ?? "OFFLINE", reference: `DEP-${lease.id}`, notes: input.notes ?? "Security deposit", createdById: user.id, createdAt: paidAt },
    });
    await logActivity(req, "lease.deposit_recorded", "lease", lease.id, { amount, mode: input.mode ?? null }, tx);
  });
  await notify(lease.tenantId, "Deposit received", `Your landlord recorded your security deposit of ₹${amount.toLocaleString("en-IN")} as received. The receipt is in Payments.`, "/rent", "PAYMENT_SUCCESS");
  res.locals.message = "Deposit recorded";
  res.status(201).json({ deposit: depositReceiptOf((await prisma.lease.findUniqueOrThrow({ where: { id: lease.id } }))) });
}

/**
 * Deposit still available to pay rent from: what the landlord holds (recorded amount, or the agreed
 * deposit if not recorded yet) minus what was already used. Every use is approved by the landlord.
 */
export function depositAvailable(l: Pick<Lease, "securityDeposit" | "depositPaidAt" | "depositPaidAmount" | "depositUsedAmount">): number {
  const held = l.depositPaidAt ? Number(l.depositPaidAmount ?? l.securityDeposit) : Number(l.securityDeposit);
  return Math.max(0, Math.round((held - Number(l.depositUsedAmount)) * 100) / 100);
}

const refundSchema = z
  .object({
    refunded: z.enum(["YES", "PARTIAL", "NO"]),
    amount: z.coerce.number().min(0).max(100_000_000).optional(),
  })
  .strict()
  .refine((v) => v.refunded !== "PARTIAL" || (v.amount !== undefined && v.amount > 0), { message: "Enter the amount you got back.", path: ["amount"] });

/**
 * POST /api/v1/leases/:id/deposit-refund { refunded: YES|PARTIAL|NO, amount? } — tenant, after the lease closed.
 * Stored on the lease and shown to the landlord and SafeRent admins. Can be updated (e.g. refunded later).
 */
export async function reportDepositRefund(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const lease = await partyLease(req);
  if (lease.tenantId !== user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the tenant can report the deposit refund.");
  if (lease.status === "ACTIVE") fail("failed-precondition", REASONS.INVALID_STATE, "You can report the deposit refund after the lease has closed.");
  const input = parseInput(refundSchema, req.body);
  const held = Math.max(0, (lease.depositPaidAt ? Number(lease.depositPaidAmount ?? lease.securityDeposit) : Number(lease.securityDeposit)) - Number(lease.depositUsedAmount));
  const amount = input.refunded === "YES" ? (input.amount ?? held) : input.refunded === "NO" ? 0 : input.amount!;
  await prisma.lease.update({ where: { id: lease.id }, data: { depositRefundStatus: input.refunded, depositRefundAmount: amount, depositRefundReportedAt: new Date() } });
  await logActivity(req, "lease.deposit_refund_reported", "lease", lease.id, { refunded: input.refunded, amount });
  if (input.refunded !== "YES") {
    await notify(lease.landlordId, "Deposit refund", input.refunded === "NO" ? "Your former tenant says the security deposit hasn't been refunded yet." : `Your former tenant says ₹${amount.toLocaleString("en-IN")} of the security deposit was refunded.`, `/leases/${lease.id}`, undefined, { leaseId: lease.id });
  }
  res.locals.message = "Thanks, saved";
  res.json({ refund: { refunded: input.refunded, amount, reportedAt: new Date() } });
}
