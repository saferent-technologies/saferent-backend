import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { RATE_LIMITS, REASONS } from "../config/constants";
import { consentsToInsert, consentStatus, CONSENT_TYPES, type ConsentRequest, type ConsentStatus, type ConsentTypeKey, type LatestConsent } from "../lib/consents";
import { fail } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";

/*
 * Consent records — proof of when each user accepted the Terms of Service / Privacy Policy, and their
 * WhatsApp opt-in / opt-out. user_consents is append-only (the database refuses UPDATE / DELETE).
 * Consents arrive with POST/PUT /userProfile (saveConsents); staff read the history at
 *   GET /admin/users/:uid/consents   (consents.view — Super Admin by default)
 */

/** Latest row of each type for one user (inside the transaction when given). */
async function latestByType(db: Prisma.TransactionClient, uid: string): Promise<Partial<Record<ConsentTypeKey, LatestConsent>>> {
  const out: Partial<Record<ConsentTypeKey, LatestConsent>> = {};
  for (const type of CONSENT_TYPES) {
    const row = await db.userConsent.findFirst({
      where: { userUid: uid, consentType: type },
      orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
      select: { version: true, granted: true, acceptedAt: true },
    });
    if (row) out[type] = row;
  }
  return out;
}

/** Current consent status for a Firebase uid. */
export async function consentStatusFor(uid: string): Promise<ConsentStatus> {
  return consentStatus(await latestByType(prisma, uid));
}

/**
 * Records consents for the signed-in uid (idempotent: a consent equal to the latest row of its type is
 * not inserted again). Server time, IP and User-Agent come from the request. Returns the new status.
 */
export async function saveConsents(req: Request, uid: string, input: Omit<ConsentRequest, "role"> & { role?: string | null }): Promise<ConsentStatus> {
  await consumeRateLimit(`consents:${uid}`, RATE_LIMITS.CONSENTS.limit, RATE_LIMITS.CONSENTS.windowMs);
  const acceptedAt = new Date();
  const meta = {
    acceptedAt,
    clientAcceptedAt: input.clientAcceptedAt !== undefined ? new Date(input.clientAcceptedAt) : null,
    role: input.role === "TENANT" || input.role === "LANDLORD" ? (input.role as "TENANT" | "LANDLORD") : null,
    source: input.source,
    appVersion: input.appVersion || null,
    ipAddress: (req.ip ?? "").slice(0, 45) || null,
    userAgent: req.get("user-agent")?.slice(0, 255) || null,
  };
  const latest = await prisma.$transaction(async (tx) => {
    // One writer per user at a time, so two identical requests can't both insert (idempotency).
    await tx.$queryRaw`SELECT GET_LOCK(${`consents:${uid}`}, 10) AS l`;
    try {
      const before = await latestByType(tx, uid);
      const rows = consentsToInsert(input.consents, before);
      if (rows.length) {
        await tx.userConsent.createMany({ data: rows.map((c) => ({ userUid: uid, consentType: c.type, version: c.version, granted: c.granted, ...meta })) });
      }
      return rows.length ? await latestByType(tx, uid) : before;
    } finally {
      await tx.$queryRaw`SELECT RELEASE_LOCK(${`consents:${uid}`}) AS r`;
    }
  });
  return consentStatus(latest);
}

/** GET /api/v1/admin/users/:uid/consents — read-only full history, newest first. */
export async function adminUserConsents(req: Request, res: Response): Promise<void> {
  const uid = String(req.params.uid ?? "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) fail("invalid-argument", REASONS.INVALID_INPUT, "Enter a valid Firebase uid.");
  const [rows, user] = await Promise.all([
    prisma.userConsent.findMany({ where: { userUid: uid }, orderBy: [{ acceptedAt: "desc" }, { id: "desc" }], take: 1000 }),
    prisma.user.findUnique({ where: { firebaseUid: uid }, select: { id: true, fullName: true, phoneNumber: true, role: true } }),
  ]);
  const latest: Partial<Record<ConsentTypeKey, LatestConsent>> = {};
  for (const r of rows) if (!latest[r.consentType]) latest[r.consentType] = r;
  res.json({
    uid,
    user,
    status: consentStatus(latest),
    history: rows.map((r) => ({
      id: r.id.toString(),
      type: r.consentType,
      version: r.version,
      granted: r.granted,
      acceptedAt: r.acceptedAt.toISOString(),
      clientAcceptedAt: r.clientAcceptedAt?.toISOString() ?? null,
      role: r.role,
      source: r.source,
      appVersion: r.appVersion,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
