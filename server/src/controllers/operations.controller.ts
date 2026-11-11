import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { relativePath, removeStoredFile, sendStoredFile } from "../lib/uploads";
import { propertyKey, recordStatus } from "../properties/service";
import { parseInput } from "../lib/validation";
import { can, me } from "../middleware/auth";
import { and, enquiryWhere, maintenanceWhere, propertyWhere, ticketWhere, visitWhere } from "../rbac/access";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

/* ═══════════════ Maintenance ═══════════════ */

const MAINT_STATUS = ["OPEN", "ASSIGNED", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "DECLINED", "CANCELLED", "CLOSED"] as const;

const maintenanceSchema = z.object({
  propertyId: z.string().uuid(),
  category: z.enum(["PLUMBING", "ELECTRICAL", "CARPENTRY", "PAINTING", "APPLIANCE", "PEST_CONTROL", "CLEANING", "OTHER"]),
  title: z.string().trim().min(5).max(150),
  description: z.string().trim().min(10).max(3000),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
});

/** POST /api/maintenance — tenants (property of their active lease) and landlords (own property). */
export async function createMaintenance(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const input = parseInput(maintenanceSchema, req.body);
  const property = found(await prisma.property.findUnique({ where: { id: input.propertyId } }), "Property");
  let leaseId: string | null = null;
  if (property.ownerId !== user.id) {
    const lease = await prisma.lease.findFirst({ where: { propertyId: property.id, tenantId: user.id, status: "ACTIVE" }, select: { id: true } });
    const managed = propertyWhere(user, "maintenance.manage") && (await prisma.property.count({ where: and(propertyWhere(user, "maintenance.manage")!, { id: property.id }) }));
    if (!lease && !managed) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can only raise requests for your own or rented property.");
    leaseId = lease?.id ?? null;
  }
  const request = await prisma.maintenanceRequest.create({ data: { ...input, leaseId, raisedById: user.id, landlordId: property.ownerId } });
  if (property.ownerId !== user.id) await notify(property.ownerId, "New maintenance request", `${input.title} at "${property.title}".`, "/maintenance");
  res.status(201).json({ request });
}

/**
 * Service providers see only what they need for the job: the address and the requester's name.
 * The requester's phone is shared only after the provider accepts the job.
 */
function presentMaintenance(r: Prisma.MaintenanceRequestGetPayload<{ include: typeof maintenanceInclude }>, viewerId: string, isProviderView: boolean) {
  const showContact = !isProviderView || ["ACCEPTED", "IN_PROGRESS"].includes(r.status);
  return {
    ...r,
    raisedBy: { id: r.raisedBy.id, fullName: r.raisedBy.fullName, phoneNumber: showContact ? r.raisedBy.phoneNumber : null },
    provider: r.provider ? { id: r.provider.id, fullName: r.provider.fullName } : null,
    isMine: r.raisedById === viewerId,
    isAssignedToMe: r.assignedProviderId === viewerId,
  };
}

const maintenanceInclude = {
  property: { select: { id: true, title: true, addressLine: true, locality: true, city: true } },
  raisedBy: { select: { id: true, fullName: true, phoneNumber: true } },
  provider: { select: { id: true, fullName: true } },
  photos: { select: { id: true, createdAt: true } },
} satisfies Prisma.MaintenanceRequestInclude;

