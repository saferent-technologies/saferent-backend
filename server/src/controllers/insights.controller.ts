import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { and, maintenanceWhere, propertyWhere } from "../rbac/access";
import { DEFAULT_SETTINGS, ROLES, type RoleKey } from "../rbac/catalog";
import { ensureRentSchedule } from "./rent.controller";

type Card = { key: string; label: string; value: number | string; hint?: string; tone?: "brand" | "success" | "warning" | "danger" };
const money = (v: unknown) => Number(v ?? 0);

/**
 * GET /api/dashboard — a role-specific dashboard computed on the server. Every number is scoped
 * to what the role may see (a landlord's numbers only cover their own properties, etc.).
 */
export async function dashboard(req: Request, res: Response): Promise<void> {
  const user = me(req);
  // Multi-role accounts choose which dashboard to see (?role=TENANT); only roles they hold are accepted.
  const requested = typeof req.query.role === "string" ? (req.query.role as RoleKey) : undefined;
  const role = requested && user.roles.includes(requested) ? requested : (user.role as RoleKey);
  const cards: Card[] = [];
  const lists: Record<string, unknown[]> = {};

  switch (role) {
    case "SUPER_ADMIN":
    case "ADMIN": {
      const [users, activeUsers, pendingListings, openTickets, openFraud, byRole] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { accountStatus: "ACTIVE", lastLoginAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
        prisma.property.count({ where: { publicationStatus: "PENDING_VERIFICATION", activeStatus: "ACTIVE" } }),
        prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        prisma.fraudReport.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
        prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      ]);
      cards.push(
        { key: "users", label: "Total users", value: users },
        { key: "active", label: "Active (30 days)", value: activeUsers, tone: "success" },
        { key: "pending", label: "Listings to review", value: pendingListings, tone: "warning" },
        { key: "tickets", label: "Open tickets", value: openTickets },
        { key: "fraud", label: "Fraud reports", value: openFraud, tone: openFraud ? "danger" : undefined },
      );
      if (role === "SUPER_ADMIN") {
        const revenue = await prisma.transaction.aggregate({ where: { type: "RENT_PAYMENT", status: "SUCCESS", createdAt: { gte: startOfMonth() } }, _sum: { amount: true } });
        cards.push({ key: "revenue", label: "Rent collected this month", value: money(revenue._sum.amount), tone: "brand" });
      }
      lists.usersByRole = byRole.map((r) => ({ role: r.role, count: r._count._all }));
      lists.recentActivity = (await prisma.adminActivityLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 })).map((a) => ({ id: a.id.toString(), action: a.action, targetType: a.targetType, createdAt: a.createdAt }));
      break;
    }
    case "FINANCE_ADMIN": {
      const [collected, due, overdue, refunds, commission] = await Promise.all([
        prisma.transaction.aggregate({ where: { type: "RENT_PAYMENT", status: "SUCCESS", createdAt: { gte: startOfMonth() } }, _sum: { amount: true } }),
        prisma.rentPayment.aggregate({ where: { status: "DUE" }, _sum: { amount: true }, _count: { _all: true } }),
        prisma.rentPayment.aggregate({ where: { status: "OVERDUE" }, _sum: { amount: true }, _count: { _all: true } }),
        prisma.refund.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
        prisma.transaction.aggregate({ where: { type: "COMMISSION", status: "PENDING" }, _sum: { amount: true } }),
      ]);
      cards.push(
        { key: "collected", label: "Collected this month", value: money(collected._sum.amount), tone: "success" },
        { key: "due", label: `Pending rent (${due._count._all})`, value: money(due._sum.amount) },
        { key: "overdue", label: `Overdue (${overdue._count._all})`, value: money(overdue._sum.amount), tone: "danger" },
        { key: "refunds", label: "Refunds to action", value: refunds, tone: "warning" },
        { key: "commission", label: "Commission pending", value: money(commission._sum.amount) },
      );
      lists.recentTransactions = await prisma.transaction.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, type: true, status: true, amount: true, reference: true, createdAt: true } });
      break;
    }
    case "PROPERTY_MANAGER": {
      const scope = propertyWhere(user)!;
      const [assigned, vacant, inspections, pendingApps, openMaint] = await Promise.all([
        prisma.property.count({ where: scope }),
        prisma.property.count({ where: and(scope, { activeStatus: "ACTIVE", availableCount: { gt: 0 } }) }),
        prisma.propertyInspection.count({ where: { property: scope, status: "SCHEDULED" } }),
        prisma.rentalApplication.count({ where: { property: scope, status: "PENDING" } }),
        prisma.maintenanceRequest.count({ where: and(maintenanceWhere(user)!, { status: { in: ["OPEN", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"] } }) }),
      ]);
      cards.push(
        { key: "assigned", label: "Assigned properties", value: assigned, tone: "brand" },
        { key: "vacant", label: "Vacant", value: vacant, tone: "warning" },
        { key: "inspections", label: "Upcoming inspections", value: inspections },
        { key: "applications", label: "Pending applications", value: pendingApps },
        { key: "maintenance", label: "Open maintenance", value: openMaint },
      );
      lists.upcomingInspections = await prisma.propertyInspection.findMany({ where: { property: scope, status: "SCHEDULED" }, include: { property: { select: { id: true, title: true } } }, orderBy: { scheduledAt: "asc" }, take: 6 });
      break;
    }
    case "SUPPORT": {
      const [open, mine, inProgress, resolvedToday] = await Promise.all([
        prisma.supportTicket.count({ where: { status: "OPEN" } }),
        prisma.supportTicket.count({ where: { assignedToId: user.id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        prisma.supportTicket.count({ where: { status: "IN_PROGRESS" } }),
        prisma.supportTicket.count({ where: { status: "RESOLVED", resolvedAt: { gte: startOfDay() } } }),
      ]);
      cards.push(
        { key: "open", label: "Open tickets", value: open, tone: "warning" },
        { key: "mine", label: "Assigned to me", value: mine, tone: "brand" },
        { key: "progress", label: "In progress", value: inProgress },
        { key: "resolved", label: "Resolved today", value: resolvedToday, tone: "success" },
      );
      lists.unassigned = await prisma.supportTicket.findMany({ where: { assignedToId: null, status: "OPEN" }, orderBy: { createdAt: "asc" }, take: 8, select: { id: true, subject: true, category: true, priority: true, createdAt: true } });
      break;
    }
    case "MODERATOR": {
      const [listings, images, documents, fraud] = await Promise.all([
        prisma.property.count({ where: { publicationStatus: "PENDING_VERIFICATION", activeStatus: "ACTIVE" } }),
        prisma.propertyImage.count({ where: { status: "PENDING" } }),
        prisma.propertyDocument.count({ where: { status: "PENDING", needsVerification: true, isCurrent: true, archivedAt: null } }),
        prisma.fraudReport.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }),
      ]);
      cards.push(
        { key: "listings", label: "Listings to review", value: listings, tone: "warning" },
        { key: "images", label: "Images to review", value: images },
        { key: "documents", label: "Documents to verify", value: documents },
        { key: "fraud", label: "Fraud reports", value: fraud, tone: fraud ? "danger" : undefined },
      );
      break;
    }
    case "VIEWER": {
      const [properties, active, leases, users] = await Promise.all([
        prisma.property.count(),
        prisma.property.count({ where: { publicationStatus: "PUBLISHED", activeStatus: "ACTIVE" } }),
        prisma.lease.count({ where: { status: "ACTIVE" } }),
        prisma.user.count({ where: { role: { in: ["LANDLORD", "TENANT"] } } }),
      ]);
      cards.push(
        { key: "properties", label: "Properties", value: properties },
        { key: "active", label: "Active listings", value: active, tone: "success" },
        { key: "leases", label: "Active leases", value: leases },
        { key: "customers", label: "Landlords & tenants", value: users },
      );
      break;
    }
    case "LANDLORD": {
      const leases = await prisma.lease.findMany({ where: { landlordId: user.id, status: "ACTIVE" } });
      for (const l of leases) await ensureRentSchedule(l);
      const [properties, pendingApps, pendingRent, income, maint] = await Promise.all([
        prisma.property.groupBy({ by: ["publicationStatus"], where: { ownerId: user.id, activeStatus: { not: "ARCHIVED" } }, _count: { _all: true } }),
        prisma.rentalApplication.count({ where: { property: { ownerId: user.id }, status: "PENDING" } }),
        prisma.rentPayment.aggregate({ where: { landlordId: user.id, status: { in: ["DUE", "OVERDUE"] } }, _sum: { amount: true }, _count: { _all: true } }),
        prisma.rentPayment.aggregate({ where: { landlordId: user.id, status: "PAID", paidAt: { gte: startOfMonth() } }, _sum: { amount: true } }),
        prisma.maintenanceRequest.count({ where: { landlordId: user.id, status: { in: ["OPEN", "ASSIGNED", "ACCEPTED", "IN_PROGRESS"] } } }),
      ]);
      const total = properties.reduce((s, p) => s + p._count._all, 0);
      cards.push(
        { key: "properties", label: "My properties", value: total, tone: "brand" },
        { key: "tenants", label: "Active tenants", value: leases.length, tone: "success" },
        { key: "applications", label: "Pending applications", value: pendingApps, tone: pendingApps ? "warning" : undefined },
        { key: "income", label: "Income this month", value: money(income._sum.amount), tone: "success" },
        { key: "pendingRent", label: `Pending rent (${pendingRent._count._all})`, value: money(pendingRent._sum.amount) },
        { key: "maintenance", label: "Open maintenance", value: maint },
      );
      lists.propertiesByStatus = properties.map((p) => ({ status: p.publicationStatus, count: p._count._all }));
      break;
    }
    case "TENANT": {
      const lease = await prisma.lease.findFirst({
        where: { tenantId: user.id, status: "ACTIVE" },
        include: { property: { select: { id: true, title: true, addressLine: true, city: true } }, landlord: { select: { fullName: true, phoneNumber: true } } },
      });
      if (lease) await ensureRentSchedule(lease);
      const [nextDue, applications, openMaint] = await Promise.all([
        prisma.rentPayment.findFirst({ where: { tenantId: user.id, status: { in: ["DUE", "OVERDUE"] } }, orderBy: { dueDate: "asc" } }),
        prisma.rentalApplication.count({ where: { tenantId: user.id, status: "PENDING" } }),
        prisma.maintenanceRequest.count({ where: { raisedById: user.id, status: { notIn: ["CLOSED", "CANCELLED"] } } }),
      ]);
      cards.push(
        { key: "rent", label: nextDue ? `Rent due ${nextDue.dueDate.toLocaleDateString("en-IN")}` : "No rent due", value: nextDue ? money(nextDue.amount) : 0, tone: nextDue?.status === "OVERDUE" ? "danger" : "brand" },
        { key: "applications", label: "Pending applications", value: applications },
        { key: "maintenance", label: "Open requests", value: openMaint },
      );
      lists.currentRental = lease
        ? [{ leaseId: lease.id, property: lease.property, monthlyRent: lease.monthlyRent, endDate: lease.endDate, rentDueDay: lease.rentDueDay, landlord: lease.landlord }]
        : [];
      break;
    }
    case "PROPERTY_AGENT": {
      const scope = propertyWhere(user)!;
      const [listings, newEnquiries, followUps, visits] = await Promise.all([
        prisma.property.count({ where: scope }),
        prisma.enquiry.count({ where: { property: scope, status: "NEW" } }),
        prisma.enquiry.count({ where: { property: scope, followUpAt: { lte: new Date(Date.now() + 86400_000) }, status: { not: "CLOSED" } } }),
        prisma.propertyVisit.count({ where: { agentId: user.id, status: "SCHEDULED", scheduledAt: { gte: new Date() } } }),
      ]);
      cards.push(
        { key: "listings", label: "Assigned listings", value: listings, tone: "brand" },
        { key: "enquiries", label: "New enquiries", value: newEnquiries, tone: newEnquiries ? "warning" : undefined },
        { key: "followups", label: "Follow-ups due", value: followUps },
        { key: "visits", label: "Upcoming visits", value: visits, tone: "success" },
      );
      lists.upcomingVisits = await prisma.propertyVisit.findMany({ where: { agentId: user.id, status: "SCHEDULED", scheduledAt: { gte: new Date() } }, include: { property: { select: { id: true, title: true } } }, orderBy: { scheduledAt: "asc" }, take: 6 });
      break;
    }
    case "SERVICE_PROVIDER": {
      const [newJobs, active, completed, earnings] = await Promise.all([
        prisma.maintenanceRequest.count({ where: { assignedProviderId: user.id, status: "ASSIGNED" } }),
        prisma.maintenanceRequest.count({ where: { assignedProviderId: user.id, status: { in: ["ACCEPTED", "IN_PROGRESS"] } } }),
        prisma.maintenanceRequest.count({ where: { assignedProviderId: user.id, status: { in: ["COMPLETED", "CLOSED"] } } }),
        prisma.maintenanceRequest.aggregate({ where: { assignedProviderId: user.id, status: { in: ["COMPLETED", "CLOSED"] }, completedAt: { gte: startOfMonth() } }, _sum: { serviceCharge: true } }),
      ]);
      cards.push(
        { key: "new", label: "New jobs", value: newJobs, tone: newJobs ? "warning" : undefined },
        { key: "active", label: "In progress", value: active, tone: "brand" },
        { key: "completed", label: "Completed", value: completed, tone: "success" },
        { key: "earnings", label: "Charges this month", value: money(earnings._sum.serviceCharge) },
      );
      break;
    }
  }

  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  res.json({ role, cards, lists, unreadNotifications: unread });
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** GET /api/reports/properties — per-property report within the reports.view scope (landlord: own income). */
export async function propertyReport(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = propertyWhere(user, "reports.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const [properties, total] = await Promise.all([
    prisma.property.findMany({ where: scope, select: { id: true, code: true, title: true, city: true, publicationStatus: true, activeStatus: true, rentFrom: true, rentTo: true, availableCount: true, occupiedCount: true }, orderBy: { title: "asc" }, skip: p.skip, take: p.take }),
    prisma.property.count({ where: scope }),
  ]);
  const ids = properties.map((x) => x.id);
  // Financial columns only for those allowed to see rent for these properties.
  const showMoney = user.roles.some((r) => r === "LANDLORD" || r === "SUPER_ADMIN" || r === "FINANCE_ADMIN") || !!user.permissions["rent.view"]?.includes("ALL");
  const [paid, pending, leases, maint] = await Promise.all([
    showMoney ? prisma.rentPayment.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, status: "PAID" }, _sum: { amount: true } }) : [],
    showMoney ? prisma.rentPayment.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, status: { in: ["DUE", "OVERDUE"] } }, _sum: { amount: true } }) : [],
    prisma.lease.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.maintenanceRequest.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, status: { notIn: ["CLOSED", "CANCELLED"] } }, _count: { _all: true } }),
  ]);
  const pick = <T extends { propertyId: string }>(rows: T[], id: string) => rows.find((r) => r.propertyId === id);
  res.json(
    paged(
      properties.map((prop) => ({
        ...prop,
        occupied: (pick(leases, prop.id)?._count._all ?? 0) > 0,
        openMaintenance: pick(maint, prop.id)?._count._all ?? 0,
        ...(showMoney ? { rentCollected: money(pick(paid, prop.id)?._sum.amount), rentPending: money(pick(pending, prop.id)?._sum.amount) } : {}),
      })),
      total,
      p,
    ),
  );
}

