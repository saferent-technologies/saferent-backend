import type { Request, Response } from "express";
import { REVIEWABLE_PROPERTY } from "../properties/docQueue";
import { prisma } from "../lib/prisma";
import { can, me } from "../middleware/auth";
import { needsActionCount } from "./tenantRequests.controller";

/**
 * GET /api/v1/me/badges — counts for the sidebar / tabs, keyed by the portal path:
 * { "/notifications": 3, "/support": 2, "/moderation": 5, "/admin/kyc": 1, … }
 * Only sections this user can open, and only things waiting for them. Zero counts are left out.
 */
export async function myBadges(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const staff = (perm: Parameters<typeof can>[1]) => can(req, perm, "ALL");
  const jobs: Array<[string, Promise<number>]> = [];
  let supportSignal: Promise<string | null> = Promise.resolve(null);

  jobs.push(["/notifications", prisma.notification.count({ where: { userId: user.id, readAt: null } })]);

  // Support (staff get no notification rows for tickets, this badge is the signal):
  //  - tickets assigned to me that are new or have an owner reply I haven't opened yet;
  //  - plus the waiting queue for staff who aren't queue agents (admins / supervisors).
  if (staff("support.manage")) {
    const mine = prisma.supportTicket.count({
      where: {
        assignedToId: user.id,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        OR: [{ agentSeenAt: null }, { customerMessageAt: { gt: prisma.supportTicket.fields.agentSeenAt } }],
      },
    });
    const agent = user.roles.includes("SUPPORT");
    const queued = agent ? Promise.resolve(0) : prisma.supportTicket.count({ where: { assignedToId: null, status: { in: ["OPEN", "IN_PROGRESS"] } } });
    jobs.push(["/support", Promise.all([mine, queued]).then(([a, b]) => a + b)]);
    supportSignal = latestSupportActivity(user.id).catch((err) => {
      console.error("[badges] support signal failed", (err as Error).message);
      return null;
    });
  }
  else if (can(req, "support.create")) jobs.push(["/support", prisma.supportTicket.count({ where: { raisedById: user.id, status: "IN_PROGRESS" } })]);

  // Moderation queue: listings, listing changes and photos to review, documents to verify, fraud reports.
  const moderation: Array<Promise<number>> = [];
  if (staff("listings.approve")) {
    moderation.push(
      prisma.property.count({ where: { publicationStatus: "PENDING_VERIFICATION", revisionOfId: null, activeStatus: { not: "ARCHIVED" } } }),
      prisma.propertyRevision.count({ where: { status: "PENDING_VERIFICATION" } }),
      prisma.propertyImage.count({ where: { status: "PENDING", inspectionId: null, property: { publicationStatus: { in: ["APPROVED", "PUBLISHED"] }, revisionOfId: null } } }),
      prisma.propertyVideo.count({ where: { status: "PENDING" } }),
    );
  }
  if (staff("documents.verify")) moderation.push(prisma.propertyDocument.count({ where: { status: "PENDING", needsVerification: true, isCurrent: true, archivedAt: null, property: REVIEWABLE_PROPERTY } }));
  if (staff("fraud.manage")) moderation.push(prisma.fraudReport.count({ where: { status: { in: ["OPEN", "INVESTIGATING"] } } }));
  if (moderation.length) jobs.push(["/moderation", Promise.all(moderation).then((n) => n.reduce((a, b) => a + b, 0))]);

  if (staff("users.manage")) jobs.push(["/admin/kyc", prisma.landlordProfile.count({ where: { kycStatus: "PENDING", kycSubmittedAt: { not: null } } })]);
  if (staff("reviews.moderate")) jobs.push(["/review-moderation", prisma.reviewReport.count({ where: { status: "OPEN" } })]);

  // Landlord side: applications to decide, payment proofs to check, tenant requests needing a reply.
  if (user.roles.includes("LANDLORD")) {
    jobs.push(["/applications", prisma.rentalApplication.count({ where: { status: "PENDING", property: { ownerId: user.id } } })]);
    jobs.push(["/rent", prisma.rentPaymentRequest.count({ where: { landlordId: user.id, status: "PENDING" } })]);
    jobs.push(["/maintenance", needsActionCount(user.id)]);
  }

  const counts: Record<string, number> = {};
  for (const [path, p] of jobs) {
    const n = await p.catch((err) => {
      console.error("[badges] count failed", path, (err as Error).message);
      return 0;
    });
    if (n > 0) counts[path] = (counts[path] ?? 0) + n;
  }
  res.setHeader("Cache-Control", "no-store, private");
  // signals: changes whenever something new happens in that section (the portal rings on a change),
  // even when the count stays the same (e.g. a 2nd reply on a ticket that's already unread).
  res.json({ badges: counts, total: Object.entries(counts).filter(([k]) => k !== "/notifications").reduce((a, [, n]) => a + n, 0), signals: { "/support": await supportSignal } });
}

/**
 * "<ISO time>|<ticketId>" of the newest support event for this staff member: an owner message on a ticket
 * assigned to them, a ticket newly assigned to them, or a new ticket / owner message waiting in the queue. Null = none.
 */
async function latestSupportActivity(userId: string): Promise<string | null> {
  const active = { in: ["OPEN", "IN_PROGRESS"] as Array<"OPEN" | "IN_PROGRESS"> };
  const [reply, assigned, queued] = await Promise.all([
    prisma.supportTicket.findFirst({ where: { assignedToId: userId, status: active, customerMessageAt: { not: null } }, orderBy: { customerMessageAt: "desc" }, select: { id: true, customerMessageAt: true } }),
    prisma.supportTicket.findFirst({ where: { assignedToId: userId, status: active, assignedAt: { not: null } }, orderBy: { assignedAt: "desc" }, select: { id: true, assignedAt: true } }),
    // Waiting tickets (new or the owner wrote again): every support staff member hears it, busy or not.
    prisma.supportTicket.findFirst({ where: { assignedToId: null, status: active, customerMessageAt: { not: null } }, orderBy: { customerMessageAt: "desc" }, select: { id: true, customerMessageAt: true } }),
  ]);
  const events = [
    reply && { at: reply.customerMessageAt!, id: reply.id },
    assigned && { at: assigned.assignedAt!, id: assigned.id },
    queued && { at: queued.customerMessageAt!, id: queued.id },
  ].filter((e): e is { at: Date; id: string } => !!e);
  if (!events.length) return null;
  const last = events.reduce((a, b) => (b.at > a.at ? b : a));
  return `${last.at.toISOString()}|${last.id}`;
}
