import { randomUUID } from "node:crypto";
import type { Prisma, PropertyDocument } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { DOCUMENT_CATEGORIES, documentName, documentState, leaseCovers, needsVerification, tenantCanSee, type TenantLease } from "../lib/documentAccess";
import { fail } from "../lib/errors";
import { enumQuery, found, idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { discardUploads, storage } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { ID_PREFIX } from "../properties/catalog";
import { nextCode } from "../properties/ids";
import { documentUrl } from "../properties/presenters";
import { audit, childKey, inScope, scopedProperty, withProperty } from "../properties/service";

/*
 * Property & unit documents.
 *  Landlord (properties.manage scope): upload for the whole property or one flat / villa / room / bed,
 *  any custom name for "Other", share with tenant on/off, replace (keeps versions), archive, see requests.
 *  Tenant: sees only shared, current documents of their own property / unit (from their ACTIVE lease),
 *  and can request documents. All checks are server-side; ids in URLs are never trusted on their own.
 */

const MAX_DOC_BYTES = 5 * 1024 * 1024;
const toDate = z.coerce.date();
const optDate = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), toDate.optional());
const bool = z.preprocess((v) => v === true || v === "true" || v === "1" || v === "on", z.boolean());

const uploadSchema = z
  .object({
    docType: z.enum(DOCUMENT_CATEGORIES),
    unitId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    roomId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    bedId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    customName: z.string().trim().max(150).optional().or(z.literal("").transform(() => undefined)),
    description: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
    documentDate: optDate,
    expiryDate: optDate,
    shareWithTenant: bool.default(false),
    requestId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  })
  .strict()
  .refine((v) => v.docType !== "OTHER" || (v.customName ?? "").length >= 2, { message: "Enter the document name.", path: ["customName"] })
  .refine((v) => [v.unitId, v.roomId, v.bedId].filter(Boolean).length <= 1, { message: "Choose one flat, room or bed — or the whole property.", path: ["unitId"] })
  .refine((v) => !v.documentDate || !v.expiryDate || v.expiryDate >= v.documentDate, { message: "Expiry date must be after the document date.", path: ["expiryDate"] });

/** Wraps a handler so uploaded files are deleted if authorization or validation fails. */
function cleanupOnError(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      await discardUploads(req);
      throw error;
    }
  };
}

async function landlordProperty(req: Request) {
  const property = await scopedProperty(req, "properties.manage");
  if (property.activeStatus === "ARCHIVED") fail("failed-precondition", REASONS.INVALID_STATE, "This property is archived.");
  return property;
}

