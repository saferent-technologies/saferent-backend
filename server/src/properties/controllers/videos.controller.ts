import { open, unlink } from "node:fs/promises";
import { makeVideoThumbnail } from "../../lib/videoThumb";
import type { PropertyVideo } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { mp4Info } from "../../lib/mp4Info";
import { notifyStaff } from "../../lib/notifyStaff";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { relativePath, sniffMime, storage } from "../../lib/uploads";
import { parseInput } from "../../lib/validation";
import { can, me } from "../../middleware/auth";
import { audit, inScope, isModerator, scopedProperty } from "../service";

/*
 * Video tours. MP4 only, at most 60 s and 40 MB, one per place: the building, a unit (flat) or a room.
 * A new upload for the same place replaces the old video. Videos belong to the LIVE property (not the
 * change-request copy) and are moderated: PENDING → APPROVED / REJECTED (moderators' own uploads are
 * approved straight away). Tenants and the public only ever see APPROVED videos of live listings.
 * Files are served through API routes with HTTP Range support (express sendFile) for streaming.
 */

const MAX_SECONDS = 60;
const THUMB_MAX_BYTES = 5 * 1024 * 1024;

type Files = { file?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] };
const filesOf = (req: Request): Files => (req.files && !Array.isArray(req.files) ? (req.files as Files) : {});

async function dropUploads(req: Request) {
  const f = filesOf(req);
  await Promise.all([...(f.file ?? []), ...(f.thumbnail ?? [])].map((x) => unlink(x.path).catch(() => undefined)));
}

