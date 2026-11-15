import type { MaintenanceRequest, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { enumQuery, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { relativePath, removeStoredFile } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { and, maintenanceWhere, propertyWhere } from "../rbac/access";

/*
 * Tenant requests (maintenance / service / complaint) — tenant ↔ landlord.
 *   Tenant:   create (type, category, description, photos) · add photos · remind (1/day) ·
 *             mark resolved · reopen · cancel (while pending)
 *   Landlord: requests inbox (badge = needs action) · update status Pending / In progress / Resolved
 *             with a remark (+ photos)
 * Every step is on the request's timeline (maintenance_updates) and the other side is notified.
 * Service-provider assignment (assign / respond / work) still works alongside this.
 */

export const REQUEST_TYPES = {
  MAINTENANCE: { label: "Maintenance / repair", categories: ["PLUMBING", "ELECTRICAL", "CARPENTRY", "PAINTING", "APPLIANCE", "WATER_SUPPLY", "LEAKAGE", "DOOR_LOCK", "LIFT", "PEST_CONTROL", "CLEANING", "OTHER"] },
  SERVICE: { label: "Service", categories: ["CLEANING", "DEEP_CLEANING", "PEST_CONTROL", "AC_SERVICE", "WATER_TANK_CLEANING", "INTERNET", "GAS", "OTHER"] },
  COMPLAINT: { label: "Complaint", categories: ["NOISE", "NEIGHBOUR", "SECURITY", "PARKING", "CLEANLINESS", "WATER", "ELECTRICITY", "OTHER"] },
  OTHER: { label: "Other request", categories: ["DOCUMENT", "KEYS", "PERMISSION", "OTHER"] },
} as const;
type RequestType = keyof typeof REQUEST_TYPES;
const TYPE_KEYS = Object.keys(REQUEST_TYPES) as [RequestType, ...RequestType[]];

const FINAL = ["RESOLVED", "CLOSED", "CANCELLED"];
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Pending",
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In progress",
  COMPLETED: "Work done",
  DECLINED: "Declined",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};
const labelize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const link = (id: string) => `/maintenance/${id}`;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** Landlord should look at it: new (never answered), reopened, or the tenant reminded after the last update. */
export function needsAction(r: Pick<MaintenanceRequest, "status" | "landlordUpdatedAt" | "lastReminderAt">): boolean {
  if (FINAL.includes(r.status)) return false;
  if (!r.landlordUpdatedAt) return true;
  return !!r.lastReminderAt && r.lastReminderAt > r.landlordUpdatedAt;
}

/** GET /api/v1/maintenance/options — request types and their categories (for the "Raise request" form). */
export async function requestOptions(_req: Request, res: Response): Promise<void> {
  res.json({
    types: TYPE_KEYS.map((key) => ({ key, label: REQUEST_TYPES[key].label, categories: REQUEST_TYPES[key].categories.map((c) => ({ key: c, label: labelize(c) })) })),
    priorities: ["LOW", "MEDIUM", "HIGH", "URGENT"],
    landlordStatuses: [
      { key: "OPEN", label: "Pending" },
      { key: "IN_PROGRESS", label: "In progress" },
      { key: "RESOLVED", label: "Resolved" },
    ],
  });
}

const createSchema = z
  .object({
    type: z.enum(TYPE_KEYS).default("MAINTENANCE"),
    category: z.string().trim().min(2).max(40),
    title: z.string().trim().min(3).max(150).optional(),
    description: z.string().trim().min(10, "Describe the issue (at least 10 characters).").max(3000),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    propertyId: z.string().uuid().optional(),
    leaseId: z.string().uuid().optional(),
  })
  .strict();

async function savePhotos(req: Request, requestId: string, updateId: string | null) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return 0;
  await prisma.maintenancePhoto.createMany({ data: files.map((f) => ({ requestId, updateId, filePath: relativePath(f.path), mimeType: f.mimetype, uploadedById: me(req).id })) });
  return files.length;
}
async function dropUploads(req: Request) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  await Promise.all(files.map((f) => removeStoredFile(relativePath(f.path))));
}

/**
 * POST /api/v1/maintenance — raise a request (JSON, or multipart with up to 10 photos in "files").
 * Tenants: the property of their active lease (leaseId or propertyId optional when they have one lease).
 * Landlords / managers can raise one for a property they manage.
 */
