import type { Prisma, RentPayment } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { found, idParam } from "../lib/http";
import { notify } from "../lib/notify";
import { placeCodeOf, placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { periodOf } from "../lib/rentSchedule";
import { buildPdf, type PdfLine } from "../lib/simplePdf";
import { me } from "../middleware/auth";
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
    case "EXPECTED":
      return { landlordId, period, status: "DUE" };
    case "COLLECTED":
      return { landlordId, period, status: "PAID" };
    case "OVERDUE":
      return { landlordId, period: { lte: period }, status: "OVERDUE" };
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

/** Dashboard "rent" block — the same buckets and period as GET /rent/dues. */
export async function landlordRentSummary(landlordId: string, period = periodOf(new Date()), refresh = true) {
  if (refresh) await refreshLandlord(landlordId);
  const [expected, collected, overdue] = await Promise.all(
    BUCKETS.map((b) => prisma.rentPayment.aggregate({ where: bucketWhere(landlordId, b, period), _sum: { amount: true }, _count: { _all: true } })),
  );
  return {
    period,
    periodLabel: periodLabel(period),
    expected: { amount: sum(expected._sum.amount), count: expected._count._all },
    collected: { amount: sum(collected._sum.amount), count: collected._count._all },
    overdue: { amount: sum(overdue._sum.amount), count: overdue._count._all },
  };
}

type DueRow = RentPayment & Prisma.RentPaymentGetPayload<{ include: typeof rentInclude }>;

function canRemind(r: RentPayment): boolean {
  return (r.status === "DUE" || r.status === "OVERDUE") && (!r.lastReminderAt || r.lastReminderAt < startOfToday());
}

function presentDue(r: DueRow, places: Map<string, string>) {
  const today = startOfToday();
  const paid = r.status === "PAID";
  return {
    id: r.id,
    leaseId: r.leaseId,
    tenant: { fullName: r.lease.tenant.fullName },
    property: { id: r.lease.property.id, title: r.lease.property.title ?? r.lease.property.code },
    place: placeOf(places, r.lease),
    placeCode: placeCodeOf(places, r.lease) ?? r.lease.property.code,
    period: r.period,
    amount: Number(r.amount),
    dueDate: r.dueDate,
    // PARTIAL is reserved — part payments aren't recorded yet, so a due is either fully paid or not.
    status: r.status as "DUE" | "PAID" | "PARTIAL" | "OVERDUE",
    paidAmount: paid ? Number(r.amount) : 0,
    paidAt: r.paidAt,
    daysOverdue: r.status === "OVERDUE" ? Math.max(0, Math.floor((today.getTime() - new Date(r.dueDate).getTime()) / 86_400_000)) : 0,
    lastReminderAt: r.lastReminderAt,
    canRemind: canRemind(r),
    receipt: paid
      ? { id: r.id, number: r.receiptNumber, amount: Number(r.amount), paidAt: r.paidAt, mode: r.method === "ONLINE_TEST" ? "ONLINE" : r.method, period: periodLabel(r.period) }
      : null,
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
    prisma.rentPayment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const places = await placeLabels(rows.map((r) => r.lease));
  // Envelope: data = items; meta = { total (₹ sum of this bucket), count, status, period, periodLabel }.
  res.json({ items: rows.map((r) => presentDue(r as DueRow, places)), total: sum(agg._sum.amount), count: agg._count._all, status: bucket, period, periodLabel: periodLabel(period) });
}

/** POST /api/v1/rent/dues/:id/remind — push + in-app reminder to the tenant (one per due per day). */
export async function remindDue(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await markOverdue({ landlordId: user.id });
  const due = found(await prisma.rentPayment.findFirst({ where: { id: idParam(req), landlordId: user.id }, include: rentInclude }), "Rent due");
  if (due.status !== "DUE" && due.status !== "OVERDUE") fail("failed-precondition", REASONS.INVALID_STATE, due.status === "PAID" ? "This rent is already paid." : "This rent was waived — nothing to remind.");
  const firstName = due.lease.tenant.fullName.split(/\s+/)[0] || due.lease.tenant.fullName;
  const now = new Date();
  const claimed = await prisma.rentPayment.updateMany({
    where: { id: due.id, status: { in: ["DUE", "OVERDUE"] }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday() } }] },
    data: { lastReminderAt: now, reminderCount: { increment: 1 } },
  });
  if (!claimed.count) fail("resource-exhausted", REASONS.RATE_LIMITED, `You already reminded ${firstName} today. You can send another reminder tomorrow.`);

  const places = await placeLabels([due.lease]);
  const where = placeOf(places, due.lease) ?? due.lease.property.title ?? due.lease.property.code;
  const amount = `₹${Number(due.amount).toLocaleString("en-IN")}`;
  const overdue = due.status === "OVERDUE";
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
  const rent = await prisma.rentPayment.findFirst({ where: { id: idParam(req), status: "PAID", OR: [{ landlordId: user.id }, { tenantId: user.id }] }, include: rentInclude });
  if (!rent) fail("not-found", REASONS.NOT_FOUND, "Receipt not found.");
  const r = rent!;
  const places = await placeLabels([r.lease]);
  const place = placeOf(places, r.lease);
  const code = placeCodeOf(places, r.lease) ?? r.lease.property.code;
  const landlordPan = await receiptPan(r.lease.id, r.lease.landlord.id);
  const test = r.method === "ONLINE_TEST";
  const money = `Rs. ${Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  const lines: PdfLine[] = [
    { kind: "text", text: "SafeRent", size: 20, bold: true, color: [0.13, 0.36, 0.86] },
    { kind: "text", text: test ? "Rent Receipt (TEST - no money received)" : "Rent Receipt", size: 15, bold: true },
    { kind: "text", text: `Receipt no. ${r.receiptNumber ?? ""}`, size: 10, color: [0.42, 0.45, 0.5] },
    { kind: "rule" },
    { kind: "row", label: "Amount", value: money, size: 13 },
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
  const pdf = buildPdf(lines, { title: `Rent receipt ${r.receiptNumber ?? ""}` });
  const file = `SafeRent-receipt-${(r.receiptNumber ?? r.id).replace(/[^\w.-]+/g, "_")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${file}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Length", String(pdf.length));
  res.end(pdf);
}
