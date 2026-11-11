import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { REASONS, UPLOADS } from "../config/constants";
import { AppError } from "./errors";
import { sniffMime } from "./upload-sniff";

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
};

function uploader(folder: string, allowed: readonly string[]) {
  const dir = path.join(UPLOAD_ROOT, folder);
  mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXT[file.mimetype] ?? ""}`),
    }),
    limits: { fileSize: UPLOADS.MAX_BYTES, files: 10 },
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

/** Rejects (and deletes) uploads whose content does not match their declared type, e.g. a script renamed to .jpg. */
async function verifyContent(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const files = [...((req.files as Express.Multer.File[] | undefined) ?? []), ...(req.file ? [req.file] : [])];
  const bad: Express.Multer.File[] = [];
  for (const file of files) {
    if (sniffMime(await readHead(file.path)) !== file.mimetype) bad.push(file);
  }
  if (bad.length) {
    await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
    return next(new AppError("invalid-argument", REASONS.INVALID_INPUT, "The file content does not match its type. Upload a real JPG, PNG, WEBP or PDF."));
  }
  next();
}

export const uploadImages = (folder: string, max = 10): RequestHandler[] => [uploader(folder, UPLOADS.IMAGE_TYPES).array("files", max), verifyContent];
export const uploadDocument = (folder: string): RequestHandler[] => [uploader(folder, UPLOADS.DOCUMENT_TYPES).single("file"), verifyContent];
export const uploadAvatar: RequestHandler[] = [uploader("avatars", UPLOADS.IMAGE_TYPES).single("file"), verifyContent];
/** Owner-verification selfies (never public; served only to the owner and reviewers). */
export const uploadSelfie: RequestHandler[] = [uploader("kyc", UPLOADS.IMAGE_TYPES).single("file"), verifyContent];

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
