import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { relativePath, removeStoredFile, sendStoredFile } from "../lib/uploads";
import { parseInput, phoneE164Schema } from "../lib/validation";
import { can, me } from "../middleware/auth";
import { and, propertyWhere } from "../rbac/access";
import type { PermissionKey } from "../rbac/catalog";

const PROPERTY_TYPES = ["APARTMENT", "INDEPENDENT_HOUSE", "VILLA", "PG_HOSTEL", "COMMERCIAL"] as const;
const FURNISHING = ["UNFURNISHED", "SEMI_FURNISHED", "FULLY_FURNISHED"] as const;
const STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "REJECTED", "RENTED", "INACTIVE"] as const;

/** Loads a property only if it is inside the user's scope for `permission` (otherwise 404). */
export async function scopedProperty(req: Request, permission: PermissionKey, id = idParam(req)) {
  const scope = propertyWhere(me(req), permission);
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  return found(await prisma.property.findFirst({ where: and(scope, { id }) }), "Property");
}

const propertyInclude = {
  owner: { select: { id: true, fullName: true } },
  images: { select: { id: true, status: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  _count: { select: { applications: { where: { status: "PENDING" } }, documents: true } },
} satisfies Prisma.PropertyInclude;

/** GET /api/properties — records within scope (landlord: own, manager/agent: assigned, staff: all). */
export async function listProperties(req: Request, res: Response): Promise<void> {
  const scope = propertyWhere(me(req), "properties.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to do that.");
  const p = pagination(req);
  const status = enumQuery(req, "status", STATUSES);
  const where = and<Prisma.PropertyWhereInput>(
    scope,
    status && { status },
    typeof req.query.city === "string" && req.query.city ? { city: { contains: req.query.city.slice(0, 80) } } : undefined,
    p.q ? { OR: [{ title: { contains: p.q } }, { locality: { contains: p.q } }, { city: { contains: p.q } }, { pincode: { contains: p.q } }] } : undefined,
  );
  const [items, total] = await Promise.all([
    prisma.property.findMany({ where, include: propertyInclude, orderBy: { updatedAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.property.count({ where }),
  ]);
  res.json(paged(items, total, p));
}

const browseSchema = z.object({
  city: z.string().trim().max(80).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
  furnishing: z.enum(FURNISHING).optional(),
  minRent: z.coerce.number().min(0).optional(),
  maxRent: z.coerce.number().min(0).optional(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  sort: z.enum(["newest", "rent_asc", "rent_desc"]).default("newest"),
});

/** GET /api/browse — public listings for tenants: ACTIVE + available only, approved images only, no owner contact. */
export async function browseProperties(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const f = parseInput(browseSchema, req.query);
  const where: Prisma.PropertyWhereInput = {
    status: "ACTIVE",
    isAvailable: true,
    ...(f.city ? { city: { contains: f.city } } : {}),
    ...(f.type ? { propertyType: f.type } : {}),
    ...(f.furnishing ? { furnishing: f.furnishing } : {}),
    ...(f.bedrooms !== undefined ? { bedrooms: { gte: f.bedrooms } } : {}),
    ...(f.minRent !== undefined || f.maxRent !== undefined ? { monthlyRent: { ...(f.minRent !== undefined ? { gte: f.minRent } : {}), ...(f.maxRent !== undefined ? { lte: f.maxRent } : {}) } } : {}),
    ...(p.q ? { OR: [{ title: { contains: p.q } }, { locality: { contains: p.q } }, { city: { contains: p.q } }] } : {}),
  };
  const orderBy: Prisma.PropertyOrderByWithRelationInput = f.sort === "rent_asc" ? { monthlyRent: "asc" } : f.sort === "rent_desc" ? { monthlyRent: "desc" } : { createdAt: "desc" };
  const [items, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy,
      skip: p.skip,
      take: p.take,
      select: publicSelect,
    }),
    prisma.property.count({ where }),
  ]);
  res.json(paged(items, total, p));
}

const publicSelect = {
  id: true,
  title: true,
  description: true,
  propertyType: true,
  locality: true,
  city: true,
  state: true,
  pincode: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  furnishing: true,
  monthlyRent: true,
  securityDeposit: true,
  availableFrom: true,
  verified: true,
  createdAt: true,
  images: { where: { status: "APPROVED" }, select: { id: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.PropertySelect;

/** GET /api/browse/:id — public view of one active listing (+ the tenant's own application status). */
export async function browseProperty(req: Request, res: Response): Promise<void> {
  const id = idParam(req);
  const property = found(await prisma.property.findFirst({ where: { id, status: "ACTIVE" }, select: publicSelect }), "Listing");
  const user = me(req);
  const application = await prisma.rentalApplication.findFirst({ where: { propertyId: id, tenantId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  res.json({ property, myApplication: application });
}

/** GET /api/properties/:id — full record within scope. */
export async function getProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const full = await prisma.property.findUniqueOrThrow({
    where: { id: property.id },
    include: {
      ...propertyInclude,
      documents: { select: { id: true, docType: true, originalName: true, status: true, note: true, createdAt: true } },
      assignments: { include: { user: { select: { id: true, fullName: true, role: true } } } },
      inspections: { orderBy: { scheduledAt: "desc" }, take: 20 },
    },
  });
  const user = me(req);
  res.json({
    property: full,
    can: {
      manage: !!propertyWhere(user, "properties.manage") && (await canInScope(req, "properties.manage", property.id)),
      approve: can(req, "listings.approve"),
      verifyDocuments: await canInScope(req, "documents.verify", property.id),
      assign: can(req, "assignments.manage"),
      inspect: await canInScope(req, "inspections.manage", property.id),
    },
  });
}

async function canInScope(req: Request, permission: PermissionKey, propertyId: string): Promise<boolean> {
  const scope = propertyWhere(me(req), permission);
  if (!scope) return false;
  return (await prisma.property.count({ where: and(scope, { id: propertyId }) })) > 0;
}

const propertySchema = z.object({
  title: z.string().trim().min(5).max(150),
  description: z.string().trim().min(20).max(5000),
  propertyType: z.enum(PROPERTY_TYPES),
  addressLine: z.string().trim().min(5).max(255),
  locality: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code."),
  bedrooms: z.coerce.number().int().min(0).max(20),
  bathrooms: z.coerce.number().int().min(0).max(20),
  areaSqft: z.coerce.number().int().min(50).max(100000).optional().nullable(),
  furnishing: z.enum(FURNISHING),
  monthlyRent: z.coerce.number().positive().max(10_000_000),
  securityDeposit: z.coerce.number().min(0).max(100_000_000),
  availableFrom: z.coerce.date().optional().nullable(),
});

const createSchema = propertySchema.extend({
  /** Agents/admins listing on behalf of a registered landlord. */
  landlordPhone: phoneE164Schema.optional(),
});

/** POST /api/properties — landlords add their own; agents/admins add for a registered landlord. */
export async function createProperty(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const input = parseInput(createSchema, req.body);
  const { landlordPhone, ...data } = input;

  let ownerId = user.id;
  if (user.role !== "LANDLORD") {
    if (!landlordPhone) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter the landlord's registered phone number.");
    const landlord = await prisma.user.findFirst({ where: { phoneNumber: landlordPhone, role: "LANDLORD", accountStatus: "ACTIVE" }, select: { id: true } });
    if (!landlord) fail("not-found", REASONS.NOT_FOUND, "No active landlord is registered with this phone number.");
    ownerId = landlord.id;
  }

  const property = await prisma.$transaction(async (tx) => {
    const created = await tx.property.create({ data: { ...data, ownerId, createdById: user.id, status: "DRAFT" } });
    if (user.role === "PROPERTY_AGENT") {
      await tx.propertyAssignment.create({ data: { propertyId: created.id, userId: user.id, type: "AGENT", createdById: user.id } });
    }
    return created;
  });
  if (ownerId !== user.id) {
    await notify(ownerId, "A listing was created for you", `${user.fullName} added "${property.title}". Review it before it is submitted.`, `/properties/${property.id}`);
    await logActivity(req, "property.create", "property", property.id, { ownerId });
  }
  res.status(201).json({ property });
}

/** PATCH /api/properties/:id — edit within scope. Price/details changes send an ACTIVE listing back to review. */
export async function updateProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(propertySchema.partial(), req.body);
  const needsReview = property.status === "ACTIVE" && (input.title || input.description || input.monthlyRent !== undefined || input.addressLine);
  const updated = await prisma.property.update({
    where: { id: property.id },
    data: { ...input, ...(needsReview ? { status: "PENDING_REVIEW", verified: false } : {}) },
  });
  if (me(req).id !== property.ownerId) await logActivity(req, "property.update", "property", property.id, { fields: Object.keys(input) });
  res.json({ property: updated });
}

/** POST /api/properties/:id/submit — send a draft/rejected listing for moderation. */
export async function submitProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  if (!["DRAFT", "REJECTED", "INACTIVE"].includes(property.status)) fail("failed-precondition", REASONS.INVALID_STATE, "Only drafts, rejected or inactive listings can be submitted.");
  const images = await prisma.propertyImage.count({ where: { propertyId: property.id } });
  if (images === 0) fail("failed-precondition", REASONS.INVALID_STATE, "Add at least one photo before submitting.");
  await prisma.property.update({ where: { id: property.id }, data: { status: "PENDING_REVIEW", moderationNote: null } });
  res.json({ ok: true });
}

const availabilitySchema = z.object({ isAvailable: z.boolean(), availableFrom: z.coerce.date().optional().nullable() });

/** POST /api/properties/:id/availability — owner / assigned agent or manager. */
export async function setAvailability(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(availabilitySchema, req.body);
  await prisma.property.update({ where: { id: property.id }, data: input });
  res.json({ ok: true });
}

/** POST /api/properties/:id/deactivate — take a listing off the market. */
export async function deactivateProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const activeLease = await prisma.lease.count({ where: { propertyId: property.id, status: "ACTIVE" } });
  if (activeLease) fail("failed-precondition", REASONS.INVALID_STATE, "End the active lease before deactivating this property.");
  await prisma.property.update({ where: { id: property.id }, data: { status: "INACTIVE" } });
  await logActivity(req, "property.deactivate", "property", property.id);
  res.json({ ok: true });
}

/* ─────────────── Images ─────────────── */

/** POST /api/properties/:id/images — upload photos (multipart "files"). New photos need moderation. */
export async function uploadImages(req: Request, res: Response): Promise<void> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const property = await scopedProperty(req, "properties.manage").catch(async (e) => {
    await Promise.all(files.map((f) => removeStoredFile(relativePath(f.path))));
    throw e;
  });
  if (files.length === 0) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one image.");
  const existing = await prisma.propertyImage.count({ where: { propertyId: property.id } });
  if (existing + files.length > 20) fail("invalid-argument", REASONS.INVALID_INPUT, "A property can have at most 20 photos.");
  await prisma.propertyImage.createMany({
    data: files.map((f) => ({ propertyId: property.id, filePath: relativePath(f.path), mimeType: f.mimetype, uploadedById: me(req).id })),
  });
  res.status(201).json({ ok: true, count: files.length });
}

/** DELETE /api/properties/:id/images/:imageId */
export async function deleteImage(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const image = found(await prisma.propertyImage.findFirst({ where: { id: idParam(req, "imageId"), propertyId: property.id } }), "Image");
  await prisma.propertyImage.delete({ where: { id: image.id } });
  await removeStoredFile(image.filePath);
  res.json({ ok: true });
}

/**
 * GET /api/files/property-images/:imageId — approved images of ACTIVE listings are visible to anyone
 * who can browse; all other images only to users with properties.view on that property or moderators.
 */
export async function getImageFile(req: Request, res: Response): Promise<void> {
  const image = found(await prisma.propertyImage.findUnique({ where: { id: idParam(req, "imageId") }, include: { property: { select: { id: true, status: true } } } }), "Image");
  const isPublic = image.status === "APPROVED" && image.property.status === "ACTIVE" && can(req, "properties.browse");
  if (!isPublic && !can(req, "listings.approve")) {
    await scopedProperty(req, "properties.view", image.property.id);
  }
  sendStoredFile(res, image.filePath, image.mimeType);
}

/* ─────────────── Documents ─────────────── */

const documentSchema = z.object({ docType: z.enum(["OWNERSHIP_DEED", "TAX_RECEIPT", "UTILITY_BILL", "ID_PROOF", "OTHER"]) });

/** POST /api/properties/:id/documents — ownership documents (multipart "file" + docType). Private. */
export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const file = req.file;
  const property = await scopedProperty(req, "properties.manage").catch(async (e) => {
    if (file) await removeStoredFile(relativePath(file.path));
    throw e;
  });
  if (!file) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a file to upload.");
  const { docType } = parseInput(documentSchema, req.body);
  const doc = await prisma.propertyDocument.create({
    data: { propertyId: property.id, docType, filePath: relativePath(file.path), originalName: file.originalname.slice(0, 200), mimeType: file.mimetype, uploadedById: me(req).id },
  });
  res.status(201).json({ document: { id: doc.id, docType: doc.docType, originalName: doc.originalName, status: doc.status } });
}

/** GET /api/files/documents/:docId — owner, assigned manager, or verifiers only. */
export async function getDocumentFile(req: Request, res: Response): Promise<void> {
  const doc = found(await prisma.propertyDocument.findUnique({ where: { id: idParam(req, "docId") } }), "Document");
  const allowed = (await canInScope(req, "properties.manage", doc.propertyId)) || (await canInScope(req, "documents.verify", doc.propertyId));
  if (!allowed) fail("not-found", REASONS.NOT_FOUND, "Document not found.");
  sendStoredFile(res, doc.filePath, doc.mimeType, doc.originalName);
}

const verifySchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional() });

/** POST /api/documents/:docId/verify — moderators (all) or property managers (assigned). */
export async function verifyDocument(req: Request, res: Response): Promise<void> {
  const doc = found(await prisma.propertyDocument.findUnique({ where: { id: idParam(req, "docId") }, include: { property: { select: { id: true, ownerId: true, title: true } } } }), "Document");
  if (!(await canInScope(req, "documents.verify", doc.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Document not found.");
  const input = parseInput(verifySchema, req.body);
  await prisma.propertyDocument.update({ where: { id: doc.id }, data: { status: input.status, note: input.note ?? null, reviewedById: me(req).id } });
  // A property is "verified" once an ownership deed is approved.
  if (input.status === "APPROVED" && doc.docType === "OWNERSHIP_DEED") await prisma.property.update({ where: { id: doc.propertyId }, data: { verified: true } });
  await logActivity(req, "document.verify", "property_document", doc.id, input);
  await notify(doc.property.ownerId, `Document ${input.status === "APPROVED" ? "verified" : "rejected"}`, `${doc.originalName} for "${doc.property.title}"${input.note ? `: ${input.note}` : ""}`, `/properties/${doc.propertyId}`);
  res.json({ ok: true });
}

/* ─────────────── Moderation ─────────────── */

/** GET /api/moderation/queue — pending listings, images and documents. */
export async function moderationQueue(req: Request, res: Response): Promise<void> {
  const canApprove = can(req, "listings.approve");
  const canVerify = can(req, "documents.verify");
  const docScope = propertyWhere(me(req), "documents.verify");
  const [listings, images, documents] = await Promise.all([
    canApprove
      ? prisma.property.findMany({ where: { status: "PENDING_REVIEW" }, include: { owner: { select: { id: true, fullName: true } }, _count: { select: { images: true, documents: true } } }, orderBy: { updatedAt: "asc" }, take: 50 })
      : [],
    canApprove ? prisma.propertyImage.findMany({ where: { status: "PENDING" }, include: { property: { select: { id: true, title: true } } }, orderBy: { createdAt: "asc" }, take: 60 }) : [],
    canVerify && docScope
      ? prisma.propertyDocument.findMany({ where: { status: "PENDING", property: docScope }, include: { property: { select: { id: true, title: true } } }, orderBy: { createdAt: "asc" }, take: 50 })
      : [],
  ]);
  res.json({
    listings,
    images: images.map((i) => ({ id: i.id, propertyId: i.propertyId, propertyTitle: i.property.title, createdAt: i.createdAt })),
    documents: documents.map((d) => ({ id: d.id, propertyId: d.propertyId, propertyTitle: d.property.title, docType: d.docType, originalName: d.originalName, createdAt: d.createdAt })),
  });
}

const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional() });

/** POST /api/moderation/listings/:id — approve or reject a listing. */
export async function moderateListing(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findUnique({ where: { id: idParam(req) } }), "Listing");
  if (property.status !== "PENDING_REVIEW") fail("failed-precondition", REASONS.INVALID_STATE, "This listing is not waiting for review.");
  const { decision, note } = parseInput(decisionSchema, req.body);
  if (decision === "REJECT" && !note) fail("invalid-argument", REASONS.INVALID_INPUT, "Add a reason so the owner can fix the listing.");
  await prisma.$transaction(async (tx) => {
    await tx.property.update({
      where: { id: property.id },
      data: { status: decision === "APPROVE" ? "ACTIVE" : "REJECTED", moderationNote: note ?? null, reviewedById: me(req).id, reviewedAt: new Date() },
    });
    // Approving a listing also approves its pending photos.
    if (decision === "APPROVE") await tx.propertyImage.updateMany({ where: { propertyId: property.id, status: "PENDING" }, data: { status: "APPROVED", reviewedById: me(req).id } });
    await logActivity(req, decision === "APPROVE" ? "listing.approve" : "listing.reject", "property", property.id, { note }, tx);
  });
  await notify(property.ownerId, decision === "APPROVE" ? "Your listing is live 🎉" : "Your listing needs changes", decision === "APPROVE" ? `"${property.title}" is now visible to tenants.` : `"${property.title}": ${note}`, `/properties/${property.id}`);
  res.json({ ok: true });
}

/** POST /api/moderation/images/:imageId — approve or reject a single photo. */
export async function moderateImage(req: Request, res: Response): Promise<void> {
  const image = found(await prisma.propertyImage.findUnique({ where: { id: idParam(req, "imageId") } }), "Image");
  const { decision } = parseInput(decisionSchema, req.body);
  await prisma.propertyImage.update({ where: { id: image.id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: me(req).id } });
  await logActivity(req, decision === "APPROVE" ? "image.approve" : "image.reject", "property_image", image.id);
  res.json({ ok: true });
}

/* ─────────────── Assignments & inspections ─────────────── */

const assignmentSchema = z.object({ userId: z.string().uuid(), type: z.enum(["MANAGER", "AGENT"]) });

/** POST /api/properties/:id/assignments — assign a property manager or agent. */
export async function addAssignment(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findUnique({ where: { id: idParam(req) } }), "Property");
  const { userId, type } = parseInput(assignmentSchema, req.body);
  const expectedRole = type === "MANAGER" ? "PROPERTY_MANAGER" : "PROPERTY_AGENT";
  const assignee = await prisma.user.findFirst({ where: { id: userId, role: expectedRole, accountStatus: "ACTIVE" } });
  if (!assignee) fail("invalid-argument", REASONS.INVALID_INPUT, `Choose an active ${type === "MANAGER" ? "property manager" : "agent"}.`);
  await prisma.propertyAssignment.upsert({
    where: { propertyId_userId_type: { propertyId: property.id, userId, type } },
    create: { propertyId: property.id, userId, type, createdById: me(req).id },
    update: {},
  });
  await logActivity(req, "assignment.add", "property", property.id, { userId, type });
  await notify(userId, "New property assigned", `You were assigned to "${property.title}".`, `/properties/${property.id}`);
  res.status(201).json({ ok: true });
}

