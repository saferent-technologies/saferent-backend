import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ASSET_MIME_BY_EXT, ASSET_TYPES, assetProblem } from "../appConfig/assetCheck";
import { REASONS } from "../config/constants";
import { logActivity } from "../lib/activity";
import { AppError, fail } from "../lib/errors";
import { sendStoredFile, UPLOAD_ROOT } from "../lib/uploads";

/*
 * App assets: files a Super Admin uploads in Admin → App configuration (splash logo, Lottie loading
 * animation, onboarding images / videos / animations). They are public by nature — the app shows them
 * before anyone signs in — so they are served without login, with long caching (names never repeat).
 */

const FOLDER = "app-assets";
const DIR = path.join(UPLOAD_ROOT, FOLDER);
mkdirSync(DIR, { recursive: true });

/** Browsers send .json as application/json, sometimes text/plain or nothing — treated as JSON by extension. */
function normalizedMime(file: Express.Multer.File): string {
  if (file.mimetype === "application/json") return file.mimetype;
  if (/\.json$/i.test(file.originalname) && ["text/plain", "application/octet-stream", ""].includes(file.mimetype)) return "application/json";
  return file.mimetype;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: DIR,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${ASSET_TYPES[normalizedMime(file)]?.ext ?? "bin"}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ASSET_TYPES[normalizedMime(file)]) cb(null, true);
    else cb(new AppError("invalid-argument", REASONS.INVALID_INPUT, "Upload a PNG, JPG or WEBP image, an MP4 video or a Lottie JSON file (SVG isn't supported)."));
  },
}).single("file");

async function head(file: string): Promise<Uint8Array> {
  const h = await open(file, "r");
  try {
    const b = Buffer.alloc(12);
    const { bytesRead } = await h.read(b, 0, 12, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await h.close();
  }
}

/** Multer + content check (a renamed script never gets stored). */
export function receiveAppAsset(req: Request, res: Response, next: NextFunction): void {
  upload(req, res, async (err?: unknown) => {
    if (err) return next(err instanceof AppError ? err : new AppError("invalid-argument", REASONS.INVALID_INPUT, (err as Error).message || "Upload failed."));
    const file = req.file;
    if (!file) return next(new AppError("invalid-argument", REASONS.INVALID_INPUT, "Choose a file to upload."));
    try {
      const mime = normalizedMime(file);
      const isText = ASSET_TYPES[mime]?.kind === "LOTTIE";
      const text = isText && file.size <= ASSET_TYPES[mime].maxBytes ? await readFile(file.path, "utf8") : undefined;
      const problem = assetProblem(mime, file.size, await head(file.path), text);
      if (problem) {
        await unlink(file.path).catch(() => undefined);
        return next(new AppError("invalid-argument", REASONS.INVALID_INPUT, problem));
      }
      next();
    } catch (e) {
      await unlink(file.path).catch(() => undefined);
      next(e);
    }
  });
}

/** POST /api/v1/admin/app-config/assets — multipart "file". Returns the path to put in the config. */
export async function uploadAppAsset(req: Request, res: Response): Promise<void> {
  const file = req.file!;
  const mime = normalizedMime(file);
  const name = path.basename(file.path);
  await logActivity(req, "app_config.asset_upload", "app_asset", name, { kind: ASSET_TYPES[mime].kind, sizeBytes: file.size, originalName: file.originalname.slice(0, 120) });
  res.status(201).json({ url: `/api/v1/app/assets/${name}`, kind: ASSET_TYPES[mime].kind, mimeType: mime, sizeBytes: file.size });
}

/** GET /api/v1/app/assets/:file — public, cacheable. Only names this module generates are served. */
export function serveAppAsset(req: Request, res: Response): void {
  const m = /^([0-9a-f-]{36})\.(png|jpg|webp|mp4|json)$/.exec(String(req.params.file));
  if (!m) fail("not-found", REASONS.NOT_FOUND, "File not found.");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  sendStoredFile(res, `${FOLDER}/${m[0]}`, ASSET_MIME_BY_EXT[m[2]]);
  // After sendStoredFile set its private default: these files are public and never change.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
}
