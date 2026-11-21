import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { ID_TYPES, idFileProblem } from "../lib/idTypes";
import { availableIdTypes } from "./kycAdmin.controller";
import { AadhaarOfflineError, aadhaarOfflineAvailable, readAadhaarOffline } from "../lib/aadhaarOffline";
import { logActivity } from "../lib/activity";
import { AppError, fail } from "../lib/errors";
import { stripImageMetadata } from "../lib/imageScrub";
import { compareNames, DIGILOCKER_DAILY_LIMIT, kycStage } from "../lib/kyc";
import { prisma } from "../lib/prisma";
import { relativePath, removeStoredFile, sniffMime, UPLOAD_ROOT } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { decryptFile, encryptFile } from "../lib/vaultCrypto";
import { hasRole, me } from "../middleware/auth";

/*
 * Owner verification with an ID document (no paid DigiLocker):
 *   AADHAAR_XML   UIDAI Offline eKYC ZIP + 4-digit share code → signature checked against UIDAI's pinned
 *                 certificate, details read from the file (photo, last 4 digits only).
 *   PAN           number + front photo     → staff compare the photo.
 *   PASSPORT      number + front + back    → staff compare the photos.
 *   EAADHAAR_PDF  not supported yet (needs a PDF library to open the password-protected PDF and check
 *                 UIDAI's PDF signature): answered with a clear 412 so the app can offer the others.
 * Files and numbers are encrypted at rest (vault keys), never public, deleted once staff decide (only the
 * last 4 digits stay). Share codes / passwords are never stored or logged.
 */

const MAX = 5 * 1024 * 1024;
const TYPES = ["AADHAAR_XML", "EAADHAAR_PDF", "PAN", "PASSPORT"] as const;
type DocType = (typeof TYPES)[number];

/** Multipart fields: file (ZIP / PDF), front, back (JPG / PNG), each ≤ 5 MB, kept in memory only. */
export const uploadIdentityDocument = (req: Request, res: Response, next: NextFunction) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX, files: 3, fields: 10 },
  }).fields([
    { name: "file", maxCount: 1 },
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
  ])(req, res, (err?: unknown) => {
    if ((err as { code?: string } | undefined)?.code === "LIMIT_FILE_SIZE") return next(new AppError("invalid-argument", REASONS.INVALID_INPUT, "Files can be up to 5 MB."));
    next(err);
  });

type Files = { file?: Express.Multer.File[]; front?: Express.Multer.File[]; back?: Express.Multer.File[] };
const filesOf = (req: Request): Files => (req.files && !Array.isArray(req.files) ? (req.files as Files) : {});

const schema = z.object({
  type: z.enum(TYPES, { message: "Choose Aadhaar, PAN or passport." }),
  // Share code (Aadhaar ZIP) or PDF password: used once in memory, never stored.
  secret: z.string().max(40).optional(),
  number: z.string().trim().toUpperCase().max(20).optional(),
  // PAN / passport: the name as printed (staff check it against the photo).
  nameOnDocument: z.string().trim().min(2).max(150).optional(),
});

type FileMeta = { iv: string; tag: string; wrappedKey: string; keyId: string; mime: string };

