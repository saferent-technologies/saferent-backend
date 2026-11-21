import { randomUUID, type X509Certificate } from "node:crypto";
import { mkdirSync } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { KycTutorial } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { env } from "../config/env";
import { REASONS } from "../config/constants";
import { aadhaarOfflineAvailable, ensureUidaiCerts, parseCertificates, reloadUploadedUidaiCerts, serverFileCertificates } from "../lib/aadhaarOffline";
import { logActivity } from "../lib/activity";
import { AppError, fail } from "../lib/errors";
import { found } from "../lib/http";
import { ID_TYPES, idTypeConfigured, idTypesFor, type IdType, type IdTypeConfig } from "../lib/idTypes";
import { ID_TYPE_KEY, TUTORIAL_MAX_BYTES, TUTORIAL_TYPES, tutorialFileProblem, tutorialTitleProblem, tutorialUrlProblem, type TutorialType } from "../lib/kycTutorials";
import { prisma } from "../lib/prisma";
import { publicApiUrl } from "../lib/publicUrl";
import { relativePath, sniffMime, storage, UPLOAD_ROOT } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { hasRole, me } from "../middleware/auth";

/*
 * Owner verification settings, Super Admin only:
 *   - ID types on / off (one pipeline with the server configuration: offered = configured AND on)
 *   - Guides for the app (video / PDF / image), uploaded here (served from a public URL) or a direct
 *     https file link. GET /kyc/me returns the active ones in display order.
 * Logs carry ids, types and counts only (never file URLs).
 */

function requireSuperAdmin(req: Request): void {
  if (!hasRole(req, "SUPER_ADMIN")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only a Super Admin can change owner verification settings.");
}

/** Route guard so uploads from anyone else are refused before the file is received. */
export function superAdminOnly(req: Request, _res: Response, next: NextFunction): void {
  try {
    requireSuperAdmin(req);
    next();
  } catch (err) {
    next(err);
  }
}

/* ─────────────── ID types pipeline ─────────────── */

async function disabledTypes(): Promise<string[]> {
  return (await prisma.kycIdTypeSetting.findMany({ where: { enabled: false }, select: { type: true } })).map((r) => r.type);
}

async function idTypeConfig(): Promise<IdTypeConfig> {
  await ensureUidaiCerts();
  return { aadhaarOffline: aadhaarOfflineAvailable(), eAadhaarPdf: false, manualReview: env.KYC_MANUAL_ID_REVIEW, disabled: await disabledTypes() };
}

/** The single source for what the app offers and what POST /kyc/identity accepts. */
export async function availableIdTypes(): Promise<IdType[]> {
  return idTypesFor(await idTypeConfig());
}

const ID_LABEL: Record<IdType, string> = { AADHAAR_XML: "Aadhaar offline eKYC (ZIP)", EAADHAAR_PDF: "e-Aadhaar PDF", PAN: "PAN card", PASSPORT: "Passport" };
const NOT_CONFIGURED: Record<IdType, string> = {
  AADHAAR_XML: "Upload UIDAI's Offline e-KYC public key certificate (below) to turn this on.",
  EAADHAAR_PDF: "e-Aadhaar PDF checking isn't built yet.",
  PAN: "Staff review is off (KYC_MANUAL_ID_REVIEW=false).",
  PASSPORT: "Staff review is off (KYC_MANUAL_ID_REVIEW=false).",
};

async function idTypeRows() {
  const c = await idTypeConfig();
  return ID_TYPES.map((type) => {
    const configured = idTypeConfigured(type, c);
    const enabled = !(c.disabled ?? []).includes(type);
    return { type, label: ID_LABEL[type], enabled, configured, available: configured && enabled, reason: configured ? null : NOT_CONFIGURED[type] };
  });
}

/** UIDAI certificates in use: uploaded here (can be deleted) and the server file (read only). */
async function uidaiCertRows() {
  const fromFile = serverFileCertificates().map((c) => ({ id: null, source: "SERVER_FILE" as const, ...certInfo(c) }));
  const uploaded = await prisma.uidaiCertificate.findMany({ orderBy: { validTo: "desc" } });
  return [
    ...uploaded.map((u) => ({ id: u.id, source: "UPLOADED" as const, subject: u.subject, fingerprint: u.fingerprint, validFrom: u.validFrom, validTo: u.validTo, expired: u.validTo < new Date(), uploadedAt: u.createdAt })),
    ...fromFile,
  ];
}

function certInfo(c: X509Certificate) {
  const validTo = new Date(c.validTo);
  return { subject: subjectName(c), fingerprint: c.fingerprint256, validFrom: new Date(c.validFrom), validTo, expired: validTo < new Date() };
}

/** "DS Unique Identification Authority of India 06" (CN), else the organisation. */
function subjectName(c: X509Certificate): string {
  const cn = /CN=([^\n]+)/.exec(c.subject)?.[1];
  const o = /O=([^\n]+)/.exec(c.subject)?.[1];
  return (cn ?? o ?? c.subject).slice(0, 300);
}

/** GET /api/v1/admin/kyc-settings → { idTypes: [...], uidaiCertificates: [...] } */
export async function getKycSettings(req: Request, res: Response): Promise<void> {
  requireSuperAdmin(req);
  res.json({ idTypes: await idTypeRows(), uidaiCertificates: await uidaiCertRows() });
}

/** Multipart "file" (.cer / .crt / .pem, ≤ 64 KB), kept in memory. */
export const uploadCertificateFile = (req: Request, res: Response, next: NextFunction) =>
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024, files: 1 } }).single("file")(req, res, (err?: unknown) => {
    if ((err as { code?: string } | undefined)?.code === "LIMIT_FILE_SIZE") return next(new AppError("invalid-argument", REASONS.INVALID_INPUT, "That isn't a certificate file (too large)."));
    next(err);
  });

