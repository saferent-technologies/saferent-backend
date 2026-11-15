import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { idParam, paged, pagination } from "../lib/http";
import { notify } from "../lib/notify";
import { placeLabels, placeOf } from "../lib/places";
import { prisma } from "../lib/prisma";
import { consumeRateLimit } from "../lib/rateLimit";
import { discardUploads, storage } from "../lib/uploads";
import { parseInput } from "../lib/validation";
import { hasRole, me } from "../middleware/auth";

/*
 * Landlord announcements → tenants of the landlord's ACTIVE leases (all, chosen properties, or chosen
 * leases). Recipients are snapshotted; each gets a push + in-app notification (type ANNOUNCEMENT,
 * link /announcements/{id}) and opening it marks it viewed. Only the owner and the recipients can see
 * an announcement or its image. Logs carry ids and counts only — never the text, phones or addresses.
 */

const MAX_IMAGE = 5 * 1024 * 1024;
const DAILY_LIMIT = 20;
const list = (v: unknown) => (v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v : String(v).split(",")).map((x) => String(x).trim()).filter(Boolean);

const createSchema = z
  .object({
    title: z.string().trim().min(3, "Title needs at least 3 characters.").max(100),
    body: z.string().trim().min(10, "Message needs at least 10 characters.").max(2000),
    audience: z.enum(["ALL", "PROPERTIES", "TENANTS"]),
    propertyIds: z.array(z.string().uuid()).max(200).default([]),
    leaseIds: z.array(z.string().uuid()).max(1000).default([]),
  })
  .strict();

const imageUrl = (id: string) => `/api/v1/files/announcements/${id}`;

/** POST /api/v1/announcements (multipart: title, body, audience, propertyIds[], leaseIds[], image?) — landlord. */
export async function createAnnouncement(req: Request, res: Response): Promise<void> {
  const user = me(req);
  try {
    if (!hasRole(req, "LANDLORD")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only landlords can send announcements.");
    const raw = (req.body ?? {}) as Record<string, unknown>;
    const input = parseInput(createSchema, { ...raw, propertyIds: list(raw.propertyIds ?? raw["propertyIds[]"]), leaseIds: list(raw.leaseIds ?? raw["leaseIds[]"]) });
    if (input.audience === "PROPERTIES" && !input.propertyIds.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one property.");
    if (input.audience === "TENANTS" && !input.leaseIds.length) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose at least one tenant.");
    if (req.file) {
      if (!["image/jpeg", "image/png"].includes(req.file.mimetype)) fail("invalid-argument", REASONS.INVALID_INPUT, "The picture must be a JPG or PNG.");
      if (req.file.size > MAX_IMAGE) fail("invalid-argument", REASONS.INVALID_INPUT, "The picture can be up to 5 MB.");
    }

    // Recipients: tenants of this landlord's ACTIVE leases.
    let audienceLabel = "All tenants";
    if (input.audience === "PROPERTIES") {
      const props = await prisma.property.findMany({ where: { id: { in: input.propertyIds }, ownerId: user.id, revisionOfId: null }, select: { id: true, title: true, code: true } });
      if (props.length !== new Set(input.propertyIds).size) fail("permission-denied", REASONS.PERMISSION_DENIED, "You can only send to your own properties.");
      audienceLabel = props.map((p) => p.title ?? p.code).join(", ").slice(0, 255);
    }
    if (input.audience === "TENANTS") {
      const ok = await prisma.lease.count({ where: { id: { in: input.leaseIds }, landlordId: user.id, status: "ACTIVE" } });
      if (ok !== new Set(input.leaseIds).size) fail("unprocessable", REASONS.INVALID_INPUT, "Some selected tenants aren't on an active lease with you.");
    }
    const leases = await prisma.lease.findMany({
      where: {
        landlordId: user.id,
        status: "ACTIVE",
        ...(input.audience === "PROPERTIES" ? { propertyId: { in: input.propertyIds } } : {}),
        ...(input.audience === "TENANTS" ? { id: { in: input.leaseIds } } : {}),
      },
      select: { id: true, tenantId: true },
      orderBy: { createdAt: "asc" },
    });
    // One entry per tenant, even with two leases.
    const byTenant = new Map<string, string>();
    for (const l of leases) if (!byTenant.has(l.tenantId)) byTenant.set(l.tenantId, l.id);
    if (!byTenant.size) fail("unprocessable", REASONS.INVALID_INPUT, "No tenants to send to");
    if (input.audience === "TENANTS") audienceLabel = `${byTenant.size} tenant${byTenant.size > 1 ? "s" : ""}`;

    await consumeRateLimit(`announce:${user.id}`, DAILY_LIMIT, 24 * 60 * 60 * 1000);

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.announcement.create({
        data: {
          landlordId: user.id,
          title: input.title,
          body: input.body,
          audience: input.audience,
          audienceLabel,
          propertyIds: input.audience === "PROPERTIES" ? input.propertyIds : undefined,
          imageKey: req.file ? storage.keyFor(req.file) : null,
          imageMime: req.file?.mimetype ?? null,
          recipientCount: byTenant.size,
        },
      });
      await tx.announcementRecipient.createMany({ data: [...byTenant].map(([tenantId, leaseId]) => ({ announcementId: a.id, tenantId, leaseId })) });
      return a;
    });

    const preview = input.body.slice(0, 120);
    for (const tenantId of byTenant.keys()) {
      // Data-only push: the app builds the notification and loads the picture with the tenant's token.
      await notify(tenantId, input.title, preview, `/announcements/${created.id}`, undefined, { type: "ANNOUNCEMENT", announcementId: created.id }, { dataOnly: true, imageUrl: created.imageKey ? imageUrl(created.id) : null });
    }
    console.info("[announcements] sent", { announcementId: created.id, recipients: byTenant.size });
    res.locals.message = `Sent to ${byTenant.size} tenant${byTenant.size > 1 ? "s" : ""}`;
    res.status(201).json({ announcement: await presentFor(created.id, user.id) });
  } catch (err) {
    await discardUploads(req);
    throw err;
  }
}