/** GET /api/maintenance */
export async function listMaintenance(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = maintenanceWhere(user);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const status = enumQuery(req, "status", MAINT_STATUS);
  const where = and<Prisma.MaintenanceRequestWhereInput>(scope, status && { status }, p.q ? { OR: [{ title: { contains: p.q } }, { property: { title: { contains: p.q } } }] } : undefined);
  const [items, total] = await Promise.all([
    prisma.maintenanceRequest.findMany({ where, include: maintenanceInclude, orderBy: { updatedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.maintenanceRequest.count({ where }),
  ]);
  const providerView = user.role === "SERVICE_PROVIDER";
  res.json(paged(items.map((r) => presentMaintenance(r, user.id, providerView)), total, p));
}

async function scopedMaintenance(req: Request, permission: "maintenance.view" | "maintenance.manage" | "maintenance.work") {
  const scope = maintenanceWhere(me(req), permission);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  return found(await prisma.maintenanceRequest.findFirst({ where: and(scope, { id: idParam(req) }), include: maintenanceInclude }), "Request");
}

const assignSchema = z.object({ providerId: z.string().uuid() });

/** POST /api/maintenance/:id/assign — landlord (own) / manager (assigned) / admin. */
export async function assignProvider(req: Request, res: Response): Promise<void> {
  const r = await scopedMaintenance(req, "maintenance.manage");
  if (!["OPEN", "DECLINED", "ASSIGNED"].includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, "This request can no longer be reassigned.");
  const { providerId } = parseInput(assignSchema, req.body);
  const provider = await prisma.user.findFirst({ where: { id: providerId, role: "SERVICE_PROVIDER", accountStatus: "ACTIVE" } });
  if (!provider) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose an active service provider.");
  await prisma.maintenanceRequest.update({ where: { id: r.id }, data: { assignedProviderId: providerId, status: "ASSIGNED" } });
  await notify(providerId, "New job assigned", `${r.title} — ${r.property.locality ?? r.property.city}.`, "/maintenance");
  await notify(r.raisedById, "Service provider assigned", `${provider.fullName} will handle "${r.title}".`, "/maintenance");
  res.json({ ok: true });
}

const respondSchema = z.object({ accept: z.boolean(), note: z.string().trim().max(500).optional() });

/** POST /api/maintenance/:id/respond — assigned provider accepts or declines. */
export async function respondToJob(req: Request, res: Response): Promise<void> {
  const r = await scopedMaintenance(req, "maintenance.work");
  if (r.assignedProviderId !== me(req).id) fail("permission-denied", REASONS.PERMISSION_DENIED, "This job is not assigned to you.");
  if (r.status !== "ASSIGNED") fail("failed-precondition", REASONS.INVALID_STATE, "This job is not waiting for your response.");
  const { accept, note } = parseInput(respondSchema, req.body);
  await prisma.maintenanceRequest.update({
    where: { id: r.id },
    data: accept ? { status: "ACCEPTED", providerNote: note ?? null } : { status: "DECLINED", assignedProviderId: null, providerNote: note ?? null },
  });
  await notify(r.landlordId, accept ? "Job accepted" : "Job declined", `"${r.title}" was ${accept ? "accepted" : "declined"} by the service provider.`, "/maintenance");
  res.json({ ok: true });
}

const workStatusSchema = z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
  serviceCharge: z.coerce.number().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(500).optional(),
});

/** POST /api/maintenance/:id/work — provider updates progress and submits the service charge. */
export async function updateJob(req: Request, res: Response): Promise<void> {
  const r = await scopedMaintenance(req, "maintenance.work");
  if (r.assignedProviderId !== me(req).id) fail("permission-denied", REASONS.PERMISSION_DENIED, "This job is not assigned to you.");
  const input = parseInput(workStatusSchema, req.body);
  const valid = (input.status === "IN_PROGRESS" && r.status === "ACCEPTED") || (input.status === "COMPLETED" && ["ACCEPTED", "IN_PROGRESS"].includes(r.status));
  if (!valid) fail("failed-precondition", REASONS.INVALID_STATE, "This status change isn't allowed right now.");
  await prisma.maintenanceRequest.update({
    where: { id: r.id },
    data: {
      status: input.status,
      ...(input.serviceCharge !== undefined ? { serviceCharge: input.serviceCharge } : {}),
      ...(input.note ? { providerNote: input.note } : {}),
      ...(input.status === "COMPLETED" ? { completedAt: new Date() } : {}),
    },
  });
  for (const id of new Set([r.landlordId, r.raisedById])) {
    await notify(id, input.status === "COMPLETED" ? "Job completed" : "Work started", `"${r.title}"${input.serviceCharge ? ` — charge ₹${input.serviceCharge}` : ""}.`, "/maintenance");
  }
  res.json({ ok: true });
}

/** POST /api/maintenance/:id/photos — provider uploads completion photos (multipart "files"). */
export async function uploadJobPhotos(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const r = await scopedMaintenance(req, "maintenance.work");
    if (r.assignedProviderId !== me(req).id) fail("permission-denied", REASONS.PERMISSION_DENIED, "This job is not assigned to you.");
    if (!files.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one photo.");
    await prisma.maintenancePhoto.createMany({ data: files.map((f) => ({ requestId: r.id, filePath: relativePath(f.path), mimeType: f.mimetype, uploadedById: me(req).id })) });
    res.status(201).json({ ok: true });
  } catch (error) {
    await Promise.all(files.map((f) => removeStoredFile(relativePath(f.path))));
    throw error;
  }
}

/** GET /api/files/maintenance-photos/:photoId — anyone who can view the request. */
export async function getJobPhoto(req: Request, res: Response): Promise<void> {
  const photo = found(await prisma.maintenancePhoto.findUnique({ where: { id: idParam(req, "photoId") } }), "Photo");
  const scope = maintenanceWhere(me(req));
  if (!scope || !(await prisma.maintenanceRequest.count({ where: and(scope, { id: photo.requestId }) }))) fail("not-found", REASONS.NOT_FOUND, "Photo not found.");
  sendStoredFile(res, photo.filePath, photo.mimeType);
}

const closeSchema = z.object({ action: z.enum(["CLOSE", "CANCEL"]) });

/** POST /api/maintenance/:id/close — managers close completed jobs; the requester may cancel an open one. */
export async function closeMaintenance(req: Request, res: Response): Promise<void> {
  const { action } = parseInput(closeSchema, req.body);
  const user = me(req);
  const viewScope = maintenanceWhere(user);
  if (!viewScope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const r = found(await prisma.maintenanceRequest.findFirst({ where: and(viewScope, { id: idParam(req) }) }), "Request");
  const manageScope = maintenanceWhere(user, "maintenance.manage");
  const canManage = !!manageScope && (await prisma.maintenanceRequest.count({ where: and(manageScope, { id: r.id }) })) > 0;

  if (action === "CANCEL") {
    if (!(canManage || r.raisedById === user.id)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
    if (!["OPEN", "ASSIGNED", "DECLINED"].includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, "Work has already started on this request.");
  } else {
    if (!canManage) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
    if (r.status !== "COMPLETED") fail("failed-precondition", REASONS.INVALID_STATE, "Only completed jobs can be closed.");
  }
  await prisma.maintenanceRequest.update({ where: { id: r.id }, data: { status: action === "CLOSE" ? "CLOSED" : "CANCELLED" } });
  res.json({ ok: true });
}

/* ═══════════════ Support tickets ═══════════════ */

const ticketSchema = z.object({
  category: z.enum(["TENANT_COMPLAINT", "LANDLORD_COMPLAINT", "PAYMENT", "ACCOUNT", "PROPERTY", "OTHER"]),
  subject: z.string().trim().min(5).max(150),
  description: z.string().trim().min(10).max(5000),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  propertyId: z.string().uuid().optional(),
});

/** POST /api/support/tickets — any signed-in user raises a complaint/ticket. */
export async function createTicket(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await consumeRateLimit(`ticket:${user.id}`, RATE_LIMITS.SUPPORT_TICKET.limit, RATE_LIMITS.SUPPORT_TICKET.windowMs);
  const input = parseInput(ticketSchema, req.body);
  const ticket = await prisma.supportTicket.create({ data: { ...input, propertyId: input.propertyId ?? null, raisedById: user.id } });
  res.status(201).json({ ticket });
}

/** GET /api/support/tickets — support staff: all; others: own. */
export async function listTickets(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const p = pagination(req);
  const status = enumQuery(req, "status", ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const);
  const mine = req.query.assigned === "me" ? { assignedToId: user.id } : undefined;
  const where = and<Prisma.SupportTicketWhereInput>(ticketWhere(user), status && { status }, mine, p.q ? { subject: { contains: p.q } } : undefined);
  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      include: { raisedBy: { select: { id: true, fullName: true, role: true } }, assignedTo: { select: { id: true, fullName: true } }, _count: { select: { messages: true } } },
      orderBy: { updatedAt: "desc" },
      skip: p.skip,
      take: p.take,
    }),
    prisma.supportTicket.count({ where }),
  ]);
  res.json(paged(items, total, p));
}