async function head(file: string): Promise<Uint8Array> {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(12);
    const { bytesRead } = await fh.read(b, 0, 12, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** URLs: signed-in (any role, checked per request) and public (approved videos of live listings). */
export const videoUrl = (id: string) => `/api/v1/files/property-videos/${id}`;
export const videoThumbUrl = (id: string) => `/api/v1/files/property-videos/${id}/thumbnail`;
export const publicVideoUrl = (id: string) => `/api/v1/public/videos/${id}`;
export const publicVideoThumbUrl = (id: string) => `/api/v1/public/videos/${id}/thumbnail`;

export function presentVideo(v: PropertyVideo, pub = false) {
  return {
    id: v.id,
    url: pub ? publicVideoUrl(v.id) : videoUrl(v.id),
    thumbnailUrl: v.thumbnailPath ? (pub ? publicVideoThumbUrl(v.id) : videoThumbUrl(v.id)) : null,
    durationSec: v.durationSec,
    status: v.status,
    unitId: v.unitId,
    roomId: v.roomId,
    ...(pub ? {} : { rejectionReason: v.rejectionReason, createdAt: v.createdAt }),
  };
}

/** Videos for a property view. `approvedOnly` for tenants / public. Draft unit / room ids are mapped by the caller. */
/**
 * Videos of a LIVE property for one view of it. A video's unitId / roomId is stored as the wizard sent it
 * (the live row's id, or the id of its copy in an open change request). `view`:
 *   "live"  → ids shown as live ids (a copy's id is shown as its live source),
 *   "draft" → ids shown as the change request's copy ids (what the wizard has on screen).
 * Always an array.
 */
export async function videosFor(propertyId: string, approvedOnly: boolean, pub = false, view: "live" | "draft" = "live") {
  const rows = await prisma.propertyVideo.findMany({ where: { propertyId, ...(approvedOnly ? { status: "APPROVED" } : {}) }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return [];
  const draft = await prisma.property.findFirst({ where: { revisionOfId: propertyId }, select: { id: true } });
  const [units, rooms] = draft
    ? await Promise.all([
        prisma.propertyUnit.findMany({ where: { propertyId: draft.id, sourceId: { not: null } }, select: { id: true, sourceId: true } }),
        prisma.propertyRoom.findMany({ where: { propertyId: draft.id, sourceId: { not: null } }, select: { id: true, sourceId: true } }),
      ])
    : [[], []];
  const toLive = new Map([...units, ...rooms].map((x) => [x.id, x.sourceId!]));
  const toDraft = new Map([...units, ...rooms].map((x) => [x.sourceId!, x.id]));
  const map = (id: string | null) => (id ? (view === "draft" ? (toDraft.get(id) ?? id) : (toLive.get(id) ?? id)) : null);
  return rows.map((v) => ({ ...presentVideo(v, pub), unitId: map(v.unitId), roomId: map(v.roomId) }));
}

/**
 * Flats (active units) of the property as shown in `viewPropertyId` (the property, or its change-request
 * copy) that have no video waiting for review or approved. Returns the ids as in that view.
 */
export async function flatsWithoutVideo(liveId: string, viewPropertyId: string): Promise<string[]> {
  const units = await prisma.propertyUnit.findMany({ where: { propertyId: viewPropertyId, activeStatus: "ACTIVE" }, select: { id: true, sourceId: true } });
  if (!units.length) return [];
  const videos = await prisma.propertyVideo.findMany({ where: { propertyId: liveId, status: { in: ["PENDING", "APPROVED"] }, slotKey: { startsWith: "UNIT:" } }, select: { slotKey: true } });
  const covered = new Set(videos.map((v) => v.slotKey.slice(5)));
  return units.filter((u) => !covered.has(u.sourceId ?? u.id)).map((u) => u.id);
}

const uploadSchema = z.object({
  unitId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  roomId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  durationSec: z.coerce.number().positive().max(600).optional(),
});

/**
 * The place a video is for. unitId / roomId are kept EXACTLY as sent; they must belong to this property
 * (the live listing, or its open change-request copy), else 400. The slot (one video per place) uses the
 * live id when the sent id is a copy, so a flat never gets two videos.
 */
async function livePlace(propertyId: string, unitId?: string, roomId?: string) {
  if (unitId && roomId) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a flat or a room, not both.");
  const draft = await prisma.property.findFirst({ where: { revisionOfId: propertyId }, select: { id: true } });
  const owners = [propertyId, ...(draft ? [draft.id] : [])];
  if (unitId) {
    const u = await prisma.propertyUnit.findUnique({ where: { id: unitId }, select: { id: true, propertyId: true, sourceId: true } });
    if (!u || !owners.includes(u.propertyId)) fail("invalid-argument", REASONS.INVALID_INPUT, "This flat isn't part of this property.");
    return { unitId: u.id, roomId: null, slotKey: `UNIT:${u.propertyId === propertyId ? u.id : (u.sourceId ?? u.id)}` };
  }
  if (roomId) {
    const r = await prisma.propertyRoom.findUnique({ where: { id: roomId }, select: { id: true, propertyId: true, sourceId: true } });
    if (!r || !owners.includes(r.propertyId)) fail("invalid-argument", REASONS.INVALID_INPUT, "This room isn't part of this property.");
    return { unitId: null, roomId: r.id, slotKey: `ROOM:${r.propertyId === propertyId ? r.id : (r.sourceId ?? r.id)}` };
  }
  return { unitId: null, roomId: null, slotKey: "BUILDING" };
}

/** POST /api/v1/properties/:propertyId/videos — multipart file (mp4) [+ thumbnail, unitId | roomId, durationSec]. */
export async function uploadVideo(req: Request, res: Response): Promise<void> {
  try {
    const property = await scopedProperty(req, "properties.manage");
    if (property.revisionOfId) fail("invalid-argument", REASONS.INVALID_INPUT, "Upload videos to the listing itself.");
    const { file: [video] = [], thumbnail: [thumb] = [] } = filesOf(req);
    if (!video) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose an MP4 video (field \"file\").");
    const input = parseInput(uploadSchema, req.body ?? {});
    const info = await mp4Info(video.path);
    if (!info) fail("invalid-argument", REASONS.INVALID_INPUT, "This isn't a playable MP4 video. Record or export it as MP4 (H.264).");
    // The file's own duration decides; the app's durationSec is only a fallback hint.
    const seconds = Math.round(info.durationSec || input.durationSec || 0);
    if (seconds < 1) fail("invalid-argument", REASONS.INVALID_INPUT, "The video is empty.");
    if (seconds > MAX_SECONDS) fail("invalid-argument", REASONS.INVALID_INPUT, `Videos can be up to ${MAX_SECONDS} seconds. This one is ${seconds} seconds.`);
    if (thumb) {
      if (thumb.size > THUMB_MAX_BYTES) fail("invalid-argument", REASONS.INVALID_INPUT, "The thumbnail can be up to 5 MB.");
      if (sniffMime(await head(thumb.path)) !== thumb.mimetype) fail("invalid-argument", REASONS.INVALID_INPUT, "The thumbnail isn't a real JPG, PNG or WEBP image.");
    }
    const place = await livePlace(property.id, input.unitId, input.roomId);
    const moderator = isModerator(req);
    const user = me(req);
    const old = await prisma.propertyVideo.findUnique({ where: { propertyId_slotKey: { propertyId: property.id, slotKey: place.slotKey } } });
    // No thumbnail from the app → make one from the video (frame at ~1 s).
    const generated = thumb ? null : await makeVideoThumbnail(video.path, seconds);
    const data = {
      ...place,
      filePath: relativePath(video.path),
      mimeType: "video/mp4",
      sizeBytes: video.size,
      durationSec: seconds,
      thumbnailPath: thumb ? relativePath(thumb.path) : generated ? relativePath(generated) : null,
      thumbnailMime: thumb ? thumb.mimetype : generated ? "image/jpeg" : null,
      status: moderator ? ("APPROVED" as const) : ("PENDING" as const),
      rejectionReason: null,
      uploadedById: user.id,
      reviewedById: moderator ? user.id : null,
      reviewedAt: moderator ? new Date() : null,
    };
    const saved = await prisma.$transaction(async (tx) => {
      const v = old ? await tx.propertyVideo.update({ where: { id: old.id }, data }) : await tx.propertyVideo.create({ data: { ...data, propertyId: property.id } });
      await audit(tx, req, { propertyId: property.id, entityType: "VIDEO", entityId: v.id, action: old ? "video.replace" : "video.upload", newValue: { slotKey: place.slotKey, durationSec: seconds } });
      return v;
    });
    // The replaced video's files go once the new one is saved.
    if (old) {
      await storage.remove(old.filePath);
      if (old.thumbnailPath) await storage.remove(old.thumbnailPath);
    }
    if (!moderator) await notifyStaff("listings.approve", "Video tour to review", `A new video tour was uploaded for ${property.title ?? property.code}.`, "/moderation", user.id);
    res.locals.message = moderator ? "Video added" : "Video uploaded. It shows on the listing after SafeRent reviews it.";
    res.status(201).json({ video: presentVideo(saved) });
  } catch (err) {
    await dropUploads(req);
    throw err;
  }
}

/** DELETE /api/v1/properties/:propertyId/videos/:videoId */
export async function deleteVideo(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const liveId = property.revisionOfId ?? property.id;
  const v = found(await prisma.propertyVideo.findFirst({ where: { id: String(req.params.videoId), propertyId: liveId } }), "Video");
  await prisma.$transaction(async (tx) => {
    await tx.propertyVideo.delete({ where: { id: v.id } });
    await audit(tx, req, { propertyId: liveId, entityType: "VIDEO", entityId: v.id, action: "video.delete", oldValue: { slotKey: v.slotKey } });
  });
  await storage.remove(v.filePath);
  if (v.thumbnailPath) await storage.remove(v.thumbnailPath);
  res.locals.message = "Video deleted";
  res.json({ ok: true });
}

/** Can this signed-in user see the video? Approved + live listing (browsing), the property's people, moderators. */
async function canSee(req: Request, v: PropertyVideo & { property: { publicationStatus: string; activeStatus: string } }) {
  const isPublic = v.status === "APPROVED" && v.property.publicationStatus === "PUBLISHED" && v.property.activeStatus === "ACTIVE" && can(req, "properties.browse");
  return isPublic || isModerator(req) || (await inScope(req, "properties.view", v.propertyId));
}

const withProperty = { property: { select: { publicationStatus: true, activeStatus: true } } } as const;

/** GET /api/v1/files/property-videos/:videoId (Range requests supported). */
export async function getVideoFile(req: Request, res: Response): Promise<void> {
  const v = found(await prisma.propertyVideo.findUnique({ where: { id: String(req.params.videoId) }, include: withProperty }), "Video");
  if (!(await canSee(req, v))) fail("not-found", REASONS.NOT_FOUND, "Video not found.");
  storage.send(res, v.filePath, v.mimeType);
}

/** GET /api/v1/files/property-videos/:videoId/thumbnail */
export async function getVideoThumbnail(req: Request, res: Response): Promise<void> {
  const v = found(await prisma.propertyVideo.findUnique({ where: { id: String(req.params.videoId) }, include: withProperty }), "Video");
  if (!v.thumbnailPath || !(await canSee(req, v))) fail("not-found", REASONS.NOT_FOUND, "Thumbnail not found.");
  storage.send(res, v.thumbnailPath, v.thumbnailMime ?? "image/jpeg");
}

async function publicVideo(req: Request) {
  const v = await prisma.propertyVideo.findUnique({ where: { id: String(req.params.videoId) }, include: withProperty });
  if (!v || v.status !== "APPROVED" || v.property.publicationStatus !== "PUBLISHED" || v.property.activeStatus !== "ACTIVE") fail("not-found", REASONS.NOT_FOUND, "Video not found.");
  return v;
}

/** GET /api/v1/public/videos/:videoId — approved video of a live listing, no sign-in (Range supported). */
export async function getPublicVideo(req: Request, res: Response): Promise<void> {
  const v = await publicVideo(req);
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  storage.send(res, v.filePath, v.mimeType);
}

/** GET /api/v1/public/videos/:videoId/thumbnail */
export async function getPublicVideoThumbnail(req: Request, res: Response): Promise<void> {
  const v = await publicVideo(req);
  if (!v.thumbnailPath) fail("not-found", REASONS.NOT_FOUND, "Thumbnail not found.");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  storage.send(res, v.thumbnailPath, v.thumbnailMime ?? "image/jpeg");
}

/* ─────────────── Moderation ─────────────── */

/** GET /api/v1/moderation/videos?status=PENDING — videos waiting for review (newest last). */
export async function listVideosForModeration(req: Request, res: Response): Promise<void> {
  const status = req.query.status === "APPROVED" || req.query.status === "REJECTED" ? req.query.status : "PENDING";
  const rows = await prisma.propertyVideo.findMany({
    where: { status },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: { property: { select: { id: true, code: true, title: true, city: true } } },
  });
  res.json({ items: rows.map((v) => ({ ...presentVideo(v), property: v.property })) });
}

const moderateSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().min(5).max(500).optional() })
  .strict()
  .refine((v) => v.decision === "APPROVE" || !!v.reason, { message: "Tell the owner why (at least 5 characters).", path: ["reason"] });

/** POST /api/v1/moderation/videos/:videoId { decision: APPROVE | REJECT, reason? } */
export async function moderateVideo(req: Request, res: Response): Promise<void> {
  const v = found(await prisma.propertyVideo.findUnique({ where: { id: String(req.params.videoId) }, include: { property: { select: { ownerId: true, title: true, code: true } } } }), "Video");
  const { decision, reason } = parseInput(moderateSchema, req.body);
  const approve = decision === "APPROVE";
  await prisma.$transaction(async (tx) => {
    await tx.propertyVideo.update({ where: { id: v.id }, data: { status: approve ? "APPROVED" : "REJECTED", rejectionReason: approve ? null : reason!, reviewedById: me(req).id, reviewedAt: new Date() } });
    await audit(tx, req, { propertyId: v.propertyId, entityType: "VIDEO", entityId: v.id, action: approve ? "video.approve" : "video.reject", newValue: approve ? undefined : { reason } });
  });
  const name = v.property.title ?? v.property.code;
  await notify(
    v.property.ownerId,
    approve ? "Video tour is live" : "Video tour needs changes",
    approve ? `Your video tour for "${name}" is now on the listing.` : `Your video tour for "${name}" wasn't approved: ${reason}`,
    `/properties/${v.propertyId}`,
    undefined,
    { type: "PROPERTY_VIDEO", propertyId: v.propertyId, videoId: v.id },
  );
  res.json({ ok: true });
}