/** Encrypts and stores one file under uploads/kyc-docs; returns its path and metadata. */
async function storeEncrypted(plain: Buffer, mime: string): Promise<{ path: string; meta: FileMeta }> {
  const { ciphertext, iv, tag, wrappedKey, keyId } = encryptFile(plain);
  const dir = path.join(UPLOAD_ROOT, "kyc-docs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.bin`);
  await writeFile(file, ciphertext);
  return { path: relativePath(file), meta: { iv, tag, wrappedKey, keyId, mime } };
}

export function encryptText(value: string): string {
  const { ciphertext, iv, tag, wrappedKey, keyId } = encryptFile(Buffer.from(value, "utf8"));
  return JSON.stringify({ ct: ciphertext.toString("base64"), iv, tag, wrappedKey, keyId });
}

export function decryptText(enc: string | null | undefined): string | null {
  if (!enc) return null;
  try {
    const o = JSON.parse(enc) as { ct: string; iv: string; tag: string; wrappedKey: string; keyId: string };
    return decryptFile(Buffer.from(o.ct, "base64"), o).toString("utf8");
  } catch {
    return null;
  }
}

/** Reads a stored KYC file: decrypted when it has metadata (new uploads), as is otherwise (DigiLocker photo). */
export async function readKycFile(relative: string, meta: FileMeta | undefined): Promise<{ data: Buffer; mime: string }> {
  const abs = path.resolve(UPLOAD_ROOT, relative);
  if (!abs.startsWith(UPLOAD_ROOT + path.sep)) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  const raw = await readFile(abs).catch(() => null);
  if (!raw) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  if (!meta) return { data: raw, mime: "image/jpeg" };
  return { data: decryptFile(raw, meta), mime: meta.mime };
}

async function documentImage(f: Express.Multer.File | undefined, label: string): Promise<{ data: Buffer; mime: string }> {
  if (!f) fail("invalid-argument", REASONS.INVALID_INPUT, `Add a photo of the ${label}.`);
  const mime = sniffMime(f.buffer.subarray(0, 12));
  if (mime !== "image/jpeg" && mime !== "image/png") fail("invalid-argument", REASONS.INVALID_INPUT, `The ${label} must be a JPG or PNG photo.`);
  return { data: stripImageMetadata(f.buffer, mime), mime };
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PASSPORT_RE = /^[A-Z][0-9]{7}$/;

/** POST /api/v1/kyc/identity — multipart; see the header comment. */
export async function uploadIdentity(req: Request, res: Response): Promise<void> {
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Owner verification is for property owners.");
  const user = me(req);
  const today = await prisma.identityVerification.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= DIGILOCKER_DAILY_LIMIT * 2) fail("resource-exhausted", REASONS.RATE_LIMITED, "Too many attempts today. Please try again tomorrow.");

  const input = parseInput(schema, req.body ?? {});
  const files = filesOf(req);
  const type: DocType = input.type;
  // Only types the server can check right now (same list as GET /kyc/me → idTypes).
  if (!(await availableIdTypes()).includes(type)) fail("failed-precondition", REASONS.ID_TYPE_UNAVAILABLE, "This ID can't be checked right now. Please choose another ID.");
  const profile = await prisma.landlordProfile.findUnique({ where: { userId: user.id } });
  if (profile?.kycStatus === "APPROVED") fail("failed-precondition", REASONS.INVALID_STATE, "You're already verified.");
  if (profile?.kycSubmittedAt) fail("failed-precondition", REASONS.INVALID_STATE, "Your verification is under review.");
  // The file must really be a ZIP / PDF (magic bytes, not the name).
  if (type === "AADHAAR_XML" || type === "EAADHAAR_PDF") {
    const problem = idFileProblem(type, files.file?.[0]?.buffer.subarray(0, 4));
    if (problem) fail("unprocessable", REASONS.INVALID_FILE, problem);
  }

  let data: Prisma.IdentityVerificationUncheckedCreateInput;
  const meta: Record<string, FileMeta> = {};
  const written: string[] = [];
  try {
    if (type === "EAADHAAR_PDF") {
      fail("failed-precondition", REASONS.INVALID_STATE, "e-Aadhaar PDF isn't supported yet. Upload the Aadhaar Offline eKYC ZIP, your PAN card or your passport.");
    } else if (type === "AADHAAR_XML") {
      const zip = files.file?.[0];
      if (!zip) fail("invalid-argument", REASONS.INVALID_INPUT, "Upload the Offline eKYC ZIP file from the UIDAI website.");
      if (!input.secret) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter the 4-digit share code you set while downloading the file.");
      if (!aadhaarOfflineAvailable()) fail("failed-precondition", REASONS.INVALID_STATE, "Aadhaar offline verification isn't set up yet. Please use PAN or passport for now.");
      let a;
      try {
        a = readAadhaarOffline(zip.buffer, input.secret);
      } catch (err) {
        if (err instanceof AadhaarOfflineError) fail(err.status, err.status === "failed-precondition" ? REASONS.INVALID_STATE : REASONS.INVALID_INPUT, err.message);
        throw err;
      }
      let photoPath: string | null = null;
      if (a.photo) {
        const s = await storeEncrypted(a.photo, "image/jpeg");
        photoPath = s.path;
        meta.photo = s.meta;
        written.push(s.path);
      }
      data = {
        userId: user.id,
        provider: "DOCUMENT",
        providerRef: `AADHAAR_XML-${randomUUID()}`,
        documentType: "AADHAAR_XML",
        status: "COMPLETED",
        completedAt: new Date(),
        name: a.name,
        dob: a.dob,
        gender: a.gender,
        aadhaarLast4: a.aadhaarLast4,
        documentLast4: a.aadhaarLast4,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        photoPath,
      };
    } else {
      const number = (input.number ?? "").replace(/\s+/g, "");
      if (type === "PAN" && !PAN_RE.test(number)) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a valid PAN, like ABCDE1234F.");
      if (type === "PASSPORT" && !PASSPORT_RE.test(number)) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a valid passport number, like A1234567.");
      const front = await documentImage(files.front?.[0], type === "PAN" ? "PAN card" : "passport's first page");
      const back = type === "PASSPORT" ? await documentImage(files.back?.[0], "passport's last page") : null;
      const f = await storeEncrypted(front.data, front.mime);
      meta.front = f.meta;
      written.push(f.path);
      let backPath: string | null = null;
      if (back) {
        const b = await storeEncrypted(back.data, back.mime);
        meta.back = b.meta;
        backPath = b.path;
        written.push(b.path);
      }
      data = {
        userId: user.id,
        provider: "DOCUMENT",
        providerRef: `${type}-${randomUUID()}`,
        documentType: type,
        status: "COMPLETED",
        completedAt: new Date(),
        name: input.nameOnDocument ?? null,
        documentNumberEnc: encryptText(number),
        documentLast4: number.slice(-4),
        frontPath: f.path,
        backPath,
      };
    }
    data.fileMeta = meta as Prisma.InputJsonValue;
    const created = await prisma.identityVerification.create({ data });

    // Older identities are superseded: their files go.
    const older = await prisma.identityVerification.findMany({
      where: { userId: user.id, id: { not: created.id }, OR: [{ photoPath: { not: null } }, { frontPath: { not: null } }, { backPath: { not: null } }, { documentNumberEnc: { not: null } }] },
      select: { id: true, photoPath: true, frontPath: true, backPath: true },
    });
    for (const o of older) for (const p of [o.photoPath, o.frontPath, o.backPath]) if (p) await removeStoredFile(p);
    if (older.length) await prisma.identityVerification.updateMany({ where: { id: { in: older.map((o) => o.id) } }, data: { photoPath: null, frontPath: null, backPath: null, documentNumberEnc: null, fileMeta: Prisma.DbNull } });

    const nameMatch = created.name ? compareNames(user.fullName, created.name) : null;
    await logActivity(req, "kyc.identity", "user", user.id, { documentType: type, nameMatch });
    res.locals.message =
      type === "AADHAAR_XML"
        ? nameMatch === "MISMATCH"
          ? "Aadhaar verified. The name on it doesn't match your profile name, so SafeRent may ask you about it."
          : "Aadhaar verified. Now take a live selfie."
        : "Document saved. Now take a live selfie. SafeRent checks the document when you submit.";
    res.status(201).json({ identity: presentDocumentIdentity(created, user.fullName), stage: kycStage(profile, true, !!profile?.selfiePath) });
  } catch (err) {
    for (const p of written) await removeStoredFile(p);
    throw err;
  }
}

type IdentityRow = {
  id: string;
  provider: string;
  documentType: string | null;
  name: string | null;
  dob: string | null;
  gender: string | null;
  aadhaarLast4: string | null;
  documentLast4: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  photoPath: string | null;
  frontPath: string | null;
  backPath: string | null;
  completedAt: Date | null;
};

/** The identity card for the owner / staff (never the full document number). */
export function presentDocumentIdentity(v: IdentityRow, profileName: string) {
  return {
    id: v.id,
    provider: v.provider,
    documentType: v.documentType ?? "DIGILOCKER",
    test: v.provider === "MOCK",
    name: v.name,
    dob: v.dob,
    gender: v.gender,
    aadhaarLast4: v.aadhaarLast4,
    documentLast4: v.documentLast4 ?? v.aadhaarLast4,
    city: v.city,
    state: v.state,
    pincode: v.pincode,
    hasPhoto: !!v.photoPath,
    hasFront: !!v.frontPath,
    hasBack: !!v.backPath,
    verifiedAt: v.completedAt,
    // Only a warning: staff decide. Null when the document gave no name (PAN / passport without nameOnDocument).
    nameMatch: v.name ? compareNames(profileName, v.name) : null,
  };
}

/** Ways the app can offer (DigiLocker only when a provider is on). Same pipeline as idTypes. */
export async function identityMethods(digilockerOn: boolean) {
  const available = await availableIdTypes();
  return [...(digilockerOn ? [{ type: "DIGILOCKER", available: true }] : []), ...ID_TYPES.map((type) => ({ type, available: available.includes(type) }))];
}