/** GET /api/support/tickets/:id — with messages (internal notes hidden from customers). */
export async function getTicket(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const staff = can(req, "support.manage");
  const ticket = found(
    await prisma.supportTicket.findFirst({
      where: and(ticketWhere(user), { id: idParam(req) }),
      include: {
        raisedBy: { select: { id: true, fullName: true, role: true, phoneNumber: staff, email: staff } },
        assignedTo: { select: { id: true, fullName: true } },
        messages: { where: staff ? {} : { internal: false }, orderBy: { createdAt: "asc" } },
      },
    }),
    "Ticket",
  );
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(ticket.messages.map((m) => m.authorId))] } }, select: { id: true, fullName: true, role: true } });
  const byId = Object.fromEntries(authors.map((a) => [a.id, a]));
  res.json({ ticket: { ...ticket, messages: ticket.messages.map((m) => ({ ...m, author: byId[m.authorId] ?? null })) }, canManage: staff });
}

const messageSchema = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) });

/** POST /api/support/tickets/:id/messages */
export async function addTicketMessage(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const staff = can(req, "support.manage");
  const ticket = found(await prisma.supportTicket.findFirst({ where: and(ticketWhere(user), { id: idParam(req) }) }), "Ticket");
  if (ticket.status === "CLOSED") fail("failed-precondition", REASONS.INVALID_STATE, "This ticket is closed.");
  const input = parseInput(messageSchema, req.body);
  const internal = staff && input.internal;
  await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: user.id, body: input.body, internal } }),
    prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: staff && ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status } }),
  ]);
  if (!internal) {
    const recipient = user.id === ticket.raisedById ? ticket.assignedToId : ticket.raisedById;
    await notify(recipient, `Reply on: ${ticket.subject}`, input.body.slice(0, 140), `/support/${ticket.id}`);
  }
  res.status(201).json({ ok: true });
}

const ticketUpdateSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
});

/** PATCH /api/support/tickets/:id — support staff assign, prioritise and resolve. */
export async function updateTicket(req: Request, res: Response): Promise<void> {
  const ticket = found(await prisma.supportTicket.findUnique({ where: { id: idParam(req) } }), "Ticket");
  const input = parseInput(ticketUpdateSchema, req.body);
  if (input.assignedToId) {
    const assignee = await prisma.user.findFirst({ where: { id: input.assignedToId, accountStatus: "ACTIVE", role: { in: ["SUPPORT", "ADMIN", "SUPER_ADMIN"] } } });
    if (!assignee) fail("invalid-argument", REASONS.INVALID_INPUT, "Tickets can only be assigned to support staff.");
  }
  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { ...input, ...(input.status === "RESOLVED" ? { resolvedAt: new Date() } : {}) },
  });
  await logActivity(req, "ticket.update", "support_ticket", ticket.id, input);
  if (input.status && input.status !== ticket.status) await notify(ticket.raisedById, "Ticket update", `"${ticket.subject}" is now ${input.status.replace("_", " ").toLowerCase()}.`, `/support/${ticket.id}`);
  if (input.assignedToId) await notify(input.assignedToId, "Ticket assigned to you", ticket.subject, `/support/${ticket.id}`);
  res.json({ ok: true });
}

/* ═══════════════ Enquiries & visits ═══════════════ */

const enquirySchema = z.object({ message: z.string().trim().min(5).max(1000) });

/** POST /api/browse/:id/enquire — tenant asks about an active listing. */
export async function createEnquiry(req: Request, res: Response): Promise<void> {
  const tenant = me(req);
  const property = found(
    await prisma.property.findFirst({ where: { ...propertyKey(req), publicationStatus: "PUBLISHED", activeStatus: "ACTIVE" }, include: { assignments: { where: { type: "AGENT" }, select: { userId: true } } } }),
    "Listing",
  );
  const { message } = parseInput(enquirySchema, req.body);
  const enquiry = await prisma.enquiry.create({ data: { propertyId: property.id, tenantId: tenant.id, message } });
  const recipients = property.assignments.length ? property.assignments.map((a) => a.userId) : [property.ownerId];
  for (const id of recipients) await notify(id, "New enquiry", `${tenant.fullName} asked about "${property.title}".`, "/enquiries");
  res.status(201).json({ enquiry });
}