/** GET /api/reports/overview — platform-wide counts (reports.view ALL: admins, finance, viewers). */
export async function overviewReport(req: Request, res: Response): Promise<void> {
  if (!me(req).permissions["reports.view"]?.includes("ALL")) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const [usersByRole, propertiesByStatus, leasesByStatus, ticketsByStatus, maintenanceByStatus] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.property.groupBy({ by: ["publicationStatus"], _count: { _all: true } }),
    prisma.lease.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.maintenanceRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const shape = <K extends string>(rows: Array<{ _count: { _all: number } } & Record<K, string>>, key: K) => rows.map((r) => ({ key: r[key], count: r._count._all }));
  res.json({
    usersByRole: shape(usersByRole, "role"),
    propertiesByStatus: shape(propertiesByStatus, "publicationStatus"),
    leasesByStatus: shape(leasesByStatus, "status"),
    ticketsByStatus: shape(ticketsByStatus, "status"),
    maintenanceByStatus: shape(maintenanceByStatus, "status"),
  });
}

/* ─────────────── Platform settings & subscriptions ─────────────── */

/** GET /api/settings */
export async function getSettings(_req: Request, res: Response): Promise<void> {
  const rows = await prisma.platformSetting.findMany();
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
}

const settingsSchema = z.object({ settings: z.record(z.string(), z.string().max(500)) });