export async function createRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  try {
    const input = parseInput(createSchema, req.body ?? {});
    if (!(REQUEST_TYPES[input.type].categories as readonly string[]).includes(input.category)) fail("invalid-argument", REASONS.INVALID_INPUT, `Choose a category for ${REQUEST_TYPES[input.type].label.toLowerCase()}.`);
    // Which property / lease: the tenant's active lease, or a property the user manages.
    const leases = await prisma.lease.findMany({
      where: { tenantId: user.id, status: "ACTIVE", ...(input.leaseId ? { id: input.leaseId } : {}), ...(input.propertyId ? { propertyId: input.propertyId } : {}) },
      select: { id: true, propertyId: true, landlordId: true, unitId: true, bedId: true },
    });
    let lease = leases.length === 1 ? leases[0] : null;
    if (leases.length > 1) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose which rental this request is for (leaseId).");
    let propertyId = lease?.propertyId ?? input.propertyId;
    let landlordId = lease?.landlordId;
    if (!lease) {
      if (!input.propertyId) fail("failed-precondition", REASONS.INVALID_STATE, "You need an active rental to raise a request.");
      const property = await prisma.property.findUnique({ where: { id: input.propertyId! }, select: { id: true, ownerId: true } });
      const manageScope = propertyWhere(user, "maintenance.manage");
      const manages = !!property && (property.ownerId === user.id || (!!manageScope && (await prisma.property.count({ where: and(manageScope, { id: property.id }) })) > 0));
      if (!manages) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can only raise requests for your own or rented property.");
      propertyId = property!.id;
      landlordId = property!.ownerId;
      lease = null;
    }
    const isTenant = !!lease;
    const created = await prisma.$transaction(async (tx) => {
      const r = await tx.maintenanceRequest.create({
        data: {
          type: input.type,
          category: input.category,
          title: input.title ?? `${labelize(input.category)}${input.type === "COMPLAINT" ? " complaint" : ""}`,
          description: input.description,
          priority: input.priority,
          propertyId: propertyId!,
          leaseId: lease?.id ?? null,
          unitId: lease?.unitId ?? null,
          bedId: lease?.bedId ?? null,
          raisedById: user.id,
          landlordId: landlordId!,
          // Raised by the landlord side → nothing for the landlord to answer.
          landlordUpdatedAt: isTenant ? null : new Date(),
        },
      });
      await tx.maintenanceUpdate.create({ data: { requestId: r.id, byId: user.id, byRole: isTenant ? "TENANT" : "LANDLORD", kind: "CREATED", toStatus: "OPEN", remark: input.description.slice(0, 1000) } });
      return r;
    });
    const photos = await savePhotos(req, created.id, null);
    if (isTenant) {
      await notify(landlordId!, `New ${REQUEST_TYPES[input.type].label.toLowerCase()}`, `${user.fullName}: ${created.title}${photos ? ` (${photos} photo${photos > 1 ? "s" : ""})` : ""}.`, link(created.id), "MAINTENANCE", { requestId: created.id });
    }
    res.locals.message = isTenant ? "Request sent to your landlord" : "Request created";
    res.status(201).json({ request: await detail(created.id, user.id) });
  } catch (err) {
    await dropUploads(req);
    throw err;
  }
}

