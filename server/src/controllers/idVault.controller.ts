import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { idParam } from "../lib/http";
import { stripImageMetadata } from "../lib/imageScrub";
import { pdfProblem } from "../lib/pdfCheck";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { sniffMime } from "../lib/upload-sniff";
import { UPLOAD_ROOT } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { decryptFile, encryptFile, keyWrapper } from "../lib/vaultCrypto";
import { me } from "../middleware/auth";

/*
 * Tenant ID documents vault.
 * - Pages are encrypted at rest (AES-256-GCM, one data key per page, wrapped by the key-encryption key —
 *   see lib/vaultCrypto). Uploads never touch disk unencrypted (multer memory storage); EXIF is stripped.
 * - Readable by the owner, and by the landlord of a lease the tenant shared it with while that lease is
 *   ACTIVE. Shares are removed when the lease closes (lib occupancy hook) and on account deletion.
 * - Every response carrying document data: Cache-Control no-store, private. Access log: ids only.
 */

export const DOC_TYPES = [
  { key: "AADHAAR", label: "Aadhaar", pages: 2 },
  { key: "PAN", label: "PAN card", pages: 1 },
  { key: "PASSPORT", label: "Passport", pages: 2 },
  { key: "DRIVING_LICENCE", label: "Driving licence", pages: 2 },
  { key: "VOTER_ID", label: "Voter ID", pages: 2 },
  { key: "EMPLOYEE_ID", label: "Employee ID", pages: 2 },
  { key: "OTHER", label: "Other document", pages: 2 },
] as const;
type DocType = (typeof DOC_TYPES)[number]["key"];
const typeDef = (k: string) => DOC_TYPES.find((t) => t.key === k);
const VAULT_DIR = "id-vault";

function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

async function log(actorId: string, action: string, ids: { documentId?: string | null; pageId?: string | null; leaseId?: string | null; tenantId?: string | null }, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  await tx.tenantDocumentAccessLog.create({ data: { actorId, action, documentId: ids.documentId ?? null, pageId: ids.pageId ?? null, leaseId: ids.leaseId ?? null, tenantId: ids.tenantId ?? null } });
}

function absolute(key: string): string {
  const abs = path.resolve(UPLOAD_ROOT, key);
  if (!abs.startsWith(UPLOAD_ROOT + path.sep)) throw new Error("Bad storage key");
  return abs;
}

/** Crypto-shred: delete the encrypted files (the wrapped keys go with the DB rows). */
async function shredFiles(keys: string[]) {
  await Promise.all(keys.map((k) => unlink(absolute(k)).catch(() => undefined)));
}

/** Deletes all of a tenant's documents (account deletion). Call after the account is marked deleted. */
export async function shredTenantDocuments(tenantId: string, actorId: string): Promise<void> {
  const docs = await prisma.tenantDocument.findMany({ where: { tenantId }, include: { pages: { select: { storageKey: true } } } });
  if (!docs.length) return;
  await prisma.tenantDocument.deleteMany({ where: { tenantId } }); // pages + shares cascade
  await shredFiles(docs.flatMap((d) => d.pages.map((p) => p.storageKey)));
  await log(actorId, "SHRED", { tenantId });
}

/** A lease stopped being active: its shares end at once (same transaction as the lease change). */
export async function endLeaseSharesTx(tx: Prisma.TransactionClient, leaseId: string): Promise<void> {
  const shares = await tx.tenantDocumentShare.findMany({ where: { leaseId }, select: { documentId: true, tenantId: true } });
  if (!shares.length) return;
  await tx.tenantDocumentShare.deleteMany({ where: { leaseId } });
  await tx.tenantDocumentAccessLog.createMany({ data: shares.map((s) => ({ actorId: s.tenantId, action: "LEASE_END", documentId: s.documentId, leaseId, tenantId: s.tenantId })) });
}

/* ───── shapes ───── */

async function leaseInfo(leaseIds: string[]) {
  if (!leaseIds.length) return new Map<string, { leaseId: string; landlord: { fullName: string }; propertyTitle: string; place: string | null }>();
  const leases = await prisma.lease.findMany({ where: { id: { in: leaseIds } }, select: { id: true, unitId: true, bedId: true, landlord: { select: { fullName: true } }, property: { select: { title: true, code: true } } } });
  const places = await placeLabels(leases);
  return new Map(leases.map((l) => [l.id, { leaseId: l.id, landlord: { fullName: l.landlord.fullName }, propertyTitle: l.property.title ?? l.property.code, place: placeOf(places, l) }]));
}

