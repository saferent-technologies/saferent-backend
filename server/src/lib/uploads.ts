import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { REASONS, UPLOADS } from "../config/constants";
import { AppError } from "./errors";
import { sniffMime } from "./upload-sniff";
import { allowedMimes, maxUploadBytes, UPLOAD_CEILING_MB } from "../appConfig/schema";
import { appConfig } from "../appConfig/service";

export { sniffMime } from "./upload-sniff";

/**
 * Local file storage under server/uploads (git-ignored). Files are NEVER served statically —
 * every download goes through an API route that checks permissions first.
 * To move to S3/GCS later, replace this module only.
 */
export const UPLOAD_ROOT = path.resolve(process.cwd(), "uploads");

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "video/mp4": ".mp4",
};

function uploader(folder: string, allowed: readonly string[]) {
  const dir = path.join(UPLOAD_ROOT, folder);
  mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXT[file.mimetype] ?? ""}`),
    }),
    // Hard ceiling; the configured limit (Admin → App configuration) is checked after upload.
    limits: { fileSize: UPLOAD_CEILING_MB * 1024 * 1024, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new AppError("invalid-argument", REASONS.INVALID_INPUT, "Unsupported file type."));
    },
  });
}

async function readHead(file: string): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, 12, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const LABEL: Record<string, string> = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WEBP", "application/pdf": "PDF" };

/**
 * Rejects (and deletes) uploads whose content does not match their declared type (e.g. a script
 * renamed to .jpg), and enforces the configured formats and size (Admin → App configuration).
 */
function verifyContent(kind: "image" | "document") {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const files = [...((req.files as Express.Multer.File[] | undefined) ?? []), ...(req.file ? [req.file] : [])];
    const drop = async (message: string) => {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
      next(new AppError("invalid-argument", REASONS.INVALID_INPUT, message));
    };
    for (const file of files) {
      if (sniffMime(await readHead(file.path)) !== file.mimetype) return drop("The file content does not match its type. Upload a real JPG, PNG, WEBP or PDF.");
    }
    if (!files.length) return next();
    const cfg = await appConfig();
    const allowed = allowedMimes(cfg, kind);
    const maxBytes = maxUploadBytes(cfg, kind);
    for (const file of files) {
      if (!allowed.includes(file.mimetype)) return drop(`Allowed formats: ${[...new Set(allowed.map((m) => LABEL[m] ?? m))].join(", ")}.`);
      if (file.size > maxBytes) return drop(`Files can be up to ${Math.round(maxBytes / 1048576)} MB.`);
    }
    next();
  };
}

export const uploadImages = (folder: string, max = 10): RequestHandler[] => [uploader(folder, UPLOADS.IMAGE_TYPES).array("files", max), verifyContent("image")];
export const uploadDocument = (folder: string): RequestHandler[] => [uploader(folder, UPLOADS.DOCUMENT_TYPES).single("file"), verifyContent("document")];
export const uploadAvatar: RequestHandler[] = [uploader("avatars", UPLOADS.IMAGE_TYPES).single("file"), verifyContent("image")];
/** Owner-verification selfies (never public; served only to the owner and reviewers). */
/**
 * ID documents vault: kept in MEMORY only (never written to disk unencrypted), field "files": up to
 * 2 JPG / PNG pages (5 MB each), or 1 PDF (10 MB). The controller checks the bytes, strips EXIF and encrypts.
 */
export const uploadVaultPages: RequestHandler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2 }, // images are held to 5 MB in the controller
  fileFilter: (_req, file, cb) => (["image/jpeg", "image/png", "application/pdf"].includes(file.mimetype) ? cb(null, true) : cb(new AppError("invalid-argument", REASONS.INVALID_INPUT, "Upload JPG or PNG photos, or a PDF, of the document."))),
}).array("files", 2);
/** Announcement picture, multipart field "image". */
export const uploadAnnouncementImage: RequestHandler[] = [uploader("announcements", UPLOADS.IMAGE_TYPES).single("image"), verifyContent("image")];
/** Tenant rent payment proof (screenshot / photo), multipart field "proof". */
export const uploadPaymentProof: RequestHandler[] = [uploader("payment-proofs", UPLOADS.IMAGE_TYPES).single("proof"), verifyContent("image")];
export const uploadSelfie: RequestHandler[] = [uploader("kyc", UPLOADS.IMAGE_TYPES).single("file"), verifyContent("image")];

/**
 * Storage driver used by controllers. Today: local disk under server/uploads. To move to Firebase
 * Storage / S3, implement this interface and switch `storage` — controllers do not change.
 */
export interface FileStorage {
  /** Storage key for a file multer just received. */
  keyFor(file: Express.Multer.File): string;
  /** Streams a file AFTER the caller has authorized access. */
  send(res: Response, key: string, mimeType: string, downloadName?: string): void;
  remove(key: string): Promise<void>;
}

export const storage: FileStorage = {
  keyFor: (file) => relativePath(file.path),
  send: (res, key, mimeType, downloadName) => sendStoredFile(res, key, mimeType, downloadName),
  remove: (key) => removeStoredFile(key),
};

/** Deletes freshly uploaded files when the request fails authorization or validation. */
export async function discardUploads(req: Request): Promise<void> {
  const files = [...((req.files as Express.Multer.File[] | undefined) ?? []), ...(req.file ? [req.file] : [])];
  await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
}

/** Stored path relative to UPLOAD_ROOT, e.g. "property-images/abc.jpg". */
export function relativePath(absolute: string): string {
  return path.relative(UPLOAD_ROOT, absolute).split(path.sep).join("/");
}

/** Streams a stored file after the caller has authorized access. Prevents path traversal. */
export function sendStoredFile(res: Response, relative: string, mimeType: string, downloadName?: string): void {
  const absolute = path.resolve(UPLOAD_ROOT, relative);
  if (!absolute.startsWith(UPLOAD_ROOT + path.sep)) throw new AppError("not-found", REASONS.NOT_FOUND, "File not found.");
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (downloadName) res.setHeader("Content-Disposition", `attachment; filename="${downloadName.replace(/[^\w.-]/g, "_")}"`);
  res.sendFile(absolute, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: { reason: REASONS.NOT_FOUND, message: "File not found." } });
  });
}

export async function removeStoredFile(relative: string): Promise<void> {
  const absolute = path.resolve(UPLOAD_ROOT, relative);
  if (absolute.startsWith(UPLOAD_ROOT + path.sep)) await unlink(absolute).catch(() => undefined);
}

/**
 * Video tour upload: field "file" (video/mp4, ≤ 40 MB) + optional "thumbnail" (JPG / PNG / WEBP, ≤ 5 MB).
 * The controller checks the MP4 itself (real MP4, ≤ 60 s) and the thumbnail bytes.
 */
export const VIDEO_MAX_BYTES = 40 * 1024 * 1024;
export const uploadVideo: RequestHandler = (() => {
  const dir = path.join(UPLOAD_ROOT, "property-videos");
  mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({ destination: dir, filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXT[file.mimetype] ?? ""}`) }),
    limits: { fileSize: VIDEO_MAX_BYTES, files: 2 },
    fileFilter: (_req, file, cb) => {
      if (file.fieldname === "file" && file.mimetype === "video/mp4") cb(null, true);
      else if (file.fieldname === "thumbnail" && (UPLOADS.IMAGE_TYPES as readonly string[]).includes(file.mimetype)) cb(null, true);
      else cb(new AppError("invalid-argument", REASONS.INVALID_INPUT, file.fieldname === "file" ? "Upload an MP4 video." : "The thumbnail must be a JPG, PNG or WEBP image."));
    },
  }).fields([
    { name: "file", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]);
})();