/** GET /api/enquiries — agents (assigned), landlords (own), admins; tenants see their own. */
export async function listEnquiries(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = enquiryWhere(user, can(req, "enquiries.manage") ? "enquiries.manage" : "enquiries.create");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const status = enumQuery(req, "status", ["NEW", "CONTACTED", "VISIT_SCHEDULED", "CLOSED"] as const);
  const where = and<Prisma.EnquiryWhereInput>(scope, status && { status });
  const [items, total] = await Promise.all([
    prisma.enquiry.findMany({ where, include: { property: { select: { id: true, title: true, city: true } } }, orderBy: { updatedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.enquiry.count({ where }),
  ]);
  // Agents/landlords need to reach the prospect: name + phone (prospect chose to enquire).
  const tenants = await prisma.user.findMany({ where: { id: { in: items.map((e) => e.tenantId) } }, select: { id: true, fullName: true, phoneNumber: true } });
  const byId = Object.fromEntries(tenants.map((t) => [t.id, t]));
  const manager = can(req, "enquiries.manage");
  res.json(paged(items.map((e) => ({ ...e, tenant: manager ? byId[e.tenantId] : { id: e.tenantId, fullName: byId[e.tenantId]?.fullName } })), total, p));
}

const enquiryUpdateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "VISIT_SCHEDULED", "CLOSED"]).optional(),
  followUpAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** PATCH /api/enquiries/:id — follow-ups. */
export async function updateEnquiry(req: Request, res: Response): Promise<void> {
  const scope = enquiryWhere(me(req), "enquiries.manage");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const enquiry = found(await prisma.enquiry.findFirst({ where: and(scope, { id: idParam(req) }) }), "Enquiry");
  const input = parseInput(enquiryUpdateSchema, req.body);
  await prisma.enquiry.update({ where: { id: enquiry.id }, data: input });
  res.json({ ok: true });
}

const visitSchema = z.object({ propertyId: z.string().uuid(), enquiryId: z.string().uuid().optional(), scheduledAt: z.coerce.date(), notes: z.string().trim().max(500).optional() });

/** POST /api/visits — agent schedules a visit for an assigned property. */
export async function scheduleVisit(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const input = parseInput(visitSchema, req.body);
  const scope = propertyWhere(user, "visits.manage");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const property = found(await prisma.property.findFirst({ where: and(scope, { id: input.propertyId }) }), "Property");
  let tenantId: string | null = null;
  if (input.enquiryId) {
    const enquiry = found(await prisma.enquiry.findFirst({ where: { id: input.enquiryId, propertyId: property.id } }), "Enquiry");
    tenantId = enquiry.tenantId;
    await prisma.enquiry.update({ where: { id: enquiry.id }, data: { status: "VISIT_SCHEDULED" } });
  }
  const visit = await prisma.propertyVisit.create({ data: { propertyId: property.id, enquiryId: input.enquiryId ?? null, agentId: user.id, tenantId, scheduledAt: input.scheduledAt, notes: input.notes ?? null } });
  await notify(tenantId, "Property visit scheduled", `"${property.title}" on ${input.scheduledAt.toLocaleString("en-IN")}.`, "/visits");
  res.status(201).json({ visit });
}

/** GET /api/visits */
export async function listVisits(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = visitWhere(user, can(req, "visits.manage") ? "visits.manage" : "enquiries.create");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const where = and<Prisma.PropertyVisitWhereInput>(scope, req.query.upcoming === "true" ? { scheduledAt: { gte: new Date() } } : undefined);
  const [items, total] = await Promise.all([
    prisma.propertyVisit.findMany({ where, include: { property: { select: { id: true, title: true, addressLine: true, city: true } } }, orderBy: { scheduledAt: "asc" }, skip: p.skip, take: p.take }),
    prisma.propertyVisit.count({ where }),
  ]);
  res.json(paged(items, total, p));
}

const visitUpdateSchema = z.object({ status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]), notes: z.string().trim().max(500).optional() });