/** Checks the flat / room / bed belongs to the property. */
async function checkTarget(propertyId: string, t: { unitId?: string; roomId?: string; bedId?: string }) {
  if (t.unitId && !(await prisma.propertyUnit.count({ where: { id: t.unitId, propertyId } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Unit not found in this property.");
  if (t.roomId && !(await prisma.propertyRoom.count({ where: { id: t.roomId, propertyId } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Room not found in this property.");
  if (t.bedId && !(await prisma.propertyBed.count({ where: { id: t.bedId, room: { propertyId } } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Bed not found in this property.");
}

/** ACTIVE leases (with the bed's room) of a property — the tenants a shared document can reach. */
async function activeLeases(where: Prisma.LeaseWhereInput): Promise<Array<TenantLease & { tenantId: string; id: string }>> {
  const leases = await prisma.lease.findMany({ where: { ...where, status: "ACTIVE" }, select: { id: true, tenantId: true, propertyId: true, unitId: true, bedId: true, status: true } });
  const beds = await prisma.propertyBed.findMany({ where: { id: { in: leases.map((l) => l.bedId).filter((x): x is string => !!x) } }, select: { id: true, roomId: true } });
  return leases.map((l) => ({ ...l, roomId: beds.find((b) => b.id === l.bedId)?.roomId ?? null }));
}

/** Tells each authorised tenant once (sharedNotifiedAt guards repeats when sharing is toggled). */
async function notifyTenants(doc: PropertyDocument, propertyName: string, updated = false): Promise<number> {
  if (!doc.sharedWithTenant || !doc.isCurrent || doc.archivedAt) return 0;
  const claim = updated ? { count: 1 } : await prisma.propertyDocument.updateMany({ where: { id: doc.id, sharedNotifiedAt: null }, data: { sharedNotifiedAt: new Date() } });
  if (!claim.count) return 0;
  const leases = (await activeLeases({ propertyId: doc.propertyId })).filter((l) => leaseCovers(doc, l));
  const tenants = [...new Set(leases.map((l) => l.tenantId))];
  const name = documentName(doc);
  const custom = doc.docType === "OTHER";
  for (const t of tenants) {
    await notify(
      t,
      updated ? "Property document updated" : custom ? "New Document Available" : "New Property Document Uploaded",
      updated ? `Your landlord uploaded a new version of ${name} for ${propertyName}.` : custom ? `Your landlord has uploaded ${name} for your property.` : `Your landlord has uploaded a new ${name} for your property. Tap to view the document.`,
      `/my-documents?doc=${doc.id}`,
    );
  }
  return tenants.length;
}

function present(d: PropertyDocument, places: Map<string, string>, extra: Record<string, unknown> = {}) {
  const { filePath: _f, ...rest } = d;
  void _f;
  return {
    ...rest,
    name: documentName(d),
    target: d.bedId || d.roomId || d.unitId ? (placeOf(places, { unitId: d.unitId, bedId: d.bedId }) ?? (d.roomId ? places.get(`room:${d.roomId}`) ?? "Room" : null)) : null,
    state: documentState(d),
    url: documentUrl(d.id),
    ...extra,
  };
}

async function labelsFor(docs: Array<{ unitId: string | null; bedId: string | null; roomId: string | null }>) {
  const places = await placeLabels(docs);
  const roomIds = [...new Set(docs.map((d) => d.roomId).filter((x): x is string => !!x))];
  if (roomIds.length) for (const r of await prisma.propertyRoom.findMany({ where: { id: { in: roomIds } }, select: { id: true, roomNumber: true } })) places.set(`room:${r.id}`, `Room ${r.roomNumber}`);
  return places;
}

/* ─────────────── Landlord ─────────────── */

/**
 * POST /api/v1/properties/:propertyId/documents — multipart "file" + fields. Property-level when no
 * unit / room / bed is given. With requestId: fulfils that tenant's document request (and shares it).
 */
export const uploadDocument = cleanupOnError(async (req, res) => {
  const file = req.file;
  const property = await landlordProperty(req);
  await consumeRateLimit(`upload:${me(req).id}`, RATE_LIMITS.UPLOAD.limit, RATE_LIMITS.UPLOAD.windowMs);
  if (!file) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a file to upload.");
  if (file.size > MAX_DOC_BYTES) fail("invalid-argument", REASONS.INVALID_INPUT, "Files can be up to 5 MB.");
  const input = parseInput(uploadSchema, req.body ?? {});
  await checkTarget(property.id, input);
  const request = input.requestId ? await prisma.documentRequest.findFirst({ where: { id: input.requestId, propertyId: property.id, status: { in: ["PENDING", "IN_PROGRESS"] } } }) : null;
  if (input.requestId && !request) fail("invalid-argument", REASONS.INVALID_INPUT, "That document request is no longer open.");
  // A requested document is for the requesting tenant: it goes to their flat / bed and is shared.
  const target = request ? { unitId: request.unitId ?? undefined, bedId: request.bedId ?? undefined, roomId: undefined } : input;
  const share = request ? true : input.shareWithTenant;

  const doc = await withProperty(property.id, async (tx) => {
    const code = await nextCode(tx, ID_PREFIX.DOCUMENT);
    const created = await tx.propertyDocument.create({
      data: {
        code,
        propertyId: property.id,
        unitId: target.unitId ?? null,
        roomId: target.roomId ?? null,
        bedId: target.bedId ?? null,
        docType: input.docType,
        customName: input.customName ?? (request ? request.documentName : null),
        description: input.description ?? null,
        documentDate: input.documentDate ?? null,
        expiryDate: input.expiryDate ?? null,
        sharedWithTenant: share,
        needsVerification: needsVerification(input.docType),
        fileSize: file.size,
        filePath: storage.keyFor(file),
        originalName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        uploadedById: me(req).id,
      },
    });
    await tx.propertyDocument.update({ where: { id: created.id }, data: { groupId: created.id } });
    if (request) {
      await tx.documentRequest.update({ where: { id: request.id }, data: { status: "FULFILLED", linkedDocumentId: created.id, respondedById: me(req).id } });
    }
    // The file itself is never logged — only its type, name and id.
    await audit(tx, req, { propertyId: property.id, entityType: "DOCUMENT", entityId: created.id, action: "document.upload", newValue: { code, docType: input.docType, name: documentName(created), shared: share, unitId: created.unitId, roomId: created.roomId, bedId: created.bedId, requestId: request?.id ?? null } });
    return { ...created, groupId: created.id };
  });
  const propertyName = property.title ?? property.code;
  // Saved first, then notified.
  const notified = share ? await notifyTenants(doc, propertyName) : 0;
  if (request) await notify(request.tenantId, "Requested document is ready", `Your landlord uploaded "${documentName(doc)}" for ${propertyName}.`, `/my-documents?doc=${doc.id}`);
  res.locals.message = share ? `Document uploaded and shared${notified ? ` with ${notified} tenant${notified > 1 ? "s" : ""}` : ""}.` : "Document uploaded (private).";
  res.status(201).json({ document: { id: doc.id, code: doc.code, docType: doc.docType, name: documentName(doc), originalName: doc.originalName, status: doc.status, sharedWithTenant: doc.sharedWithTenant, url: documentUrl(doc.id) }, notifiedTenants: notified });
});

/** GET /api/v1/properties/:propertyId/documents?unitId=&roomId=&bedId=&docType=&archived=true — owner, managers, verifiers. */
export async function listDocuments(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const manage = await inScope(req, "properties.manage", property.id);
  if (!manage && !(await inScope(req, "documents.verify", property.id))) fail("not-found", REASONS.NOT_FOUND, "Property not found.");
  const p = pagination(req);
  const q = (k: string) => (typeof req.query[k] === "string" && req.query[k] ? (req.query[k] as string) : undefined);
  const docType = enumQuery(req, "docType", DOCUMENT_CATEGORIES);
  const where: Prisma.PropertyDocumentWhereInput = {
    propertyId: property.id,
    isCurrent: true,
    archivedAt: req.query.archived === "true" ? { not: null } : null,
    ...(q("unitId") ? { unitId: q("unitId") } : {}),
    ...(q("roomId") ? { roomId: q("roomId") } : {}),
    ...(q("bedId") ? { bedId: q("bedId") } : {}),
    ...(q("level") === "property" ? { unitId: null, roomId: null, bedId: null } : {}),
    ...(docType ? { docType } : {}),
    // Verifiers (not managers) only see what they need to verify.
    ...(manage ? {} : { needsVerification: true }),
  };
  const [items, total] = await Promise.all([prisma.propertyDocument.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.propertyDocument.count({ where })]);
  const places = await labelsFor(items);
  const versions = await prisma.propertyDocument.groupBy({ by: ["groupId"], where: { groupId: { in: items.map((d) => d.groupId ?? d.id) } }, _count: { _all: true } });
  res.json(paged(items.map((d) => present(d, places, { versions: versions.find((v) => v.groupId === (d.groupId ?? d.id))?._count._all ?? 1 })), total, p));
}

async function managedDoc(req: Request) {
  const doc = found(await prisma.propertyDocument.findFirst({ where: childKey(req, "docId"), include: { property: { select: { title: true, code: true } } } }), "Document");
  if (!(await inScope(req, "properties.manage", doc.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Document not found.");
  return doc;
}

const updateSchema = z
  .object({
    customName: z.string().trim().max(150).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    documentDate: z.coerce.date().nullable().optional(),
    expiryDate: z.coerce.date().nullable().optional(),
    sharedWithTenant: z.boolean().optional(),
  })
  .strict();

/** PATCH /api/v1/documents/:docId — details and tenant sharing (logged). */
export async function updateDocument(req: Request, res: Response): Promise<void> {
  const doc = await managedDoc(req);
  if (!doc.isCurrent || doc.archivedAt) fail("failed-precondition", REASONS.INVALID_STATE, "Only the current, active version can be changed.");
  const input = parseInput(updateSchema, req.body);
  if (doc.docType === "OTHER" && input.customName !== undefined && (input.customName ?? "").length < 2) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter the document name.");
  const updated = await withProperty(doc.propertyId, async (tx) => {
    const u = await tx.propertyDocument.update({ where: { id: doc.id }, data: input });
    await audit(tx, req, {
      propertyId: doc.propertyId,
      entityType: "DOCUMENT",
      entityId: doc.id,
      action: input.sharedWithTenant !== undefined && input.sharedWithTenant !== doc.sharedWithTenant ? (input.sharedWithTenant ? "document.share" : "document.unshare") : "document.update",
      oldValue: { customName: doc.customName, description: doc.description, documentDate: doc.documentDate, expiryDate: doc.expiryDate, sharedWithTenant: doc.sharedWithTenant },
      newValue: input,
    });
    return u;
  });
  const notified = !doc.sharedWithTenant && updated.sharedWithTenant ? await notifyTenants(updated, doc.property.title ?? doc.property.code) : 0;
  res.locals.message = notified ? `Saved and shared with ${notified} tenant${notified > 1 ? "s" : ""}.` : "Saved";
  res.json({ ok: true });
}

/** POST /api/v1/documents/:docId/replace — multipart "file": a new version; the previous file is kept. */
export const replaceDocument = cleanupOnError(async (req, res) => {
  const file = req.file;
  const doc = await managedDoc(req);
  await consumeRateLimit(`upload:${me(req).id}`, RATE_LIMITS.UPLOAD.limit, RATE_LIMITS.UPLOAD.windowMs);
  if (!file) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a file to upload.");
  if (file.size > MAX_DOC_BYTES) fail("invalid-argument", REASONS.INVALID_INPUT, "Files can be up to 5 MB.");
  if (!doc.isCurrent || doc.archivedAt) fail("failed-precondition", REASONS.INVALID_STATE, "Replace the current version.");
  const next = await withProperty(doc.propertyId, async (tx) => {
    const claimed = await tx.propertyDocument.updateMany({ where: { id: doc.id, isCurrent: true }, data: { isCurrent: false } });
    if (!claimed.count) fail("failed-precondition", REASONS.INVALID_STATE, "This document was just replaced. Refresh and try again.");
    const created = await tx.propertyDocument.create({
      data: {
        code: await nextCode(tx, ID_PREFIX.DOCUMENT),
        propertyId: doc.propertyId,
        unitId: doc.unitId,
        roomId: doc.roomId,
        bedId: doc.bedId,
        docType: doc.docType,
        customName: doc.customName,
        description: doc.description,
        documentDate: doc.documentDate,
        expiryDate: doc.expiryDate,
        sharedWithTenant: doc.sharedWithTenant,
        sharedNotifiedAt: doc.sharedNotifiedAt,
        needsVerification: doc.needsVerification,
        groupId: doc.groupId ?? doc.id,
        version: doc.version + 1,
        fileSize: file.size,
        filePath: storage.keyFor(file),
        originalName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        uploadedById: me(req).id,
      },
    });
    await audit(tx, req, { propertyId: doc.propertyId, entityType: "DOCUMENT", entityId: created.id, action: "document.replace", oldValue: { id: doc.id, code: doc.code, version: doc.version }, newValue: { code: created.code, version: created.version } });
    return created;
  });
  if (next.sharedWithTenant) await notifyTenants(next, doc.property.title ?? doc.property.code, true);
  res.locals.message = `New version uploaded (v${next.version}). The previous file is kept in history.`;
  res.status(201).json({ document: { id: next.id, code: next.code, version: next.version } });
});

/** GET /api/v1/documents/:docId/versions — every version of this document (newest first). */
export async function documentVersions(req: Request, res: Response): Promise<void> {
  const doc = await managedDoc(req);
  const rows = await prisma.propertyDocument.findMany({ where: { OR: [{ groupId: doc.groupId ?? doc.id }, { id: doc.groupId ?? doc.id }] }, orderBy: { version: "desc" } });
  const people = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.uploadedById) } }, select: { id: true, fullName: true } });
  const places = await labelsFor(rows);
  res.json({ items: rows.map((r) => present(r, places, { uploadedBy: people.find((p) => p.id === r.uploadedById)?.fullName ?? null })) });
}

const archiveSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/** POST /api/v1/documents/:docId/archive — removes it from lists and from tenants; file and history kept. */
export async function archiveDocument(req: Request, res: Response): Promise<void> {
  const doc = await managedDoc(req);
  if (doc.archivedAt) fail("failed-precondition", REASONS.INVALID_STATE, "Already archived.");
  const { reason } = parseInput(archiveSchema, req.body);
  await withProperty(doc.propertyId, async (tx) => {
    await tx.propertyDocument.update({ where: { id: doc.id }, data: { archivedAt: new Date(), archivedById: me(req).id } });
    await audit(tx, req, { propertyId: doc.propertyId, entityType: "DOCUMENT", entityId: doc.id, action: "document.archive", newValue: { reason } });
  });
  res.locals.message = "Document archived";
  res.json({ ok: true });
}

/** POST /api/v1/documents/:docId/restore — brings an archived current version back. */
export async function restoreDocument(req: Request, res: Response): Promise<void> {
  const doc = await managedDoc(req);
  if (!doc.archivedAt) fail("failed-precondition", REASONS.INVALID_STATE, "This document isn't archived.");
  await withProperty(doc.propertyId, async (tx) => {
    await tx.propertyDocument.update({ where: { id: doc.id }, data: { archivedAt: null, archivedById: null } });
    await audit(tx, req, { propertyId: doc.propertyId, entityType: "DOCUMENT", entityId: doc.id, action: "document.restore" });
  });
  res.json({ ok: true });
}

/**
 * GET /api/v1/files/documents/:docId — streamed only after the authorization check (no public URLs):
 * owner / managers / verifiers, or a tenant this document is shared with. Every download is logged.
 */
export async function getDocumentFile(req: Request, res: Response): Promise<void> {
  const doc = found(await prisma.propertyDocument.findFirst({ where: childKey(req, "docId") }), "Document");
  const user = me(req);
  const staff = (await inScope(req, "properties.manage", doc.propertyId)) || (doc.needsVerification && (await inScope(req, "documents.verify", doc.propertyId)));
  if (!staff) {
    const leases = await activeLeases({ tenantId: user.id, propertyId: doc.propertyId });
    if (!tenantCanSee(doc, leases)) fail("not-found", REASONS.NOT_FOUND, "Document not found.");
  }
  await prisma.propertyAuditLog.create({
    data: { eventId: randomUUID(), propertyId: doc.propertyId, entityType: "DOCUMENT", entityId: doc.id, action: staff ? "document.download" : "document.tenant_download", performedById: user.id, actorRole: user.roles.join(",").slice(0, 32), sourcePlatform: req.platform ?? "BACKEND", requestId: req.requestId ?? null },
  });
  storage.send(res, doc.filePath, doc.mimeType, doc.originalName);
}

/* ─────────────── Tenant ─────────────── */

/** GET /api/v1/my/documents — documents shared with me for each property I'm renting now. */
export async function myDocuments(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const leases = await activeLeases({ tenantId: user.id });
  const props = await prisma.property.findMany({ where: { id: { in: leases.map((l) => l.propertyId) } }, select: { id: true, title: true, code: true } });
  const docs = leases.length
    ? await prisma.propertyDocument.findMany({ where: { propertyId: { in: leases.map((l) => l.propertyId) }, sharedWithTenant: true, isCurrent: true, archivedAt: null }, orderBy: { createdAt: "desc" } })
    : [];
  const places = await labelsFor([...docs, ...leases.map((l) => ({ unitId: l.unitId, bedId: l.bedId, roomId: null }))]);
  res.json({
    rentals: leases.map((l) => {
      const p = props.find((x) => x.id === l.propertyId);
      return {
        leaseId: l.id,
        property: { id: l.propertyId, name: p?.title ?? p?.code ?? "" },
        place: placeOf(places, l),
        // The server decides visibility; another unit's documents never reach this list.
        documents: docs
          .filter((d) => tenantCanSee(d, [l]))
          .map((d) => ({ id: d.id, code: d.code, name: documentName(d), category: d.docType, description: d.description, uploadedAt: d.createdAt, documentDate: d.documentDate, expiryDate: d.expiryDate, state: documentState(d), version: d.version, mimeType: d.mimeType, url: documentUrl(d.id), level: d.unitId || d.roomId || d.bedId ? "UNIT" : "PROPERTY" })),
      };
    }),
  });
}

const requestSchema = z.object({ documentName: z.string().trim().min(2, "Enter the document name.").max(150), reason: z.string().trim().max(1000).optional() }).strict();

/** POST /api/v1/leases/:id/document-requests — the tenant of an ACTIVE lease asks the landlord for a document. */
export async function requestDocument(req: Request, res: Response): Promise<void> {
  const user = me(req);
  await consumeRateLimit(`doc-request:${user.id}`, 20, 24 * 60 * 60 * 1000);
  const lease = await prisma.lease.findFirst({ where: { id: idParam(req), tenantId: user.id, status: "ACTIVE" }, include: { property: { select: { title: true, code: true } } } });
  if (!lease) fail("not-found", REASONS.NOT_FOUND, "Active lease not found.");
  const input = parseInput(requestSchema, req.body);
  const dup = await prisma.documentRequest.findFirst({ where: { leaseId: lease.id, documentName: input.documentName, status: { in: ["PENDING", "IN_PROGRESS"] } } });
  if (dup) fail("already-exists", REASONS.CONFLICT, "You've already requested this document.");
  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.documentRequest.create({
      data: { code: await nextCode(tx, ID_PREFIX.DOC_REQUEST), tenantId: user.id, landlordId: lease.landlordId, leaseId: lease.id, propertyId: lease.propertyId, unitId: lease.unitId, bedId: lease.bedId, documentName: input.documentName, reason: input.reason || null },
    });
    await logActivity(req, "document_request.create", "document_request", r.id, { leaseId: lease.id, documentName: input.documentName }, tx);
    return r;
  });
  const place = placeOf(await placeLabels([lease]), lease);
  await notify(lease.landlordId, "Tenant requested a document", `${user.fullName} requested "${input.documentName}" for ${place ? `${place}, ` : ""}${lease.property.title ?? lease.property.code}.`, `/properties/${lease.propertyId}?tab=documents`);
  res.locals.message = "Request sent to your landlord.";
  res.status(201).json({ id: created.id, code: created.code });
}

/** GET /api/v1/my/document-requests — my requests (tenant). */
export async function myDocumentRequests(req: Request, res: Response): Promise<void> {
  const items = await prisma.documentRequest.findMany({ where: { tenantId: me(req).id }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ items });
}

/** POST /api/v1/document-requests/:id/cancel — tenant withdraws an open request. */
export async function cancelDocumentRequest(req: Request, res: Response): Promise<void> {
  const r = await prisma.documentRequest.updateMany({ where: { id: idParam(req), tenantId: me(req).id, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
  if (!r.count) fail("not-found", REASONS.NOT_FOUND, "Open request not found.");
  res.json({ ok: true });
}

/** GET /api/v1/properties/:propertyId/document-requests?status= — landlord / manager. */
export async function propertyDocumentRequests(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const p = pagination(req);
  const status = enumQuery(req, "status", ["PENDING", "IN_PROGRESS", "FULFILLED", "REJECTED", "CANCELLED"] as const);
  const where: Prisma.DocumentRequestWhereInput = { propertyId: property.id, ...(status ? { status } : { status: { in: ["PENDING", "IN_PROGRESS"] } }) };
  const [items, total] = await Promise.all([prisma.documentRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }), prisma.documentRequest.count({ where })]);
  const [tenants, places] = await Promise.all([prisma.user.findMany({ where: { id: { in: items.map((i) => i.tenantId) } }, select: { id: true, fullName: true } }), placeLabels(items)]);
  res.json(paged(items.map((i) => ({ ...i, tenantName: tenants.find((t) => t.id === i.tenantId)?.fullName ?? null, place: placeOf(places, i) })), total, p));
}

const respondSchema = z
  .object({ status: z.enum(["IN_PROGRESS", "REJECTED"]), rejectionReason: z.string().trim().max(500).optional() })
  .strict()
  .refine((v) => v.status !== "REJECTED" || (v.rejectionReason ?? "").length >= 5, { message: "Give a reason (at least 5 characters).", path: ["rejectionReason"] });

/** POST /api/v1/document-requests/:id/respond — landlord marks in progress or rejects (with reason). */
export async function respondDocumentRequest(req: Request, res: Response): Promise<void> {
  const r = found(await prisma.documentRequest.findUnique({ where: { id: idParam(req) } }), "Request");
  if (!(await inScope(req, "properties.manage", r.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Request not found.");
  const input = parseInput(respondSchema, req.body);
  const done = await prisma.documentRequest.updateMany({ where: { id: r.id, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: input.status, rejectionReason: input.status === "REJECTED" ? input.rejectionReason! : null, respondedById: me(req).id } });
  if (!done.count) fail("failed-precondition", REASONS.INVALID_STATE, "This request is already closed.");
  await logActivity(req, `document_request.${input.status.toLowerCase()}`, "document_request", r.id, { reason: input.rejectionReason ?? null });
  await notify(r.tenantId, input.status === "REJECTED" ? "Document request declined" : "Landlord is working on your request", input.status === "REJECTED" ? `Your request for "${r.documentName}" was declined: ${input.rejectionReason}` : `Your landlord is preparing "${r.documentName}".`, "/my-documents");
  res.json({ ok: true });
}
