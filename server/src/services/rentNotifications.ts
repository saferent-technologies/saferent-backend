import { ensureRentSchedule, markOverdue } from "../controllers/rent.controller";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";

/*
 * Automatic rent notifications (runs from jobs.ts; idempotent, each due is notified once per event):
 *   - on the due date      → tenant: "Rent due today"
 *   - the day after it     → tenant: "Rent overdue", landlord: "Rent from <tenant> is overdue"
 * Dues are created for every active lease first, so nothing depends on someone opening the app.
 */

const BATCH = 200;
let lastSchedule = 0;

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN")}`;
const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

async function createDuesForAllLeases(): Promise<void> {
  // At most hourly — dues only change at month start, and every rent read also does this per user.
  if (Date.now() - lastSchedule < 60 * 60 * 1000) return;
  lastSchedule = Date.now();
  let cursor: string | undefined;
  for (;;) {
    const leases = await prisma.lease.findMany({ where: { status: "ACTIVE" }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    for (const l of leases) await ensureRentSchedule(l);
    if (leases.length < BATCH) break;
    cursor = leases[leases.length - 1].id;
  }
}

const dueInclude = { lease: { select: { unitId: true, bedId: true, status: true, property: { select: { title: true, code: true } }, tenant: { select: { fullName: true } } } } } as const;

export async function sendRentNotifications(): Promise<number> {
  await createDuesForAllLeases();
  await markOverdue({});
  let sent = 0;

  // 1) Due today (the due date has come and it's still unpaid, not yet overdue).
  const dueNow = await prisma.rentPayment.findMany({ where: { status: "DUE", dueNotifiedAt: null, dueDate: { lte: new Date() } }, include: dueInclude, take: BATCH });
  const duePlaces = await placeLabels(dueNow.map((r) => r.lease));
  for (const r of dueNow) {
    const claimed = await prisma.rentPayment.updateMany({ where: { id: r.id, dueNotifiedAt: null, status: "DUE" }, data: { dueNotifiedAt: new Date() } });
    if (!claimed.count) continue;
    const where = placeOf(duePlaces, r.lease) ?? r.lease.property.title ?? r.lease.property.code;
    await notify(r.tenantId, "Rent due today", `Rent of ${inr(r.amount)} for ${where} is due today (${day(r.dueDate)}).`, "/rent", "RENT_DUE");
    sent++;
  }

  // 2) Turned overdue (status flips the day after the due date).
  const overdue = await prisma.rentPayment.findMany({ where: { status: "OVERDUE", overdueNotifiedAt: null }, include: dueInclude, take: BATCH });
  const odPlaces = await placeLabels(overdue.map((r) => r.lease));
  for (const r of overdue) {
    const claimed = await prisma.rentPayment.updateMany({ where: { id: r.id, overdueNotifiedAt: null, status: "OVERDUE" }, data: { overdueNotifiedAt: new Date(), dueNotifiedAt: r.dueNotifiedAt ?? new Date() } });
    if (!claimed.count) continue;
    const where = placeOf(odPlaces, r.lease) ?? r.lease.property.title ?? r.lease.property.code;
    await notify(r.tenantId, "Rent overdue", `Rent of ${inr(r.amount)} for ${where} was due on ${day(r.dueDate)} and is now overdue. Please pay your landlord.`, "/rent", "RENT_OVERDUE");
    await notify(r.landlordId, "Rent overdue", `Rent of ${inr(r.amount)} from ${r.lease.tenant.fullName} for ${where} (due ${day(r.dueDate)}) is overdue.`, "/rent", "RENT_OVERDUE");
    sent++;
  }
  return sent;
}