/**
 * POST /api/v1/admin/kyc-settings/uidai-certificates — multipart "file" (the .cer from UIDAI's website),
 * or JSON { pem }. Must be a certificate issued to UIDAI and not expired. Turns Aadhaar offline eKYC on.
 */
export async function addUidaiCertificate(req: Request, res: Response): Promise<void> {
  requireSuperAdmin(req);
  const raw = req.file?.buffer ?? (typeof req.body?.pem === "string" ? Buffer.from(req.body.pem, "latin1") : null);
  if (!raw?.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose the certificate file (.cer) you downloaded from the UIDAI website.");
  let certs: X509Certificate[];
  try {
    certs = parseCertificates(raw);
  } catch {
    fail("unprocessable", REASONS.INVALID_FILE, "This isn't a certificate file. Download the .cer from the UIDAI website (Offline e-KYC public key certificates).");
  }
  const user = me(req);
  const added: string[] = [];
  for (const c of certs) {
    if (!/UNIQUE IDENTIFICATION AUTHORITY OF INDIA|UIDAI/i.test(c.subject)) fail("unprocessable", REASONS.INVALID_FILE, "This certificate isn't issued to UIDAI. Use the Offline e-KYC public key certificate from uidai.gov.in.");
    const info = certInfo(c);
    if (info.expired) fail("unprocessable", REASONS.INVALID_FILE, `This certificate expired on ${info.validTo.toDateString()}. Download the latest one from the UIDAI website.`);
    const exists = await prisma.uidaiCertificate.findUnique({ where: { fingerprint: info.fingerprint } });
    if (exists) continue;
    const row = await prisma.uidaiCertificate.create({ data: { pem: c.toString(), fingerprint: info.fingerprint, subject: info.subject, validFrom: info.validFrom, validTo: info.validTo, uploadedById: user.id } });
    added.push(row.id);
  }
  await reloadUploadedUidaiCerts();
  await logActivity(req, "kyc.uidai_cert_add", "uidai_certificate", added[0] ?? null, { added: added.length });
  res.locals.message = added.length ? "Certificate added. Aadhaar offline eKYC can be checked now." : "This certificate is already added.";
  res.status(added.length ? 201 : 200).json({ idTypes: await idTypeRows(), uidaiCertificates: await uidaiCertRows() });
}

/** DELETE /api/v1/admin/kyc-settings/uidai-certificates/:id — remove an uploaded certificate. */
export async function deleteUidaiCertificate(req: Request, res: Response): Promise<void> {
  requireSuperAdmin(req);
  const row = found(await prisma.uidaiCertificate.findUnique({ where: { id: String(req.params.id) } }), "Certificate");
  await prisma.uidaiCertificate.delete({ where: { id: row.id } });
  await reloadUploadedUidaiCerts();
  await logActivity(req, "kyc.uidai_cert_delete", "uidai_certificate", row.id, {});
  res.locals.message = "Certificate removed";
  res.json({ idTypes: await idTypeRows(), uidaiCertificates: await uidaiCertRows() });
}

const settingsSchema = z.object({ idTypes: z.record(z.enum(ID_TYPES), z.boolean()) }).strict();

/** PUT /api/v1/admin/kyc-settings { idTypes: { AADHAAR_XML: true, PAN: false, … } } */
export async function putKycSettings(req: Request, res: Response): Promise<void> {
  requireSuperAdmin(req);
  const { idTypes } = parseInput(settingsSchema, req.body);
  const user = me(req);
  for (const [type, enabled] of Object.entries(idTypes)) {
    await prisma.kycIdTypeSetting.upsert({ where: { type }, create: { type, enabled, updatedById: user.id }, update: { enabled, updatedById: user.id } });
  }
  await logActivity(req, "kyc.settings", "kyc_settings", null, { idTypes });
  res.locals.message = "Saved";
  res.json({ idTypes: await idTypeRows() });
}

/* ─────────────── Tutorials ─────────────── */

const fileUrl = (id: string) => publicApiUrl(`/api/v1/public/kyc-tutorials/${id}/file`);

function presentTutorial(t: KycTutorial, admin = false) {
  return {
    id: t.id,
    idType: t.idType,
    title: t.title,
    description: t.description ?? null,
    type: t.type as TutorialType,
    url: t.filePath ? fileUrl(t.id) : t.externalUrl!,
    ...(admin ? { order: t.order, active: t.active, uploaded: !!t.filePath, sizeBytes: t.sizeBytes, createdAt: t.createdAt, updatedAt: t.updatedAt } : {}),
  };
}

/**
 * GET /api/v1/kyc/tutorials — any signed-in user: active guides in display order ([] when none).
 * A guide for a new ID type shows in the app as soon as staff add it (no app update).
 */
export async function myTutorials(_req: Request, res: Response): Promise<void> {
  const rows = await prisma.kycTutorial.findMany({ where: { active: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  res.setHeader("Cache-Control", "no-store, private");
  res.json({ tutorials: rows.map((t) => presentTutorial(t)) });
}

/** Multipart "file" (≤ 50 MB on the wire; each type's own limit is checked after). */
export const uploadTutorialFile = (req: Request, res: Response, next: NextFunction) => {
  const dir = path.join(UPLOAD_ROOT, "kyc-tutorials");
  mkdirSync(dir, { recursive: true });
  multer({
    storage: multer.diskStorage({ destination: dir, filename: (_r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6)}`) }),
    limits: { fileSize: TUTORIAL_MAX_BYTES.VIDEO, files: 1, fields: 10 },
  }).single("file")(req, res, (err?: unknown) => {
    if ((err as { code?: string } | undefined)?.code === "LIMIT_FILE_SIZE") return next(new AppError("invalid-argument", REASONS.INVALID_INPUT, "Files can be up to 50 MB (videos), 30 MB (PDFs) or 5 MB (images)."));
    next(err);
  });
};

async function readHead(file: string, n = 16): Promise<Buffer> {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(n);
    const { bytesRead } = await fh.read(b, 0, n, 0);
    return b.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** Checks an uploaded file for the tutorial type; deletes it and throws when it's not acceptable. */
async function checkUpload(type: TutorialType, f: Express.Multer.File): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  try {
    const head = await readHead(f.path);
    const mime = type === "IMAGE" ? sniffMime(head.subarray(0, 12)) : null;
    // H.264 = an "avc1" sample entry in the MP4 (moov can sit at the end, so look through the file).
    const h264 = type === "VIDEO" ? (await readFile(f.path)).includes("avc1") : false;
    const problem = tutorialFileProblem(type, head, f.size, mime, h264);
    if (problem) fail("unprocessable", REASONS.INVALID_FILE, problem);
    return { filePath: relativePath(f.path), mimeType: type === "VIDEO" ? "video/mp4" : type === "PDF" ? "application/pdf" : mime!, sizeBytes: f.size };
  } catch (err) {
    await unlink(f.path).catch(() => undefined);
    throw err;
  }
}

const titleSchema = z
  .string()
  .superRefine((t, ctx) => {
    const problem = tutorialTitleProblem(t);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  })
  .transform((t) => t.trim());
const idTypeSchema = z.string().trim().toUpperCase().regex(ID_TYPE_KEY, "Choose the ID type (like AADHAAR_XML or PAN).");
const descriptionSchema = z.string().trim().max(200, "Keep the description to 200 characters.");
const orderSchema = z.coerce.number().int().min(0).max(10_000).optional();
const activeSchema = z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).optional();
const createSchema = z.object({
  idType: idTypeSchema,
  title: titleSchema,
  description: descriptionSchema.optional().or(z.literal("").transform(() => undefined)),
  type: z.enum(TUTORIAL_TYPES),
  url: z.string().trim().max(500).optional(),
  order: orderSchema,
  active: activeSchema,
});
const patchSchema = z.object({
  idType: idTypeSchema.optional(),
  title: titleSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  type: z.enum(TUTORIAL_TYPES).optional(),
  url: z.string().trim().max(500).optional(),
  order: orderSchema,
  active: activeSchema,
});

/** GET /api/v1/admin/kyc-tutorials — all guides (active and hidden), display order. */
export async function listTutorials(req: Request, res: Response): Promise<void> {
  requireSuperAdmin(req);
  const rows = await prisma.kycTutorial.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  res.json({ items: rows.map((t) => presentTutorial(t, true)) });
}

/** POST /api/v1/admin/kyc-tutorials — multipart (idType, type, title, description?, order?, active?, file) or JSON with url. */
export async function createTutorial(req: Request, res: Response): Promise<void> {
  try {
    requireSuperAdmin(req);
    const input = parseInput(createSchema, req.body ?? {});
    let stored: Awaited<ReturnType<typeof checkUpload>> | null = null;
    if (req.file) stored = await checkUpload(input.type, req.file);
    else {
      if (!input.url) fail("invalid-argument", REASONS.INVALID_INPUT, "Upload a file or give a direct https link.");
      const problem = tutorialUrlProblem(input.type, input.url);
      if (problem) fail("invalid-argument", REASONS.INVALID_INPUT, problem);
    }
    const last = await prisma.kycTutorial.aggregate({ _max: { order: true } });
    const t = await prisma.kycTutorial.create({
      data: {
        title: input.title,
        idType: input.idType,
        type: input.type,
        description: input.description ?? null,
        order: input.order ?? (last._max.order ?? -1) + 1,
        active: input.active ?? true,
        externalUrl: stored ? null : input.url!.trim(),
        ...(stored ?? {}),
        createdById: me(req).id,
      },
    });
    await logActivity(req, "kyc.tutorial_create", "kyc_tutorial", t.id, { idType: t.idType, type: t.type, uploaded: !!stored });
    res.locals.message = "Guide added";
    res.status(201).json({ tutorial: presentTutorial(t, true) });
  } catch (err) {
    if (req.file) await unlink(req.file.path).catch(() => undefined);
    throw err;
  }
}

/** PATCH /api/v1/admin/kyc-tutorials/:id — idType / title / description / order / active, or a new file / link. */
export async function updateTutorial(req: Request, res: Response): Promise<void> {
  try {
    requireSuperAdmin(req);
    const t = found(await prisma.kycTutorial.findUnique({ where: { id: String(req.params.id) } }), "Guide");
    const input = parseInput(patchSchema, req.body ?? {});
    const type = (input.type ?? t.type) as TutorialType;
    let fileChange: Partial<KycTutorial> = {};
    if (req.file) fileChange = { ...(await checkUpload(type, req.file)), externalUrl: null };
    else if (input.url !== undefined) {
      const problem = tutorialUrlProblem(type, input.url);
      if (problem) fail("invalid-argument", REASONS.INVALID_INPUT, problem);
      fileChange = { externalUrl: input.url.trim(), filePath: null, mimeType: null, sizeBytes: null };
    } else if (input.type && input.type !== t.type) {
      fail("invalid-argument", REASONS.INVALID_INPUT, "Changing the type needs a new file or link of that type.");
    }
    const updated = await prisma.kycTutorial.update({
      where: { id: t.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.idType !== undefined ? { idType: input.idType } : {}),
        ...(input.order !== undefined ? { order: input.order } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...fileChange,
      },
    });
    if (t.filePath && "filePath" in fileChange && fileChange.filePath !== t.filePath) await storage.remove(t.filePath);
    await logActivity(req, "kyc.tutorial_update", "kyc_tutorial", t.id, { fields: Object.keys(input), newFile: !!req.file });
    res.locals.message = "Saved";
    res.json({ tutorial: presentTutorial(updated, true) });
  } catch (err) {
    if (req.file) await unlink(req.file.path).catch(() => undefined);
    throw err;
  }
}

/** DELETE /api/v1/admin/kyc-tutorials/:id */
export async function deleteTutorial(req: Request, res: Response): Promise<void> {
  requireSuperAdmin(req);
  const t = found(await prisma.kycTutorial.findUnique({ where: { id: String(req.params.id) } }), "Guide");
  await prisma.kycTutorial.delete({ where: { id: t.id } });
  if (t.filePath) await storage.remove(t.filePath);
  await logActivity(req, "kyc.tutorial_delete", "kyc_tutorial", t.id, { type: t.type });
  res.locals.message = "Guide deleted";
  res.json({ ok: true });
}

/** GET /api/v1/public/kyc-tutorials/:id/file — no login, active guides only, Range supported (video seeking). */
export async function tutorialFile(req: Request, res: Response): Promise<void> {
  const t = await prisma.kycTutorial.findUnique({ where: { id: String(req.params.id) } });
  if (!t || !t.active || !t.filePath) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  storage.send(res, t.filePath, t.mimeType ?? "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=3600");
}