const docInclude = { pages: { orderBy: { pageNo: "asc" }, select: { id: true, pageNo: true, mimeType: true } }, shares: { orderBy: { createdAt: "asc" } } } satisfies Prisma.TenantDocumentInclude;
type DocRow = Prisma.TenantDocumentGetPayload<{ include: typeof docInclude }>;

function docShape(d: DocRow, pageUrl: (pageId: string) => string) {
  return {
    id: d.id,
    type: d.type,
    typeLabel: typeDef(d.type)?.label ?? d.type,
    uploadedAt: d.createdAt,
    pages: d.pages.map((p) => ({ id: p.id, pageNo: p.pageNo, mimeType: p.mimeType, isPdf: p.mimeType === "application/pdf", url: pageUrl(p.id) })),
  };
}

async function vault(tenantId: string) {
  const [docs, leases] = await Promise.all([
    prisma.tenantDocument.findMany({ where: { tenantId }, include: docInclude, orderBy: { createdAt: "desc" } }),
    prisma.lease.findMany({ where: { tenantId, status: "ACTIVE" }, select: { id: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const info = await leaseInfo([...new Set([...leases.map((l) => l.id), ...docs.flatMap((d) => d.shares.map((s) => s.leaseId))])]);
  return {
    documents: docs.map((d) => ({
      ...docShape(d, (pageId) => `/api/v1/me/documents/${d.id}/pages/${pageId}`),
      shares: d.shares.filter((s) => info.has(s.leaseId)).map((s) => ({ ...info.get(s.leaseId)!, sharedAt: s.createdAt })),
    })),
    types: DOC_TYPES,
    leases: leases.map((l) => info.get(l.id)).filter(Boolean),
  };
}

function tenantOnly(req: Request) {
  const user = me(req);
  if (!user.roles.includes("TENANT")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only tenants have an ID documents vault.");
  return user;
}

async function ownDoc(req: Request) {
  const user = tenantOnly(req);
  const doc = await prisma.tenantDocument.findFirst({ where: { id: idParam(req), tenantId: user.id } });
  if (!doc) fail("not-found", REASONS.NOT_FOUND, "Document not found.");
  return { user, doc: doc! };
}

/* ───── tenant ───── */

/** GET /api/v1/me/documents */
export async function getVault(req: Request, res: Response): Promise<void> {
  const user = tenantOnly(req);
  noStore(res);
  res.json(await vault(user.id));
}

const uploadSchema = z.object({ type: z.enum(DOC_TYPES.map((t) => t.key) as [DocType, ...DocType[]]) }).strict();

/** POST /api/v1/me/documents (multipart: type, files[1..pages]) — same type replaces the old one (not OTHER). */
export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const user = tenantOnly(req);
  noStore(res);
  keyWrapper(); // 503 early when the vault isn't configured
  await consumeRateLimit(`id-vault:${user.id}`, 30, 24 * 60 * 60 * 1000);
  const { type } = parseInput(uploadSchema, req.body ?? {});
  const def = typeDef(type)!;
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Add a photo of the document.");
  if (files.length > def.pages) fail("invalid-argument", REASONS.INVALID_INPUT, `${def.label} can have at most ${def.pages} page${def.pages > 1 ? "s" : ""}.`);

  // Check the real bytes, strip metadata, encrypt; write only ciphertext to disk.
  // A PDF holds the whole document (all pages), so it's sent alone.
  const mimes = files.map((f) => sniffMime(f.buffer.subarray(0, 12)));
  if (mimes.some((m) => m !== "image/jpeg" && m !== "image/png" && m !== "application/pdf")) fail("invalid-argument", REASONS.INVALID_INPUT, "Upload JPG or PNG photos, or a PDF, of the document.");
  if (mimes.includes("application/pdf") && files.length > 1) fail("invalid-argument", REASONS.INVALID_INPUT, "Send the PDF on its own (it can hold all the pages).");
  files.forEach((f, i) => {
    if (mimes[i] !== "application/pdf" && f.size > 5 * 1024 * 1024) fail("invalid-argument", REASONS.INVALID_INPUT, "Each photo can be up to 5 MB.");
    if (mimes[i] === "application/pdf") {
      const problem = pdfProblem(f.buffer);
      if (problem) fail("invalid-argument", REASONS.INVALID_INPUT, problem);
    }
  });
  const prepared = files.map((f, i) => {
    const mime = mimes[i];
    let clean: Buffer;
    try {
      // Photos: EXIF / location removed. PDFs are stored as uploaded (no image metadata to strip).
      clean = mime === "application/pdf" ? Buffer.from(f.buffer) : stripImageMetadata(f.buffer, mime!);
    } catch {
      fail("invalid-argument", REASONS.INVALID_INPUT, "That image file looks damaged. Please take the photo again.");
    }
    const enc = encryptFile(clean!);
    f.buffer.fill(0);
    return { pageNo: i + 1, mime: mime!, size: clean!.length, key: `${VAULT_DIR}/${randomUUID()}.enc`, enc };
  });
  await mkdir(path.join(UPLOAD_ROOT, VAULT_DIR), { recursive: true });
  await Promise.all(prepared.map((p) => writeFile(absolute(p.key), p.enc.ciphertext, { mode: 0o600 })));

  let replacedKeys: string[] = [];
  try {
    const created = await prisma.$transaction(async (tx) => {
      if (type !== "OTHER") {
        const old = await tx.tenantDocument.findMany({ where: { tenantId: user.id, type }, include: { pages: { select: { storageKey: true } } } });
        replacedKeys = old.flatMap((d) => d.pages.map((p) => p.storageKey));
        if (old.length) {
          await tx.tenantDocument.deleteMany({ where: { id: { in: old.map((d) => d.id) } } });
          for (const d of old) await log(user.id, "REPLACE", { documentId: d.id, tenantId: user.id }, tx);
        }
      }
      const doc = await tx.tenantDocument.create({ data: { tenantId: user.id, type } });
      await tx.tenantDocumentPage.createMany({
        data: prepared.map((p) => ({ documentId: doc.id, pageNo: p.pageNo, storageKey: p.key, mimeType: p.mime, size: p.size, iv: p.enc.iv, authTag: p.enc.tag, wrappedKey: p.enc.wrappedKey, keyId: p.enc.keyId })),
      });
      await log(user.id, "UPLOAD", { documentId: doc.id, tenantId: user.id }, tx);
      return doc;
    });
    void created;
  } catch (err) {
    await shredFiles(prepared.map((p) => p.key));
    throw err;
  }
  await shredFiles(replacedKeys);
  res.locals.message = `${def.label} saved securely`;
  res.status(201).json(await vault(user.id));
}

/** DELETE /api/v1/me/documents/:id — files and all shares removed (crypto-shred). */
export async function deleteDocument(req: Request, res: Response): Promise<void> {
  const { user, doc } = await ownDoc(req);
  noStore(res);
  const pages = await prisma.tenantDocumentPage.findMany({ where: { documentId: doc.id }, select: { storageKey: true } });
  await prisma.$transaction(async (tx) => {
    await tx.tenantDocument.delete({ where: { id: doc.id } });
    await log(user.id, "DELETE", { documentId: doc.id, tenantId: user.id }, tx);
  });
  await shredFiles(pages.map((p) => p.storageKey));
  res.locals.message = "Document deleted";
  res.json(await vault(user.id));
}

const shareSchema = z.object({ leaseId: z.string().uuid() }).strict();

/** POST /api/v1/me/documents/:id/shares { leaseId } — only the tenant's ACTIVE lease. */
export async function shareDocument(req: Request, res: Response): Promise<void> {
  const { user, doc } = await ownDoc(req);
  noStore(res);
  const { leaseId } = parseInput(shareSchema, req.body ?? {});
  const lease = await prisma.lease.findFirst({ where: { id: leaseId, tenantId: user.id, status: "ACTIVE" }, select: { id: true, landlordId: true } });
  if (!lease) fail("failed-precondition", REASONS.LEASE_ENDED, "You can share only with the landlord of your current rental.");
  const exists = await prisma.tenantDocumentShare.findUnique({ where: { documentId_leaseId: { documentId: doc.id, leaseId } } });
  if (!exists) {
    await prisma.$transaction(async (tx) => {
      await tx.tenantDocumentShare.create({ data: { documentId: doc.id, leaseId, landlordId: lease!.landlordId, tenantId: user.id } });
      await log(user.id, "SHARE", { documentId: doc.id, leaseId, tenantId: user.id }, tx);
    });
    await notify(lease!.landlordId, "Tenant shared a document", `${user.fullName} shared an ID document with you.`, `/leases/${leaseId}`, undefined, { type: "DOCUMENT_SHARED", leaseId });
  }
  res.locals.message = "Shared with your landlord";
  res.json(await vault(user.id));
}

/** DELETE /api/v1/me/documents/:id/shares/:leaseId */
export async function unshareDocument(req: Request, res: Response): Promise<void> {
  const { user, doc } = await ownDoc(req);
  noStore(res);
  const leaseId = idParam(req, "leaseId");
  const done = await prisma.tenantDocumentShare.deleteMany({ where: { documentId: doc.id, leaseId } });
  if (done.count) await log(user.id, "UNSHARE", { documentId: doc.id, leaseId, tenantId: user.id });
  res.locals.message = "Sharing stopped";
  res.json(await vault(user.id));
}

async function sendPage(res: Response, page: { storageKey: string; mimeType: string; iv: string; authTag: string; wrappedKey: string; keyId: string }) {
  const plain = decryptFile(await readFile(absolute(page.storageKey)), { iv: page.iv, tag: page.authTag, wrappedKey: page.wrappedKey, keyId: page.keyId });
  noStore(res);
  res.setHeader("Content-Type", page.mimeType);
  res.setHeader("Content-Length", String(plain.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  res.end(plain);
}

/** GET /api/v1/me/documents/:id/pages/:pageId — decrypted image, owner only. */
export async function ownPage(req: Request, res: Response): Promise<void> {
  const { user, doc } = await ownDoc(req);
  const page = await prisma.tenantDocumentPage.findFirst({ where: { id: idParam(req, "pageId"), documentId: doc.id } });
  if (!page) fail("not-found", REASONS.NOT_FOUND, "Page not found.");
  await log(user.id, "VIEW", { documentId: doc.id, pageId: page!.id, tenantId: user.id });
  await sendPage(res, page!);
}

/* ───── landlord ───── */

async function landlordLease(req: Request) {
  const user = me(req);
  const lease = await prisma.lease.findFirst({ where: { id: idParam(req, "leaseId"), landlordId: user.id }, select: { id: true, status: true, tenantId: true, tenant: { select: { fullName: true } } } });
  if (!lease) fail("not-found", REASONS.NOT_FOUND, "Lease not found.");
  if (lease!.status !== "ACTIVE") fail("permission-denied", REASONS.LEASE_ENDED, "This lease has ended, so the tenant's documents are no longer shared.");
  return { user, lease: lease! };
}

/** GET /api/v1/leases/:leaseId/documents — documents the tenant shared on this (active) lease. */
export async function leaseDocuments(req: Request, res: Response): Promise<void> {
  const { lease } = await landlordLease(req);
  noStore(res);
  const docs = await prisma.tenantDocument.findMany({ where: { tenantId: lease.tenantId, shares: { some: { leaseId: lease.id } } }, include: docInclude, orderBy: { createdAt: "desc" } });
  res.json({ tenant: { fullName: lease.tenant.fullName }, documents: docs.map((d) => docShape(d, (pageId) => `/api/v1/leases/${lease.id}/documents/${d.id}/pages/${pageId}`)) });
}

/** GET /api/v1/leases/:leaseId/documents/:docId/pages/:pageId — only while the lease is active and shared. */
export async function leaseDocumentPage(req: Request, res: Response): Promise<void> {
  const { user, lease } = await landlordLease(req);
  const docId = idParam(req, "docId");
  const share = await prisma.tenantDocumentShare.findUnique({ where: { documentId_leaseId: { documentId: docId, leaseId: lease.id } } });
  if (!share) fail("permission-denied", REASONS.PERMISSION_DENIED, "This document isn't shared with you.");
  const page = await prisma.tenantDocumentPage.findFirst({ where: { id: idParam(req, "pageId"), documentId: docId } });
  if (!page) fail("not-found", REASONS.NOT_FOUND, "Page not found.");
  await log(user.id, "VIEW", { documentId: docId, pageId: page!.id, leaseId: lease.id, tenantId: lease.tenantId });
  await sendPage(res, page!);
}