/** DELETE /api/properties/:id/assignments/:assignmentId */
export async function removeAssignment(req: Request, res: Response): Promise<void> {
  const propertyId = idParam(req);
  const assignment = found(await prisma.propertyAssignment.findFirst({ where: { id: idParam(req, "assignmentId"), propertyId } }), "Assignment");
  await prisma.propertyAssignment.delete({ where: { id: assignment.id } });
  await logActivity(req, "assignment.remove", "property", propertyId, { userId: assignment.userId, type: assignment.type });
  res.json({ ok: true });
}

const inspectionSchema = z.object({ scheduledAt: z.coerce.date(), notes: z.string().trim().max(2000).optional() });
const inspectionUpdateSchema = z.object({
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]),
  result: z.enum(["PASSED", "NEEDS_REPAIRS", "FAILED"]).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** POST /api/properties/:id/inspections */
export async function scheduleInspection(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "inspections.manage");
  const input = parseInput(inspectionSchema, req.body);
  const inspection = await prisma.propertyInspection.create({ data: { propertyId: property.id, inspectorId: me(req).id, scheduledAt: input.scheduledAt, notes: input.notes ?? null } });
  await notify(property.ownerId, "Inspection scheduled", `"${property.title}" on ${input.scheduledAt.toLocaleString("en-IN")}.`, `/properties/${property.id}`);
  res.status(201).json({ inspection });
}

/** PATCH /api/properties/:id/inspections/:inspectionId */
export async function updateInspection(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "inspections.manage");
  const inspection = found(await prisma.propertyInspection.findFirst({ where: { id: idParam(req, "inspectionId"), propertyId: property.id } }), "Inspection");
  const input = parseInput(inspectionUpdateSchema, req.body);
  const updated = await prisma.propertyInspection.update({ where: { id: inspection.id }, data: { status: input.status, result: input.result ?? null, notes: input.notes ?? inspection.notes } });
  res.json({ inspection: updated });
}

