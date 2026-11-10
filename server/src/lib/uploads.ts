import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import multer from "multer";
import { REASONS, UPLOADS } from "../config/constants";
import { AppError } from "./errors";

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

export const uploadImages = (folder: string) => uploader(folder, UPLOADS.IMAGE_TYPES).array("files", 10);
export const uploadDocument = (folder: string) => uploader(folder, UPLOADS.DOCUMENT_TYPES).single("file");
export const uploadAvatar = uploader("avatars", UPLOADS.IMAGE_TYPES).single("file");

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