/** PATCH /api/visits/:id */
export async function updateVisit(req: Request, res: Response): Promise<void> {
  const scope = visitWhere(me(req), "visits.manage");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const visit = found(await prisma.propertyVisit.findFirst({ where: and(scope, { id: idParam(req) }) }), "Visit");
  const input = parseInput(visitUpdateSchema, req.body);
  await prisma.propertyVisit.update({ where: { id: visit.id }, data: input });
  res.json({ ok: true });
}

/* ═══════════════ Fraud reports ═══════════════ */

const fraudSchema = z.object({ propertyId: z.string().uuid().optional(), reason: z.enum(["FAKE_LISTING", "WRONG_PRICE", "SCAM_REQUEST", "DUPLICATE", "INAPPROPRIATE", "OTHER"]), details: z.string().trim().min(10).max(3000) });

/** POST /api/fraud-reports — anyone can report a suspicious listing. */
export async function createFraudReport(req: Request, res: Response): Promise<void> {
  const input = parseInput(fraudSchema, req.body);
  const report = await prisma.fraudReport.create({ data: { ...input, propertyId: input.propertyId ?? null, reportedById: me(req).id } });
  res.status(201).json({ report: { id: report.id, status: report.status } });
}

/** GET /api/fraud-reports — moderators. */
export async function listFraudReports(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = enumQuery(req, "status", ["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"] as const);
  const where: Prisma.FraudReportWhereInput = status ? { status } : {};
  const [items, total] = await Promise.all([prisma.fraudReport.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.fraudReport.count({ where })]);
  const properties = await prisma.property.findMany({ where: { id: { in: items.map((i) => i.propertyId).filter((x): x is string => !!x) } }, select: { id: true, code: true, title: true, activeStatus: true, publicationStatus: true } });
  const byId = Object.fromEntries(properties.map((pr) => [pr.id, pr]));
  res.json(paged(items.map((i) => ({ ...i, property: i.propertyId ? byId[i.propertyId] ?? null : null })), total, p));
}

const fraudUpdateSchema = z.object({ status: z.enum(["INVESTIGATING", "RESOLVED", "DISMISSED"]), resolution: z.string().trim().max(500).optional(), suspendListing: z.boolean().default(false) });

/** PATCH /api/fraud-reports/:id */
export async function updateFraudReport(req: Request, res: Response): Promise<void> {
  const report = found(await prisma.fraudReport.findUnique({ where: { id: idParam(req) } }), "Report");
  const input = parseInput(fraudUpdateSchema, req.body);
  await prisma.$transaction(async (tx) => {
    await tx.fraudReport.update({ where: { id: report.id }, data: { status: input.status, resolution: input.resolution ?? null, handledById: me(req).id } });
    if (input.suspendListing && report.propertyId) {
      const property = await tx.property.findUnique({ where: { id: report.propertyId }, select: { activeStatus: true } });
      if (property && property.activeStatus !== "SUSPENDED") {
        await tx.property.update({ where: { id: report.propertyId }, data: { activeStatus: "SUSPENDED", moderationNote: "Suspended after a fraud report.", version: { increment: 1 } } });
        await recordStatus(tx, req, { propertyId: report.propertyId, entityType: "PROPERTY", entityId: report.propertyId, field: "activeStatus", from: property.activeStatus, to: "SUSPENDED", reason: "Fraud report." });
      }
    }
    await logActivity(req, "fraud.update", "fraud_report", report.id, input, tx);
  });
  res.json({ ok: true });
}

/* ═══════════════ Notifications ═══════════════ */

/** GET /api/notifications */
export async function listNotifications(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const p = pagination(req);
  const where: Prisma.NotificationWhereInput = { userId: user.id, ...(req.query.unread === "true" ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  res.json({ ...paged(items, total, p), unread });
}

/** POST /api/notifications/read — mark one (id) or all as read. */
export async function markNotificationsRead(req: Request, res: Response): Promise<void> {
  const parsed = parseInput(z.object({ id: z.string().uuid().optional() }), req.body ?? {});
  await prisma.notification.updateMany({ where: { userId: me(req).id, readAt: null, ...(parsed.id ? { id: parsed.id } : {}) }, data: { readAt: new Date() } });
  res.json({ ok: true });
}
