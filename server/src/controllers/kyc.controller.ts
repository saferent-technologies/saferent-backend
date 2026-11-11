import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { allowedOrigins } from "../config/env";
import { logActivity } from "../lib/activity";
import { digiLocker, kycProviderKey } from "../lib/digilocker";
import { fail } from "../lib/errors";
import { found, paged, pagination } from "../lib/http";
import { compareNames, DIGILOCKER_DAILY_LIMIT, kycStage } from "../lib/kyc";
import { prisma } from "../lib/prisma";
import { discardUploads, relativePath, removeStoredFile, sendStoredFile, sniffMime, UPLOAD_ROOT } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { can, hasRole, me } from "../middleware/auth";

/*
 * Owner verification ("Owner verified ✓").
 *   Owner:  DigiLocker (Setu) → live selfie → submit.  Ownership proof is uploaded per property (Documents).
 *   Staff (users.manage): compare DigiLocker photo + selfie + names → approve / reject (POST /users/:id/kyc).
 *   Properties are approved only for verified owners with a verified ownership document (property.controller).
 * Privacy: full Aadhaar number never stored; the DigiLocker photo is deleted once staff decide.
 */

const OWNERSHIP = { needsVerification: true, isCurrent: true, archivedAt: null } satisfies Prisma.PropertyDocumentWhereInput;

function requireOwner(req: Request): void {
  if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Owner verification is for property owners.");
}