/** PUT /api/settings — only keys known to the platform can be changed. */
export async function updateSettings(req: Request, res: Response): Promise<void> {
  const { settings } = parseInput(settingsSchema, req.body);
  const allowed = Object.keys(DEFAULT_SETTINGS);
  const unknown = Object.keys(settings).filter((k) => !allowed.includes(k));
  if (unknown.length) fail("invalid-argument", REASONS.INVALID_INPUT, `Unknown setting: ${unknown[0]}`);
  if (settings.commission_percent !== undefined && !(Number(settings.commission_percent) >= 0 && Number(settings.commission_percent) <= 50)) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "Commission must be between 0 and 50%.");
  }
  if (settings.review_window_days !== undefined && !(Number.isInteger(Number(settings.review_window_days)) && Number(settings.review_window_days) >= 1 && Number(settings.review_window_days) <= 60)) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "Review window must be 1 to 60 days.");
  }
  const before = await prisma.platformSetting.findMany({ where: { key: { in: Object.keys(settings) } } });
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(settings)) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value, updatedById: me(req).id }, update: { value, updatedById: me(req).id } });
    }
    await logActivity(req, "settings.update", "platform_setting", null, { before: Object.fromEntries(before.map((b) => [b.key, b.value])), after: settings }, tx);
  });
  res.json({ ok: true });
}