const detailInclude = {
  property: { select: { id: true, title: true, code: true, addressLine: true, locality: true, city: true } },
  raisedBy: { select: { id: true, fullName: true } },
  provider: { select: { id: true, fullName: true } },
  photos: { select: { id: true, updateId: true, uploadedById: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  updates: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.MaintenanceRequestInclude;
type DetailRow = Prisma.MaintenanceRequestGetPayload<{ include: typeof detailInclude }>;

async function present(rows: DetailRow[], viewerId: string) {
  const places = await placeLabels(rows.map((r) => ({ unitId: r.unitId, bedId: r.bedId })));
  const ids = [...new Set(rows.flatMap((r) => r.updates.map((u) => u.byId)))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => {
    const mine = r.raisedById === viewerId;
    const landlordSide = r.landlordId === viewerId;
    const open = !FINAL.includes(r.status);
    return {
      id: r.id,
      type: r.type,
      typeLabel: REQUEST_TYPES[r.type as RequestType]?.label ?? labelize(r.type),
      category: r.category,
      categoryLabel: labelize(r.category),
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status] ?? labelize(r.status),
      lastRemark: r.lastRemark,
      property: { id: r.property.id, title: r.property.title ?? r.property.code, locality: r.property.locality, city: r.property.city },
      place: placeOf(places, { unitId: r.unitId, bedId: r.bedId }),
      leaseId: r.leaseId,
      raisedBy: { id: r.raisedBy.id, fullName: r.raisedBy.fullName },
      provider: r.provider ? { id: r.provider.id, fullName: r.provider.fullName } : null,
      photos: r.photos.map((ph) => ({ id: ph.id, url: `/api/v1/files/maintenance-photos/${ph.id}`, updateId: ph.updateId, byTenant: ph.uploadedById === r.raisedById, createdAt: ph.createdAt })),
      timeline: r.updates.map((u) => ({
        id: u.id,
        kind: u.kind,
        by: { role: u.byRole, fullName: nameOf.get(u.byId) ?? "" },
        fromStatus: u.fromStatus,
        toStatus: u.toStatus,
        toStatusLabel: u.toStatus ? (STATUS_LABEL[u.toStatus] ?? labelize(u.toStatus)) : null,
        remark: u.remark,
        photoIds: r.photos.filter((ph) => ph.updateId === u.id).map((ph) => ph.id),
        at: u.createdAt,
      })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      resolvedAt: r.resolvedAt,
      lastReminderAt: r.lastReminderAt,
      needsAction: landlordSide && needsAction(r),
      can: {
        update: landlordSide && open,
        remind: mine && open && (!r.lastReminderAt || r.lastReminderAt < startOfToday()),
        resolve: mine && open,
        reopen: mine && r.status === "RESOLVED",
        cancel: mine && ["OPEN", "ASSIGNED", "DECLINED"].includes(r.status),
        addPhotos: (mine || landlordSide) && open,
      },
    };
  });
}

async function detail(id: string, viewerId: string) {
  const r = await prisma.maintenanceRequest.findUniqueOrThrow({ where: { id }, include: detailInclude });
  return (await present([r], viewerId))[0];
}

async function visible(req: Request, permission: "maintenance.view" | "maintenance.manage" = "maintenance.view") {
  const scope = maintenanceWhere(me(req), permission);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const r = await prisma.maintenanceRequest.findFirst({ where: and(scope!, { id: idParam(req) }) });
  if (!r) fail("not-found", REASONS.NOT_FOUND, "Request not found.");
  return r!;
}

const LIST_FILTER = ["ACTIVE", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED", "NEEDS_ACTION"] as const;

/**
 * GET /api/v1/requests?status=ACTIVE|OPEN|IN_PROGRESS|RESOLVED|NEEDS_ACTION&type=…&role=tenant|landlord
 * Tenant: requests they raised. Landlord: requests on their properties. meta.needsAction = badge count.
 */
export async function listRequests(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = maintenanceWhere(user);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const status = enumQuery(req, "status", LIST_FILTER);
  const type = enumQuery(req, "type", TYPE_KEYS);
  const role = req.query.role === "tenant" ? { raisedById: user.id } : req.query.role === "landlord" ? { landlordId: user.id } : undefined;
  const statusWhere: Prisma.MaintenanceRequestWhereInput | undefined =
    status === "ACTIVE" || status === "NEEDS_ACTION" ? { status: { notIn: FINAL as never } } : status === "IN_PROGRESS" ? { status: { in: ["IN_PROGRESS", "ASSIGNED", "ACCEPTED", "COMPLETED"] } } : status ? { status } : undefined;
  const where = and<Prisma.MaintenanceRequestWhereInput>(scope!, role, statusWhere, type && { type }, p.q ? { OR: [{ title: { contains: p.q } }, { description: { contains: p.q } }] } : undefined);
  const badge = await needsActionCount(user.id);
  if (status === "NEEDS_ACTION") {
    const rows = (await prisma.maintenanceRequest.findMany({ where: and(where, { landlordId: user.id }), include: detailInclude, orderBy: { updatedAt: "desc" }, take: 200 })).filter(needsAction);
    const page = rows.slice(p.skip, p.skip + p.take);
    res.json({ ...paged(await present(page, user.id), rows.length, p), needsAction: badge });
    return;
  }
  const [rows, total] = await Promise.all([
    prisma.maintenanceRequest.findMany({ where, include: detailInclude, orderBy: { updatedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.maintenanceRequest.count({ where }),
  ]);
  res.json({ ...paged(await present(rows, user.id), total, p), needsAction: badge });
}

/** Landlord badge: requests on my properties that need my attention. */
export async function needsActionCount(landlordId: string): Promise<number> {
  const rows = await prisma.maintenanceRequest.findMany({ where: { landlordId, status: { notIn: FINAL as never } }, select: { status: true, landlordUpdatedAt: true, lastReminderAt: true }, take: 1000 });
  return rows.filter(needsAction).length;
}

/** GET /api/v1/requests/summary — badge counts. */
export async function requestsSummary(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const [needs, mineOpen, onMyProperties] = await Promise.all([
    needsActionCount(user.id),
    prisma.maintenanceRequest.count({ where: { raisedById: user.id, status: { notIn: FINAL as never } } }),
    prisma.maintenanceRequest.count({ where: { landlordId: user.id, status: { notIn: FINAL as never } } }),
  ]);
  res.json({ needsAction: needs, landlordOpen: onMyProperties, myOpen: mineOpen });
}

/** GET /api/v1/requests/:id */
export async function getRequest(req: Request, res: Response): Promise<void> {
  const r = await visible(req);
  res.json({ request: await detail(r.id, me(req).id) });
}

const updateSchema = z
  .object({
    status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]).optional(),
    remark: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.status || (v.remark && v.remark.length >= 2), { message: "Change the status or add a remark." });

/** POST /api/v1/requests/:id/update { status?, remark? } (+ multipart photos "files") — landlord side. */
export async function landlordUpdate(req: Request, res: Response): Promise<void> {
  const user = me(req);
  try {
    const r = await visible(req, "maintenance.manage");
    if (FINAL.includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, `This request is already ${r.status.toLowerCase()}.`);
    const input = parseInput(updateSchema, req.body ?? {});
    const changes = input.status && input.status !== r.status;
    const now = new Date();
    const update = await prisma.$transaction(async (tx) => {
      const done = await tx.maintenanceRequest.updateMany({
        where: { id: r.id, status: r.status },
        data: {
          ...(changes ? { status: input.status } : {}),
          ...(input.remark ? { lastRemark: input.remark } : {}),
          ...(input.status === "RESOLVED" && changes ? { resolvedAt: now, resolvedById: user.id } : {}),
          landlordUpdatedAt: now,
        },
      });
      if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just updated. Refresh and try again.");
      return tx.maintenanceUpdate.create({ data: { requestId: r.id, byId: user.id, byRole: user.id === r.landlordId ? "LANDLORD" : "STAFF", kind: changes ? "STATUS" : "REMARK", fromStatus: changes ? r.status : null, toStatus: changes ? input.status! : null, remark: input.remark ?? null } });
    });
    await savePhotos(req, r.id, update.id);
    const what = changes ? `${STATUS_LABEL[input.status!]}` : "New remark";
    await notify(r.raisedById, `Request update: ${what}`, `"${r.title}"${input.remark ? `: ${input.remark}` : ""}`, link(r.id), "MAINTENANCE", { requestId: r.id });
    res.locals.message = "Update sent to the tenant";
    res.json({ request: await detail(r.id, user.id) });
  } catch (err) {
    await dropUploads(req);
    throw err;
  }
}

async function ownRequest(req: Request) {
  const r = await visible(req);
  if (r.raisedById !== me(req).id) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the person who raised this request can do that.");
  return r;
}

const remarkSchema = z.object({ remark: z.string().trim().max(1000).optional() }).strict();

/** POST /api/v1/requests/:id/resolve { remark? } — the tenant confirms the issue is fixed. */
export async function resolveRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const r = await ownRequest(req);
  if (FINAL.includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, `This request is already ${r.status.toLowerCase()}.`);
  const { remark } = parseInput(remarkSchema, req.body ?? {});
  await prisma.$transaction(async (tx) => {
    const done = await tx.maintenanceRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: user.id } });
    if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just updated. Refresh and try again.");
    await tx.maintenanceUpdate.create({ data: { requestId: r.id, byId: user.id, byRole: "TENANT", kind: "RESOLVED", fromStatus: r.status, toStatus: "RESOLVED", remark: remark ?? null } });
  });
  await notify(r.landlordId, "Request resolved", `${user.fullName} marked "${r.title}" as resolved.${remark ? ` ${remark}` : ""}`, link(r.id), "MAINTENANCE", { requestId: r.id });
  res.locals.message = "Marked as resolved";
  res.json({ request: await detail(r.id, user.id) });
}

const reopenSchema = z.object({ remark: z.string().trim().min(5, "Tell your landlord what's still wrong (at least 5 characters).").max(1000) }).strict();

/** POST /api/v1/requests/:id/reopen { remark } — not fixed after all (multipart photos allowed). */
export async function reopenRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  try {
    const r = await ownRequest(req);
    if (r.status !== "RESOLVED") fail("failed-precondition", REASONS.INVALID_STATE, "Only a resolved request can be reopened.");
    const { remark } = parseInput(reopenSchema, req.body ?? {});
    const update = await prisma.$transaction(async (tx) => {
      const done = await tx.maintenanceRequest.updateMany({ where: { id: r.id, status: "RESOLVED" }, data: { status: "OPEN", resolvedAt: null, resolvedById: null, landlordUpdatedAt: null } });
      if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just updated. Refresh and try again.");
      return tx.maintenanceUpdate.create({ data: { requestId: r.id, byId: user.id, byRole: "TENANT", kind: "REOPENED", fromStatus: "RESOLVED", toStatus: "OPEN", remark } });
    });
    await savePhotos(req, r.id, update.id);
    await notify(r.landlordId, "Request reopened", `${user.fullName}: "${r.title}". ${remark}`, link(r.id), "MAINTENANCE", { requestId: r.id });
    res.locals.message = "Reopened. Your landlord has been told";
    res.json({ request: await detail(r.id, user.id) });
  } catch (err) {
    await dropUploads(req);
    throw err;
  }
}

/** POST /api/v1/requests/:id/remind — tenant nudges the landlord (once a day). */
export async function remindRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const r = await ownRequest(req);
  if (FINAL.includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, `This request is already ${r.status.toLowerCase()}.`);
  const now = new Date();
  const claimed = await prisma.maintenanceRequest.updateMany({
    where: { id: r.id, status: { notIn: FINAL as never }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday() } }] },
    data: { lastReminderAt: now, reminderCount: { increment: 1 } },
  });
  if (!claimed.count) fail("resource-exhausted", REASONS.RATE_LIMITED, "You already sent a reminder today. You can remind again tomorrow.");
  await prisma.maintenanceUpdate.create({ data: { requestId: r.id, byId: user.id, byRole: "TENANT", kind: "REMINDER" } });
  const days = Math.max(1, Math.round((now.getTime() - r.createdAt.getTime()) / 86_400_000));
  await notify(r.landlordId, "Reminder from your tenant", `${user.fullName} is waiting on "${r.title}" (raised ${days} day${days > 1 ? "s" : ""} ago, ${STATUS_LABEL[r.status] ?? r.status}).`, link(r.id), "MAINTENANCE", { requestId: r.id });
  res.locals.message = "Reminder sent to your landlord";
  res.json({ request: await detail(r.id, user.id) });
}