/**
 * Maintenance request media, multipart "files" (≤ 10): photos (JPG / PNG / WEBP ≤ 10 MB), MP4 videos
 * (≤ 40 MB, at most 2), and — when `withPdf` — PDF invoices / receipts (≤ 10 MB). Bytes are checked.
 */
export function uploadMaintenanceMedia(withPdf = false): RequestHandler[] {
  const dir = path.join(UPLOAD_ROOT, "maintenance-photos");
  mkdirSync(dir, { recursive: true });
  const allowed: string[] = [...UPLOADS.IMAGE_TYPES, "video/mp4", ...(withPdf ? ["application/pdf"] : [])];
  const receive = multer({
    storage: multer.diskStorage({ destination: dir, filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXT[file.mimetype] ?? ""}`) }),
    limits: { fileSize: VIDEO_MAX_BYTES, files: 10 },
    fileFilter: (_req, file, cb) => (allowed.includes(file.mimetype) ? cb(null, true) : cb(new AppError("invalid-argument", REASONS.INVALID_INPUT, withPdf ? "Upload photos (JPG, PNG, WEBP), MP4 videos or PDF files." : "Upload photos (JPG, PNG, WEBP) or MP4 videos."))),
  }).array("files", 10);
  const check = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const drop = async (message: string) => {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
      next(new AppError("invalid-argument", REASONS.INVALID_INPUT, message));
    };
    let videos = 0;
    for (const f of files) {
      const head = await readHead(f.path);
      if (f.mimetype === "video/mp4") {
        videos++;
        // ISO-BMFF: bytes 4..7 = "ftyp".
        if (!(head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70)) return drop("That video isn't a real MP4. Record or export it as MP4.");
      } else {
        if (sniffMime(head) !== f.mimetype) return drop("The file content does not match its type.");
        if (f.size > 10 * 1024 * 1024) return drop("Photos and PDFs can be up to 10 MB.");
      }
    }
    if (videos > 2) return drop("Add at most 2 videos at a time.");
    next();
  };
  return [receive, check];
}
