import type { Property, PropertyRevision } from "@prisma/client";
import { flatsWithoutVideo, videosFor } from "./videos.controller";
import { flagHomeAlertsTx } from "../../services/homeAlerts";
import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found, paged, pagination } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { removeStoredFile } from "../../lib/uploads";
import { parseInput } from "../../lib/validation";
import { can, me } from "../../middleware/auth";
import { syncLocationsForProperty } from "../locations";
import { presentProperty, propertySummary } from "../presenters";
import { changedSectionsOf, deleteDraft, draftProblems, draftView, mergeDraft, needsRevision, openRevision, revisionSummary } from "../revisions";
import { audit, isModerator, loadAggregate, recordStatus, scopedProperty } from "../service";
import { notifyStaff } from "../../lib/notifyStaff";
import { canEditContent } from "../workflow";

/*
 * Change requests for APPROVED / PUBLISHED listings (see ../revisions.ts).
 *   POST   /properties/:id/revision/submit   → PENDING_VERIFICATION (412 + details.problems when incomplete)
 *   DELETE /properties/:id/revision          → DISCARDED (live untouched)
 *   GET    /admin/property-revisions          → queue (listings.approve)
 *   GET    /admin/property-revisions/:id      → live vs changed listing + changedSections
 *   POST   /admin/property-revisions/:id/review { decision: APPROVE | REJECT, reason }
 */

/** can.editRevision / submitRevision / discardRevision for the property detail. */
export function revisionPermissions(req: Request, property: Property, rev: PropertyRevision | null) {
  const manage = can(req, "properties.manage");
  const editable = manage && needsRevision(property) && canEditContent(property, isModerator(req)).ok;
  const open = rev?.status === "DRAFT" || rev?.status === "REJECTED";
  return {
    editRevision: editable && rev?.status !== "PENDING_VERIFICATION",
    submitRevision: editable && open,
    discardRevision: manage && open,
  };
}

async function liveWithRevision(req: Request) {
  const property = await scopedProperty(req, "properties.manage");
  const rev = await openRevision(prisma, property.id);
  if (!rev?.draftPropertyId) fail("not-found", REASONS.NOT_FOUND, "There are no changes for this property.");
  return { property, rev };
}

/** POST /api/v1/properties/:propertyId/revision/submit */
export async function submitRevision(req: Request, res: Response): Promise<void> {
  const { property, rev } = await liveWithRevision(req);
  if (rev.status === "PENDING_VERIFICATION") fail("failed-precondition", REASONS.INVALID_STATE, "Your changes are already being verified.");
  const decision = canEditContent(property, isModerator(req));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  const problems = await draftProblems(rev.draftPropertyId!);
  if (problems.length) fail("failed-precondition", REASONS.INVALID_STATE, "Complete the required details before submitting.", { problems });
  // Every flat (as edited) needs a video tour, waiting for review or approved. unitIds = the copy's ids.
  const noVideo = await flatsWithoutVideo(property.id, rev.draftPropertyId!);
  if (noVideo.length) fail("failed-precondition", REASONS.VIDEO_REQUIRED, "Add a video tour for every flat before submitting.", { unitIds: noVideo });
  const changedSections = await changedSectionsOf(property.id, rev.draftPropertyId!);
  if (!changedSections.length) fail("failed-precondition", REASONS.INVALID_STATE, "You haven't changed anything yet.");
  const snapshot = await draftView(property, rev.draftPropertyId!);
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.propertyRevision.update({
      where: { id: rev.id },
      data: { status: "PENDING_VERIFICATION", submittedAt: new Date(), changedSections, data: JSON.parse(JSON.stringify(snapshot)), version: { increment: 1 } },
    });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "changeRequest", from: rev.status, to: "PENDING_VERIFICATION", reason: changedSections.join(", ") });
    return r;
  });
  await notifyStaff("listings.approve", "Listing changes to review", `Changes to "${property.title ?? property.code}" are waiting for verification.`, `/moderation/changes/${updated.id}`, me(req).id);
  res.locals.message = "Changes sent for verification. Your listing stays live meanwhile.";
  res.json({ pendingRevision: revisionSummary(updated) });
}

/** DELETE /api/v1/properties/:propertyId/revision — throw the changes away; the live listing is untouched. */
export async function discardRevision(req: Request, res: Response): Promise<void> {
  const { property, rev } = await liveWithRevision(req);
  if (rev.status === "PENDING_VERIFICATION") fail("failed-precondition", REASONS.INVALID_STATE, "Your changes are being verified and can't be discarded now.");
  const files = await prisma.$transaction(async (tx) => {
    const removed = await deleteDraft(tx, rev.draftPropertyId!);
    await tx.propertyRevision.update({ where: { id: rev.id }, data: { status: "DISCARDED", draftPropertyId: null, decidedAt: new Date(), version: { increment: 1 } } });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "changeRequest", from: rev.status, to: "DISCARDED" });
    return removed;
  });
  await removeUnusedFiles(files);
  res.locals.message = "Changes discarded";
  res.json({ pendingRevision: null });
}

async function removeUnusedFiles(paths: string[]): Promise<void> {
  for (const path of new Set(paths)) {
    if (await prisma.propertyImage.count({ where: { filePath: path } })) continue;
    await removeStoredFile(path).catch(() => undefined);
  }
}

// ───── Admin ─────