/** POST /api/v1/requests/:id/cancel { remark? } — tenant withdraws a pending request. */
export async function cancelRequest(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const r = await ownRequest(req);
  if (!["OPEN", "ASSIGNED", "DECLINED"].includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, "Work has already started on this request. Mark it resolved instead.");
  const { remark } = parseInput(remarkSchema, req.body ?? {});
  await prisma.$transaction(async (tx) => {
    const done = await tx.maintenanceRequest.updateMany({ where: { id: r.id, status: r.status }, data: { status: "CANCELLED" } });
    if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request was just updated. Refresh and try again.");
    await tx.maintenanceUpdate.create({ data: { requestId: r.id, byId: user.id, byRole: "TENANT", kind: "CANCELLED", fromStatus: r.status, toStatus: "CANCELLED", remark: remark ?? null } });
  });
  await notify(r.landlordId, "Request withdrawn", `${user.fullName} withdrew "${r.title}".`, link(r.id), "MAINTENANCE", { requestId: r.id });
  res.locals.message = "Request cancelled";
  res.json({ request: await detail(r.id, user.id) });
}

/** POST /api/v1/requests/:id/photos — tenant or landlord adds photos (multipart "files"). */
export async function addRequestPhotos(req: Request, res: Response): Promise<void> {
  const user = me(req);
  try {
    const r = await visible(req);
    if (r.raisedById !== user.id && r.landlordId !== user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the tenant or landlord can add photos.");
    if (FINAL.includes(r.status)) fail("failed-precondition", REASONS.INVALID_STATE, "This request is closed.");
    const n = await savePhotos(req, r.id, null);
    if (!n) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one photo.");
    await notify(r.raisedById === user.id ? r.landlordId : r.raisedById, "New photos on a request", `${user.fullName} added ${n} photo${n > 1 ? "s" : ""} to "${r.title}".`, link(r.id), "MAINTENANCE", { requestId: r.id });
    res.locals.message = "Photos added";
    res.status(201).json({ request: await detail(r.id, user.id) });
  } catch (err) {
    await dropUploads(req);
    throw err;
  }
}
