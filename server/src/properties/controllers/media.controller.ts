import { appConfig } from "../../appConfig/service";
import type { Request, Response } from "express";
import { z } from "zod";
import { RATE_LIMITS, REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { consumeRateLimit } from "../../lib/rateLimit";
import { discardUploads, storage } from "../../lib/uploads";
import { parseInput } from "../../lib/validation";
import { can, hasRole, me } from "../../middleware/auth";
import { imageUrl } from "../presenters";
import { documentVerifySchema, imageUpdateSchema, imageUploadSchema } from "../schemas";
import { audit, childKey, inScope, isModerator, withProperty } from "../service";
import { editTarget } from "../revisions";
import { readFile, writeFile } from "node:fs/promises";
import { imageSize } from "../../lib/imageSize";
import { stripImageMetadata } from "../../lib/imageScrub";

/** 360° photos: own limit per property, JPG ≤ 6 MB, ratio ≥ 1.9, ≤ 4096 × 2048. */
const MAX_PANORAMAS = 5;
const PANORAMA_MAX_BYTES = 6 * 1024 * 1024;
import { evaluateForUser } from "../../services/referral.service";


async function editable(req: Request) {
  // APPROVED / PUBLISHED listings: the working copy of their change request (the live data never changes here).
  const property = await editTarget(req);
  return property;
}

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

/** POST /api/v1/properties/:propertyId/images — multipart "files" (+ category, unitId, roomId, inspectionId). */
export const uploadImages = cleanupOnError(async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const property = await editable(req);
  await consumeRateLimit(`upload:${me(req).id}`, RATE_LIMITS.UPLOAD.limit, RATE_LIMITS.UPLOAD.windowMs);
  if (files.length === 0) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one image.");
  const { inspectionId, ...rest } = req.body ?? {};
  const input = parseInput(imageUploadSchema, rest);
  if (input.unitId && !(await prisma.propertyUnit.count({ where: { id: input.unitId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Unit not found in this property.");
  if (input.roomId && !(await prisma.propertyRoom.count({ where: { id: input.roomId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Room not found in this property.");
  const inspection = typeof inspectionId === "string" && inspectionId ? found(await prisma.propertyInspection.findFirst({ where: { id: inspectionId, propertyId: property.id } }), "Inspection") : null;
  const panorama = !inspection && input.category === "PANORAMA_360";
  // Panoramas have their own limit; ordinary photos use the limit from Admin → App configuration → Properties.
  const existing = await prisma.propertyImage.count({ where: { propertyId: property.id, category: panorama ? "PANORAMA_360" : { not: "PANORAMA_360" } } });
  if (panorama) {
    if (existing + files.length > MAX_PANORAMAS) fail("invalid-argument", REASONS.INVALID_INPUT, `A property can have at most ${MAX_PANORAMAS} 360° photos.`);
  } else {
    const maxImages = (await appConfig()).properties.maxImages;
    if (existing + files.length > maxImages) fail("invalid-argument", REASONS.INVALID_INPUT, `A property can have at most ${maxImages} photos.`);
  }
  // Read sizes, check panoramas, strip EXIF / GPS (the file on disk is rewritten without metadata).
  const sizes: Array<{ width: number; height: number } | null> = [];
  for (const f of files) {
    const buf = await readFile(f.path);
    const size = imageSize(buf);
    if (panorama) {
      if (f.mimetype !== "image/jpeg") fail("invalid-argument", REASONS.INVALID_INPUT, "360° photos must be JPG.");
      if (buf.length > PANORAMA_MAX_BYTES) fail("invalid-argument", REASONS.INVALID_INPUT, "A 360° photo can be up to 6 MB.");
      if (!size || size.width / size.height < 1.9) fail("invalid-argument", REASONS.INVALID_INPUT, "Not a panorama");
      if (size!.width > 4096 || size!.height > 2048) fail("invalid-argument", REASONS.INVALID_INPUT, "360° photos can be up to 4096 × 2048 pixels. Please export a smaller size.");
    }
    if (f.mimetype === "image/jpeg" || f.mimetype === "image/png") {
      try {
        await writeFile(f.path, stripImageMetadata(buf, f.mimetype));
      } catch {
        if (panorama) fail("invalid-argument", REASONS.INVALID_INPUT, "That image file looks damaged. Please export it again.");
      }
    }
    sizes.push(size);
  }
  const user = me(req);
  const created = await withProperty(property.id, async (tx) => {
    const rows = [];
    for (const [i, f] of files.entries()) {
      rows.push(
        await tx.propertyImage.create({
          data: {
            propertyId: property.id,
            unitId: input.unitId ?? null,
            roomId: input.roomId ?? null,
            inspectionId: inspection?.id ?? null,
            category: inspection ? "INSPECTION" : input.category,
            slot: inspection ? null : (input.slot ?? null),
            displayOrder: existing + i,
            filePath: storage.keyFor(f),
            mimeType: f.mimetype,
            width: sizes[i]?.width ?? null,
            height: sizes[i]?.height ?? null,
            uploadedById: user.id,
            // Inspection evidence is not public listing content; it never needs listing moderation.
            status: inspection ? "APPROVED" : "PENDING",
          },
        }),
      );
    }
    await audit(tx, req, { propertyId: property.id, entityType: "IMAGE", entityId: property.id, action: "images.upload", newValue: { count: rows.length, category: input.category, slot: input.slot ?? null, unitId: input.unitId ?? null, roomId: input.roomId ?? null } });
    return rows;
  });
  res.locals.message = `${created.length} photo(s) uploaded`;
  res.status(201).json({ images: created.map((i) => ({ id: i.id, category: i.category, slot: i.slot, unitId: i.unitId, roomId: i.roomId, status: i.status, displayOrder: i.displayOrder, width: i.width, height: i.height, url: imageUrl(i.id) })) });
});

/** PATCH /api/v1/properties/:propertyId/images/:imageId — category / display order. */
export async function updateImage(req: Request, res: Response): Promise<void> {
  const property = await editable(req);
  const image = found(await prisma.propertyImage.findFirst({ where: { id: String(req.params.imageId), propertyId: property.id } }), "Image");
  const input = parseInput(imageUpdateSchema, req.body);
  if (input.unitId && !(await prisma.propertyUnit.count({ where: { id: input.unitId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Unit not found in this property.");
  if (input.roomId && !(await prisma.propertyRoom.count({ where: { id: input.roomId, propertyId: property.id } }))) fail("invalid-argument", REASONS.INVALID_INPUT, "Room not found in this property.");
  if (image.inspectionId && (input.unitId !== undefined || input.roomId !== undefined)) fail("failed-precondition", REASONS.INVALID_STATE, "Inspection photos can't be moved.");
  await withProperty(property.id, async (tx) => {
    await tx.propertyImage.update({ where: { id: image.id }, data: input });
    await audit(tx, req, { propertyId: property.id, entityType: "IMAGE", entityId: image.id, action: "image.update", oldValue: { category: image.category, displayOrder: image.displayOrder, unitId: image.unitId, roomId: image.roomId, slot: image.slot }, newValue: input });
  });
  res.json({ ok: true });
}

/** DELETE /api/v1/properties/:propertyId/images/:imageId */
export async function deleteImage(req: Request, res: Response): Promise<void> {
  const property = await editable(req);
  const image = found(await prisma.propertyImage.findFirst({ where: { id: String(req.params.imageId), propertyId: property.id } }), "Image");
  await withProperty(property.id, async (tx) => {
    await tx.propertyImage.delete({ where: { id: image.id } });
    await tx.propertyUtility.updateMany({ where: { meterReadingImageId: image.id }, data: { meterReadingImageId: null } });
    await audit(tx, req, { propertyId: property.id, entityType: "IMAGE", entityId: image.id, action: "image.delete", oldValue: { category: image.category } });
  });
  await storage.remove(image.filePath);
  res.json({ ok: true });
}

/**
 * GET /api/v1/files/property-images/:imageId — approved photos of published listings are visible to
 * anyone who can browse; everything else only within properties.view scope or to moderators.
 */
export async function getImageFile(req: Request, res: Response): Promise<void> {
  const image = found(
    await prisma.propertyImage.findUnique({ where: { id: String(req.params.imageId) }, include: { property: { select: { id: true, publicationStatus: true, activeStatus: true } } } }),
    "Image",
  );
  const isPublic = image.status === "APPROVED" && !image.inspectionId && image.property.publicationStatus === "PUBLISHED" && image.property.activeStatus === "ACTIVE" && can(req, "properties.browse");
  if (!isPublic && !isModerator(req) && !(await inScope(req, "properties.view", image.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Image not found.");
  storage.send(res, image.filePath, image.mimeType);
}

/* ─────────────── Documents (private) ─────────────── */

/** POST /api/v1/properties/:propertyId/documents — multipart "file" + docType (+ unitId). */
// Upload, list and download of documents live in controllers/documents.controller.ts.

/** POST /api/v1/documents/:docId/verify — verifiers within scope; never for your own property. */
export async function verifyDocument(req: Request, res: Response): Promise<void> {
  const doc = found(await prisma.propertyDocument.findFirst({ where: childKey(req, "docId"), include: { property: { select: { id: true, ownerId: true, title: true, code: true } } } }), "Document");
  if (!(await inScope(req, "documents.verify", doc.propertyId))) fail("not-found", REASONS.NOT_FOUND, "Document not found.");
  // Four-eyes rule for staff: nobody verifies a document they uploaded or own — except a Super Admin,
  // who can upload and verify (recorded in the audit trail like any other verification).
  const superAdmin = hasRole(req, "SUPER_ADMIN");
  if (!superAdmin && (doc.property.ownerId === me(req).id || doc.uploadedById === me(req).id)) fail("permission-denied", REASONS.PERMISSION_DENIED, "You cannot verify a document you uploaded or own.");
  if (!doc.needsVerification) fail("failed-precondition", REASONS.INVALID_STATE, "Only ownership documents are verified by SafeRent.");
  const input = parseInput(documentVerifySchema, req.body);
  await withProperty(doc.propertyId, async (tx) => {
    await tx.propertyDocument.update({
      where: { id: doc.id },
      data: { status: input.status, verifiedById: me(req).id, verifiedAt: new Date(), rejectionReason: input.status === "REJECTED" ? input.rejectionReason! : null },
    });
    await audit(tx, req, { propertyId: doc.propertyId, entityType: "DOCUMENT", entityId: doc.id, action: input.status === "APPROVED" ? "document.verify" : "document.reject", oldValue: { status: doc.status }, newValue: { status: input.status, rejectionReason: input.rejectionReason ?? null } });
  });
  await notify(
    doc.property.ownerId,
    `Document ${input.status === "APPROVED" ? "verified" : "rejected"}`,
    `${doc.originalName} for "${doc.property.title ?? doc.property.code}"${input.rejectionReason ? `: ${input.rejectionReason}` : ""}`,
    `/properties/${doc.propertyId}`,
  );
  await evaluateForUser(doc.property.ownerId);
  res.json({ ok: true });
}

/** POST /api/v1/moderation/images/:imageId — approve / reject one photo (listings.approve). */
export async function moderateImage(req: Request, res: Response): Promise<void> {
  const image = found(await prisma.propertyImage.findUnique({ where: { id: String(req.params.imageId) } }), "Image");
  const { decision } = parseInput(z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict(), req.body);
  await withProperty(image.propertyId, async (tx) => {
    await tx.propertyImage.update({ where: { id: image.id }, data: { status: decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: me(req).id } });
    await audit(tx, req, { propertyId: image.propertyId, entityType: "IMAGE", entityId: image.id, action: decision === "APPROVE" ? "image.approve" : "image.reject" });
  });
  res.json({ ok: true });
}