const latestIdentity = (userId: string) => prisma.identityVerification.findFirst({ where: { userId, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });

/** Each owner property with its ownership-proof state. */
async function ownershipOf(userId: string) {
  const props = await prisma.property.findMany({
    where: { ownerId: userId, archivedAt: null },
    select: { id: true, code: true, title: true, name: true, city: true, publicationStatus: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const docs = await prisma.propertyDocument.findMany({ where: { ...OWNERSHIP, propertyId: { in: props.map((p) => p.id) } }, select: { id: true, propertyId: true, docType: true, status: true, rejectionReason: true } });
  return props.map((p) => {
    const mine = docs.filter((d) => d.propertyId === p.id);
    const state = mine.some((d) => d.status === "APPROVED") ? "VERIFIED" : mine.some((d) => d.status === "PENDING") ? "PENDING" : mine.length ? "REJECTED" : "MISSING";
    return { id: p.id, code: p.code, title: p.title ?? p.name ?? p.code, city: p.city, publicationStatus: p.publicationStatus, ownership: state, documents: mine.map((d) => ({ id: d.id, docType: d.docType, status: d.status, rejectionReason: d.rejectionReason })) };
  });
}

function presentIdentity(v: Awaited<ReturnType<typeof latestIdentity>>, profileName: string) {
  if (!v) return null;
  return {
    id: v.id,
    provider: v.provider,
    test: v.provider === "MOCK",
    name: v.name,
    dob: v.dob,
    gender: v.gender,
    aadhaarLast4: v.aadhaarLast4,
    city: v.city,
    state: v.state,
    pincode: v.pincode,
    hasPhoto: !!v.photoPath,
    verifiedAt: v.completedAt,
    nameMatch: v.name ? compareNames(profileName, v.name) : "MISMATCH",
  };
}

/** GET /api/v1/kyc/me — the owner's verification checklist. */
export async function myKyc(req: Request, res: Response): Promise<void> {
  requireOwner(req);
  const user = me(req);
  const [profile, identity, properties] = await Promise.all([prisma.landlordProfile.findUnique({ where: { userId: user.id } }), latestIdentity(user.id), ownershipOf(user.id)]);
  const stage = kycStage(profile, !!identity, !!profile?.selfiePath);
  res.json({
    stage,
    note: profile?.kycNote ?? null,
    submittedAt: profile?.kycSubmittedAt ?? null,
    reviewedAt: profile?.kycReviewedAt ?? null,
    provider: kycProviderKey(),
    phoneVerified: user.phoneVerified,
    identity: presentIdentity(identity, user.fullName),
    selfie: !!profile?.selfiePath,
    properties,
    canEdit: stage === "NOT_STARTED" || stage === "IN_PROGRESS" || stage === "REJECTED",
    canSubmit: (stage === "IN_PROGRESS" || stage === "REJECTED") && !!identity && !!profile?.selfiePath,
  });
}

function assertEditable(profile: { kycStatus: string; kycSubmittedAt: Date | null } | null) {
  if (profile?.kycStatus === "APPROVED") fail("failed-precondition", REASONS.INVALID_STATE, "You're already verified.");
  if (profile?.kycSubmittedAt) fail("failed-precondition", REASONS.INVALID_STATE, "Your verification is under review.");
}

/** POST /api/v1/kyc/digilocker/start — returns the DigiLocker consent URL. */
export async function startDigiLocker(req: Request, res: Response): Promise<void> {
  requireOwner(req);
  const user = me(req);
  const provider = digiLocker();
  if (!provider) fail("failed-precondition", REASONS.INVALID_STATE, "DigiLocker verification isn't switched on yet. Please try again later.");
  assertEditable(await prisma.landlordProfile.findUnique({ where: { userId: user.id } }));
  const today = await prisma.identityVerification.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= DIGILOCKER_DAILY_LIMIT) fail("resource-exhausted", REASONS.INVALID_STATE, "Too many DigiLocker attempts today. Please try again tomorrow.");
  const redirectUrl = `${allowedOrigins[0] ?? "http://localhost:5173"}/kyc/digilocker/return`;
  const { ref, url } = await provider.start(redirectUrl);
  await prisma.identityVerification.create({ data: { userId: user.id, provider: provider.key, providerRef: ref } });
  res.json({ url, test: provider.key === "MOCK" });
}

const completeSchema = z.object({ id: z.string().trim().min(1).max(80), success: z.string().optional(), errMessage: z.string().max(300).optional() });

/** POST /api/v1/kyc/digilocker/complete — called by the web app when DigiLocker redirects back. */
export async function completeDigiLocker(req: Request, res: Response): Promise<void> {
  requireOwner(req);
  const user = me(req);
  const input = parseInput(completeSchema, req.body);
  const session = found(await prisma.identityVerification.findFirst({ where: { providerRef: input.id, userId: user.id } }), "DigiLocker session");
  if (session.status === "COMPLETED") {
    res.json({ ok: true, already: true });
    return;
  }
  if (session.status === "FAILED") fail("failed-precondition", REASONS.INVALID_STATE, "This DigiLocker session failed. Please start again.");
  const provider = digiLocker();
  if (!provider || provider.key !== session.provider) fail("failed-precondition", REASONS.INVALID_STATE, "DigiLocker verification isn't available right now.");
  if (input.success && input.success.toLowerCase() !== "true") {
    await prisma.identityVerification.update({ where: { id: session.id }, data: { status: "FAILED", error: (input.errMessage ?? "Consent not given").slice(0, 300) } });
    fail("failed-precondition", REASONS.INVALID_STATE, "DigiLocker consent wasn't completed. Please try again and allow Aadhaar.");
  }

  let identity;
  try {
    identity = await provider.fetchAadhaar(session.providerRef, user.fullName);
  } catch (err) {
    await prisma.identityVerification.update({ where: { id: session.id }, data: { status: "FAILED", error: String((err as Error).message).slice(0, 300) } });
    throw err;
  }

  // Keep the Aadhaar photo only if it really is an image (until staff review).
  let photoPath: string | null = null;
  if (identity.photo && ["image/jpeg", "image/png"].includes(sniffMime(identity.photo.subarray(0, 12)) ?? "")) {
    const dir = path.join(UPLOAD_ROOT, "kyc");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${randomUUID()}.jpg`);
    await writeFile(file, identity.photo);
    photoPath = relativePath(file);
  }

  const claimed = await prisma.identityVerification.updateMany({
    where: { id: session.id, status: "STARTED" },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      name: identity.name.slice(0, 150),
      dob: identity.dob?.slice(0, 20) ?? null,
      gender: identity.gender?.slice(0, 10) ?? null,
      aadhaarLast4: identity.aadhaarLast4,
      city: identity.city?.slice(0, 80) ?? null,
      state: identity.state?.slice(0, 80) ?? null,
      pincode: identity.pincode?.slice(0, 10) ?? null,
      photoPath,
    },
  });
  if (!claimed.count && photoPath) await removeStoredFile(photoPath);
  // Older completed sessions are superseded — drop their photos.
  const older = await prisma.identityVerification.findMany({ where: { userId: user.id, id: { not: session.id }, photoPath: { not: null } }, select: { id: true, photoPath: true } });
  for (const o of older) await removeStoredFile(o.photoPath!);
  if (older.length) await prisma.identityVerification.updateMany({ where: { id: { in: older.map((o) => o.id) } }, data: { photoPath: null } });
  await provider.revoke(session.providerRef);
  await logActivity(req, "kyc.digilocker", "user", user.id, { provider: session.provider, nameMatch: compareNames(user.fullName, identity.name) });
  res.json({ ok: true, nameMatch: compareNames(user.fullName, identity.name) });
}

/** POST /api/v1/kyc/selfie — live photo (multipart "file"). */
export async function uploadSelfie(req: Request, res: Response): Promise<void> {
  try {
    requireOwner(req);
    if (!req.file || !req.file.mimetype.startsWith("image/")) fail("invalid-argument", REASONS.INVALID_INPUT, "Take a selfie photo.");
    const user = me(req);
    const profile = await prisma.landlordProfile.findUnique({ where: { userId: user.id } });
    assertEditable(profile);
    const stored = relativePath(req.file.path);
    await prisma.landlordProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, selfiePath: stored }, update: { selfiePath: stored } });
    if (profile?.selfiePath) await removeStoredFile(profile.selfiePath);
    res.json({ ok: true });
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
}

/** POST /api/v1/kyc/submit — send DigiLocker + selfie for staff review. */
export async function submitKyc(req: Request, res: Response): Promise<void> {
  requireOwner(req);
  const user = me(req);
  const profile = await prisma.landlordProfile.findUnique({ where: { userId: user.id } });
  assertEditable(profile);
  if (!(await latestIdentity(user.id))) fail("failed-precondition", REASONS.INVALID_STATE, "Verify with DigiLocker first.");
  if (!profile?.selfiePath) fail("failed-precondition", REASONS.INVALID_STATE, "Take a selfie first.");
  await prisma.landlordProfile.update({ where: { userId: user.id }, data: { kycStatus: "PENDING", kycSubmittedAt: new Date(), kycNote: null } });
  await logActivity(req, "kyc.submit", "user", user.id);
  res.json({ ok: true });
}

/** GET /api/v1/kyc/files/:userId/:kind — DigiLocker photo or selfie; the owner or reviewers only. */
export async function kycFile(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const userId = String(req.params.userId);
  const kind = String(req.params.kind);
  if (userId !== user.id && !can(req, "users.manage")) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  let file: string | null | undefined;
  if (kind === "selfie") file = (await prisma.landlordProfile.findUnique({ where: { userId }, select: { selfiePath: true } }))?.selfiePath;
  else if (kind === "photo") file = (await latestIdentity(userId))?.photoPath;
  if (!file) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  const ext = file.split(".").pop();
  sendStoredFile(res, file, ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
}

/* ─────────────── Staff (users.manage) ─────────────── */

const queueSchema = z.object({ status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).default("SUBMITTED") });

/** GET /api/v1/admin/kyc — owners waiting for review (or decided). */
export async function kycQueue(req: Request, res: Response): Promise<void> {
  const { status } = parseInput(queueSchema, req.query);
  const p = pagination(req);
  const where: Prisma.LandlordProfileWhereInput =
    status === "SUBMITTED" ? { kycStatus: "PENDING", kycSubmittedAt: { not: null } } : status === "APPROVED" ? { kycStatus: "APPROVED" } : { kycStatus: "REJECTED" };
  const [rows, total] = await Promise.all([
    prisma.landlordProfile.findMany({ where, orderBy: status === "SUBMITTED" ? { kycSubmittedAt: "asc" } : { kycReviewedAt: "desc" }, skip: p.skip, take: p.take, include: { user: { select: { id: true, fullName: true, phoneNumber: true } } } }),
    prisma.landlordProfile.count({ where }),
  ]);
  const ids = rows.map((r) => r.userId);
  const identities = await prisma.identityVerification.findMany({ where: { userId: { in: ids }, status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
  const pendingDocs = await prisma.propertyDocument.findMany({ where: { ...OWNERSHIP, status: "PENDING", property: { ownerId: { in: ids } } }, select: { property: { select: { ownerId: true } } } });
  res.json(
    paged(
      rows.map((r) => {
        const idv = identities.find((i) => i.userId === r.userId) ?? null;
        return {
          userId: r.userId,
          fullName: r.user.fullName,
          phoneNumber: r.user.phoneNumber,
          kycStatus: r.kycStatus,
          submittedAt: r.kycSubmittedAt,
          reviewedAt: r.kycReviewedAt,
          digilockerName: idv?.name ?? null,
          nameMatch: idv?.name ? compareNames(r.user.fullName, idv.name) : null,
          test: idv?.provider === "MOCK",
          pendingOwnershipDocs: pendingDocs.filter((d) => d.property.ownerId === r.userId).length,
        };
      }),
      total,
      p,
    ),
  );
}

/** GET /api/v1/admin/kyc/:userId — everything a reviewer compares. */
export async function kycDetail(req: Request, res: Response): Promise<void> {
  const userId = String(req.params.userId);
  const user = found(await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, phoneNumber: true, phoneVerified: true, email: true, createdAt: true } }), "User");
  const [profile, identity, properties] = await Promise.all([prisma.landlordProfile.findUnique({ where: { userId } }), latestIdentity(userId), ownershipOf(userId)]);
  if (!profile) fail("not-found", REASONS.NOT_FOUND, "This user has no owner profile.");
  res.json({
    user,
    stage: kycStage(profile, !!identity, !!profile.selfiePath),
    kycStatus: profile.kycStatus,
    note: profile.kycNote,
    submittedAt: profile.kycSubmittedAt,
    reviewedAt: profile.kycReviewedAt,
    identity: presentIdentity(identity, user.fullName),
    selfie: !!profile.selfiePath,
    properties,
  });
}

/** Called by the staff decision (users/:id/kyc): clears the submission and deletes the DigiLocker photo. */
export async function afterKycDecision(tx: Prisma.TransactionClient, userId: string, decision: "APPROVED" | "REJECTED"): Promise<string[]> {
  if (decision === "APPROVED") {
    const [identity, profile] = await Promise.all([
      tx.identityVerification.findFirst({ where: { userId, status: "COMPLETED" } }),
      tx.landlordProfile.findUnique({ where: { userId }, select: { selfiePath: true } }),
    ]);
    if (!identity || !profile?.selfiePath) fail("failed-precondition", REASONS.INVALID_STATE, "The owner hasn't finished DigiLocker and the selfie yet.");
  }
  await tx.landlordProfile.update({ where: { userId }, data: { kycSubmittedAt: null } });
  const photos = await tx.identityVerification.findMany({ where: { userId, photoPath: { not: null } }, select: { photoPath: true } });
  await tx.identityVerification.updateMany({ where: { userId, photoPath: { not: null } }, data: { photoPath: null } });
  return photos.map((p) => p.photoPath!);
}

/** Removes files after the decision has committed. */
export async function removeKycPhotos(files: string[]): Promise<void> {
  for (const f of files) await removeStoredFile(f);
}