async function presentFor(id: string, viewerId: string) {
  const a = await prisma.announcement.findUniqueOrThrow({ where: { id } });
  const base = { id: a.id, title: a.title, body: a.body, imageUrl: a.imageKey ? imageUrl(a.id) : null, image: a.imageKey ? { url: imageUrl(a.id) } : null, audience: a.audience, audienceLabel: a.audienceLabel, createdAt: a.createdAt };
  if (a.landlordId === viewerId) {
    const viewed = await prisma.announcementRecipient.count({ where: { announcementId: a.id, viewedAt: { not: null } } });
    return { ...base, isMine: true, stats: { recipients: a.recipientCount, viewed } };
  }
  const [mine, landlord] = await Promise.all([
    prisma.announcementRecipient.findUnique({ where: { announcementId_tenantId: { announcementId: a.id, tenantId: viewerId } } }),
    prisma.user.findUnique({ where: { id: a.landlordId }, select: { fullName: true } }),
  ]);
  return { ...base, isMine: false, landlord: { fullName: landlord?.fullName ?? "" }, viewed: !!mine?.viewedAt, viewedAt: mine?.viewedAt ?? null };
}

/** Owner or a recipient; anyone else gets 404. */
async function visibleAnnouncement(req: Request) {
  const user = me(req);
  const a = await prisma.announcement.findUnique({ where: { id: idParam(req) } });
  const ok = !!a && (a.landlordId === user.id || (await prisma.announcementRecipient.count({ where: { announcementId: a.id, tenantId: user.id } })) > 0);
  if (!ok) fail("not-found", REASONS.NOT_FOUND, "Announcement not found.");
  return a!;
}

/** GET /api/v1/announcements?role=landlord|tenant — sent by me / received by me, latest first. */
export async function listAnnouncements(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const p = pagination(req);
  const role = req.query.role === "landlord" || (req.query.role !== "tenant" && hasRole(req, "LANDLORD") && !hasRole(req, "TENANT")) ? "landlord" : "tenant";
  if (role === "landlord") {
    const where = { landlordId: user.id };
    const [rows, total] = await Promise.all([prisma.announcement.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, select: { id: true } }), prisma.announcement.count({ where })]);
    res.json({ ...paged(await Promise.all(rows.map((r) => presentFor(r.id, user.id))), total, p), role });
    return;
  }
  const where = { tenantId: user.id };
  const [rows, total, unread] = await Promise.all([
    prisma.announcementRecipient.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take, select: { announcementId: true } }),
    prisma.announcementRecipient.count({ where }),
    prisma.announcementRecipient.count({ where: { tenantId: user.id, viewedAt: null } }),
  ]);
  res.json({ ...paged(await Promise.all(rows.map((r) => presentFor(r.announcementId, user.id))), total, p), role, unread });
}

/** GET /api/v1/announcements/:id */
export async function getAnnouncement(req: Request, res: Response): Promise<void> {
  const a = await visibleAnnouncement(req);
  res.json({ announcement: await presentFor(a.id, me(req).id) });
}

/** GET /api/v1/announcements/:id/recipients — owner only; no phone numbers. */
export async function announcementRecipients(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const a = await prisma.announcement.findUnique({ where: { id: idParam(req) } });
  if (!a || a.landlordId !== user.id) fail("not-found", REASONS.NOT_FOUND, "Announcement not found.");
  const rows = await prisma.announcementRecipient.findMany({ where: { announcementId: a!.id }, orderBy: { createdAt: "asc" } });
  const [leases, tenants] = await Promise.all([
    prisma.lease.findMany({ where: { id: { in: rows.map((r) => r.leaseId) } }, select: { id: true, unitId: true, bedId: true, property: { select: { title: true, code: true } } } }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.tenantId) } }, select: { id: true, fullName: true } }),
  ]);
  const leaseOf = new Map(leases.map((l) => [l.id, l]));
  const nameOf = new Map(tenants.map((t) => [t.id, t.fullName]));
  const places = await placeLabels(leases);
  res.json({
    recipients: rows.map((r) => {
      const l = leaseOf.get(r.leaseId);
      return { leaseId: r.leaseId, tenant: { fullName: nameOf.get(r.tenantId) ?? "" }, property: { title: l ? (l.property.title ?? l.property.code) : "" }, place: l ? placeOf(places, l) : null, viewedAt: r.viewedAt };
    }),
  });
}

/** POST /api/v1/announcements/:id/view — recipient opened it (first time recorded; always 200). */
export async function viewAnnouncement(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const a = await visibleAnnouncement(req);
  await prisma.announcementRecipient.updateMany({ where: { announcementId: a.id, tenantId: user.id, viewedAt: null }, data: { viewedAt: new Date() } });
  const mine = await prisma.announcementRecipient.findUnique({ where: { announcementId_tenantId: { announcementId: a.id, tenantId: user.id } }, select: { viewedAt: true } });
  res.json({ id: a.id, viewed: !!mine?.viewedAt, viewedAt: mine?.viewedAt ?? null });
}

/** GET /api/v1/files/announcements/:id — the picture; owner + recipients only. */
export async function announcementImage(req: Request, res: Response): Promise<void> {
  const a = await visibleAnnouncement(req);
  if (!a.imageKey) fail("not-found", REASONS.NOT_FOUND, "No picture.");
  storage.send(res, a.imageKey!, a.imageMime ?? "image/jpeg");
}