/** GET /api/v1/admin/property-revisions?status=PENDING_VERIFICATION */
export async function listRevisions(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : "PENDING_VERIFICATION";
  const where = { status: status as PropertyRevision["status"] };
  const [items, total] = await Promise.all([
    prisma.propertyRevision.findMany({ where, orderBy: { submittedAt: "asc" }, skip: p.skip, take: p.take }),
    prisma.propertyRevision.count({ where }),
  ]);
  const props = await prisma.property.findMany({ where: { id: { in: items.map((i) => i.propertyId) } }, include: { owner: { select: { id: true, fullName: true } } } });
  res.json(
    paged(
      items.map((r) => {
        const prop = props.find((x) => x.id === r.propertyId);
        return { ...revisionSummary(r)!, property: prop ? propertySummary(prop) : null };
      }),
      total,
      p,
    ),
  );
}

async function loadRevision(req: Request) {
  const rev = found(await prisma.propertyRevision.findUnique({ where: { id: String(req.params.revisionId) } }), "Change request");
  const property = found(await prisma.property.findUnique({ where: { id: rev.propertyId } }), "Property");
  return { rev, property };
}

/** GET /api/v1/admin/property-revisions/:revisionId — the live listing and the changed one side by side. */
export async function getRevision(req: Request, res: Response): Promise<void> {
  const { rev, property } = await loadRevision(req);
  const live = presentProperty(await loadAggregate(prisma, property.id));
  const changed = rev.draftPropertyId ? await draftView(property, rev.draftPropertyId) : (rev.data ?? null);
  const changedSections = rev.draftPropertyId ? await changedSectionsOf(property.id, rev.draftPropertyId) : ((rev.changedSections as string[] | null) ?? []);
  // All video tours of the listing (approved + waiting), place ids as in the changed listing.
  const videos = await videosFor(property.id, false, false, rev.draftPropertyId ? "draft" : "live");
  res.json({ revision: revisionSummary(rev), live, changed, changedSections, videos, owner: await prisma.user.findUnique({ where: { id: property.ownerId }, select: { id: true, fullName: true, phoneNumber: true } }) });
}

const reviewSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), reason: z.string().trim().max(500).optional() })
  .strict()
  .refine((v) => v.decision === "APPROVE" || (v.reason ?? "").length >= 5, { message: "Tell the owner what to fix (at least 5 characters).", path: ["reason"] });

/** POST /api/v1/admin/property-revisions/:revisionId/review */
export async function reviewRevision(req: Request, res: Response): Promise<void> {
  const { rev, property } = await loadRevision(req);
  const user = me(req);
  if (property.ownerId === user.id || property.createdById === user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "You cannot verify changes to a property you own or created.");
  if (rev.status !== "PENDING_VERIFICATION" || !rev.draftPropertyId) fail("failed-precondition", REASONS.INVALID_STATE, "Only changes waiting for verification can be reviewed.");
  const { decision, reason } = parseInput(reviewSchema, req.body);
  const title = property.title ?? property.code;

  if (decision === "REJECT") {
    await prisma.$transaction(async (tx) => {
      await tx.propertyRevision.update({ where: { id: rev.id }, data: { status: "REJECTED", moderationNote: reason!, decidedAt: new Date(), decidedById: user.id, version: { increment: 1 } } });
      await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "changeRequest", from: "PENDING_VERIFICATION", to: "REJECTED", reason });
    });
    await notify(property.ownerId, "Your changes need attention", `"${title}": ${reason} Your listing is still live with the old details.`, `/properties/${property.id}`);
    res.locals.message = "Changes rejected";
    res.json({ revision: revisionSummary(await prisma.propertyRevision.findUniqueOrThrow({ where: { id: rev.id } })) });
    return;
  }

  const snapshot = await draftView(property, rev.draftPropertyId);
  const changedSections = await changedSectionsOf(property.id, rev.draftPropertyId);
  const { removedFiles } = await prisma.$transaction(
    async (tx) => {
      const out = await mergeDraft(tx, property.id, rev.draftPropertyId!, user.id);
      // Video tours added with the change go live with it.
      await tx.propertyVideo.updateMany({ where: { propertyId: property.id, status: "PENDING" }, data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() } });
      // Approved changes may add / free units or lower rent → re-match (users already alerted for it are skipped).
      await flagHomeAlertsTx(tx, property.id);
      await tx.propertyRevision.update({
        where: { id: rev.id },
        data: { status: "APPROVED", draftPropertyId: null, data: JSON.parse(JSON.stringify(snapshot)), changedSections, moderationNote: reason || null, decidedAt: new Date(), decidedById: user.id, version: { increment: 1 } },
      });
      await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "changeRequest", from: "PENDING_VERIFICATION", to: "APPROVED", reason: changedSections.join(", ") });
      await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "change_request.approve", newValue: { revisionId: rev.id, changedSections } });
      return out;
    },
    { timeout: 60_000 },
  );
  await removeUnusedFiles(removedFiles);
  void syncLocationsForProperty(property.id, property);
  await notify(property.ownerId, "Your changes are live 🎉", `"${title}" now shows your updated details.`, `/properties/${property.id}`);
  res.locals.message = "Changes approved. The listing is updated";
  res.json({ property: propertySummary(await prisma.property.findUniqueOrThrow({ where: { id: property.id } })) });
}