/** GET /api/subscriptions/plans */
export async function listPlans(_req: Request, res: Response): Promise<void> {
  const plans = await prisma.subscriptionPlan.findMany({ orderBy: { priceMonthly: "asc" }, include: { _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } } });
  res.json({ items: plans });
}

const planSchema = z.object({
  name: z.string().trim().min(2).max(60),
  audience: z.enum(ROLES),
  priceMonthly: z.coerce.number().min(0).max(1_000_000),
  features: z.string().trim().max(2000).optional(),
  active: z.boolean().default(true),
});

/** POST /api/subscriptions/plans */
export async function createPlan(req: Request, res: Response): Promise<void> {
  const input = parseInput(planSchema, req.body);
  const plan = await prisma.subscriptionPlan.create({ data: input });
  await logActivity(req, "plan.create", "subscription_plan", plan.id, input);
  res.status(201).json({ plan });
}

/** PATCH /api/subscriptions/plans/:id */
export async function updatePlan(req: Request, res: Response): Promise<void> {
  const plan = found(await prisma.subscriptionPlan.findUnique({ where: { id: idParam(req) } }), "Plan");
  const input = parseInput(planSchema.partial(), req.body);
  await prisma.subscriptionPlan.update({ where: { id: plan.id }, data: input });
  await logActivity(req, "plan.update", "subscription_plan", plan.id, input);
  res.json({ ok: true });
}

/* ─────────────── Audit logs ─────────────── */

/** GET /api/audit/security — security_audit_logs */
export async function securityLogs(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const outcome = enumQuery(req, "outcome", ["SUCCESS", "FAILURE"] as const);
  const where: Prisma.AuditLogWhereInput = { ...(outcome ? { outcome } : {}), ...(p.q ? { action: { contains: p.q } } : {}) };
  const [items, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.auditLog.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.userId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  res.json(paged(items.map((i) => ({ ...i, id: i.id.toString(), userName: i.userId ? names[i.userId] ?? null : null })), total, p));
}

/** GET /api/audit/activity — admin_activity_logs */
export async function activityLogs(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const where: Prisma.AdminActivityLogWhereInput = {
    ...(p.q ? { action: { contains: p.q } } : {}),
    ...(typeof req.query.targetType === "string" ? { targetType: req.query.targetType.slice(0, 40) } : {}),
  };
  const [items, total] = await Promise.all([prisma.adminActivityLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.adminActivityLog.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.actorId))] } }, select: { id: true, fullName: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
  res.json(paged(items.map((i) => ({ ...i, id: i.id.toString(), actorName: names[i.actorId] ?? null })), total, p));
}
