import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { applicableDocuments, complianceSchema, declarationSchema, expiryState, leaseComplianceSchema, OWNERSHIP_DECLARATION, POLICE_FIELDS } from "../../lib/compliance";
import { documentName } from "../../lib/documentAccess";
import { fail } from "../../lib/errors";
import { found, idParam } from "../../lib/http";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { me } from "../../middleware/auth";
import { and, propertyWhere } from "../../rbac/access";
import { audit, scopedProperty, typeOf, withProperty } from "../service";

/*
 * India compliance.
 *   Property (owner / managers): ownership declaration, property tax, municipal assessment number, building
 *   approval, and which compliance documents are uploaded (OC, fire NOC, trade license, society NOC …) with
 *   expiry. Lease (landlord / tenant): rental agreement registration and police verification.
 * Private: never shown on listings. Logs: ids only.
 */

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function docIds(liveId: string) {
  const draft = await prisma.property.findFirst({ where: { revisionOfId: liveId }, select: { id: true } });
  return [liveId, ...(draft ? [draft.id] : [])];
}

async function view(property: { id: string; propertyTypeKey: string }) {
  const [row, ids] = await Promise.all([prisma.propertyCompliance.findUnique({ where: { propertyId: property.id } }), docIds(property.id)]);
  const docs = await prisma.propertyDocument.findMany({
    where: { propertyId: { in: ids }, isCurrent: true, archivedAt: null },
    select: { id: true, docType: true, customName: true, status: true, expiryDate: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const t = typeOf(property);
  const declaredBy = row?.ownershipDeclaredById ? await prisma.user.findUnique({ where: { id: row.ownershipDeclaredById }, select: { fullName: true } }) : null;
  return {
    declaration: {
      text: OWNERSHIP_DECLARATION.text,
      version: OWNERSHIP_DECLARATION.version,
      declaredAt: row?.ownershipDeclaredAt ?? null,
      declaredBy: declaredBy?.fullName ?? null,
      current: !!row?.ownershipDeclaredAt && row.ownershipDeclarationVersion === OWNERSHIP_DECLARATION.version,
    },
    compliance: {
      assessmentNumber: row?.assessmentNumber ?? null,
      propertyTaxStatus: row?.propertyTaxStatus ?? null,
      propertyTaxPaidYear: row?.propertyTaxPaidYear ?? null,
      propertyTaxAmount: row?.propertyTaxAmount == null ? null : Number(row.propertyTaxAmount),
      buildingApprovalNumber: row?.buildingApprovalNumber ?? null,
      buildingApprovalAuthority: row?.buildingApprovalAuthority ?? null,
      buildingApprovalDate: day(row?.buildingApprovalDate),
    },
    documents: applicableDocuments(t.category, t.structure).map((d) => {
      const doc = docs.find((x) => x.docType === d.docType);
      return { docType: d.docType, label: d.label, whereApplicable: d.applies !== "ALL", uploaded: !!doc, documentId: doc?.id ?? null, status: doc?.status ?? null, expiryDate: day(doc?.expiryDate), expiryState: expiryState(doc?.expiryDate) };
    }),
    // Any current document that expires within 30 days or has expired.
    expiring: docs
      .filter((d) => ["EXPIRING", "EXPIRED"].includes(expiryState(d.expiryDate) ?? ""))
      .map((d) => ({ documentId: d.id, docType: d.docType, name: documentName(d), expiryDate: day(d.expiryDate), expiryState: expiryState(d.expiryDate) })),
    updatedAt: row?.updatedAt ?? null,
  };
}

/** GET /api/v1/properties/:propertyId/compliance */
export async function getCompliance(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  res.setHeader("Cache-Control", "no-store, private");
  res.json(await view(property));
}

/** PUT /api/v1/properties/:propertyId/compliance — the whole object (not the declaration). */
export async function putCompliance(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(complianceSchema, req.body ?? {});
  const data = {
    assessmentNumber: input.assessmentNumber ?? null,
    propertyTaxStatus: input.propertyTaxStatus ?? null,
    propertyTaxPaidYear: input.propertyTaxPaidYear ?? null,
    propertyTaxAmount: input.propertyTaxAmount ?? null,
    buildingApprovalNumber: input.buildingApprovalNumber ?? null,
    buildingApprovalAuthority: input.buildingApprovalAuthority ?? null,
    buildingApprovalDate: input.buildingApprovalDate ?? null,
    updatedById: me(req).id,
  };
  await withProperty(property.id, async (tx) => {
    await tx.propertyCompliance.upsert({ where: { propertyId: property.id }, create: { propertyId: property.id, ...data }, update: data });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "compliance.update", newValue: { fields: Object.keys(input) } });
  });
  res.locals.message = "Compliance details saved";
  res.json(await view(property));
}

/** POST /api/v1/properties/:propertyId/ownership-declaration { accepted: true, version } — the owner only. */
export async function declareOwnership(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  if (property.ownerId !== me(req).id) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the owner can make the ownership declaration.");
  parseInput(declarationSchema, req.body ?? {});
  const now = new Date();
  await withProperty(property.id, async (tx) => {
    const data = { ownershipDeclaredAt: now, ownershipDeclaredById: me(req).id, ownershipDeclarationVersion: OWNERSHIP_DECLARATION.version };
    await tx.propertyCompliance.upsert({ where: { propertyId: property.id }, create: { propertyId: property.id, ...data, updatedById: me(req).id }, update: data });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "ownership.declared", newValue: { version: OWNERSHIP_DECLARATION.version } });
  });
  res.locals.message = "Declaration saved";
  res.json(await view(property));
}

/** Submit blocker: the owner hasn't made the current ownership declaration. */
export async function declarationProblems(propertyId: string): Promise<string[]> {
  const row = await prisma.propertyCompliance.findUnique({ where: { propertyId }, select: { ownershipDeclaredAt: true, ownershipDeclarationVersion: true } });
  return row?.ownershipDeclaredAt && row.ownershipDeclarationVersion === OWNERSHIP_DECLARATION.version ? [] : ["Confirm the ownership declaration."];
}

// ───── Lease: agreement registration + police verification ─────

async function leaseFor(req: Request) {
  const user = me(req);
  const scope = propertyWhere(user, "leases.manage");
  const lease = found(
    await prisma.lease.findFirst({ where: { id: idParam(req, "leaseId"), OR: [{ tenantId: user.id }, { landlordId: user.id }, ...(scope ? [{ property: and(scope, {}) }] : [])] } }),
    "Lease",
  );
  return { lease, isTenant: lease.tenantId === user.id && lease.landlordId !== user.id };
}

function leaseView(l: Awaited<ReturnType<typeof leaseFor>>["lease"], isTenant: boolean) {
  return {
    leaseId: l.id,
    agreement: { type: l.agreementType, registrationNumber: l.agreementRegistrationNumber, office: l.agreementOffice, date: day(l.agreementDate), stampDutyAmount: l.stampDutyAmount == null ? null : Number(l.stampDutyAmount) },
    policeVerification: { status: l.policeVerificationStatus ?? "NOT_STARTED", reference: l.policeVerificationRef, submittedOn: day(l.policeVerificationSubmittedOn), verifiedOn: day(l.policeVerificationVerifiedOn) },
    can: { editAgreement: !isTenant && l.status === "ACTIVE", editPoliceVerification: l.status === "ACTIVE" },
  };
}

/** GET /api/v1/leases/:leaseId/compliance — landlord, tenant, lease managers. */
export async function getLeaseCompliance(req: Request, res: Response): Promise<void> {
  const { lease, isTenant } = await leaseFor(req);
  res.setHeader("Cache-Control", "no-store, private");
  res.json(leaseView(lease, isTenant));
}

/** PUT /api/v1/leases/:leaseId/compliance — send only what changes; tenants may update police verification only. */
export async function putLeaseCompliance(req: Request, res: Response): Promise<void> {
  const { lease, isTenant } = await leaseFor(req);
  if (lease.status !== "ACTIVE") fail("failed-precondition", REASONS.LEASE_ENDED, "This lease has ended.");
  const input = parseInput(leaseComplianceSchema, req.body ?? {});
  const keys = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
  if (isTenant && keys.some((k) => !(POLICE_FIELDS as readonly string[]).includes(k))) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only the landlord can change the agreement details.");
  const updated = await withProperty(lease.propertyId, async (tx) => {
    const row = await tx.lease.update({ where: { id: lease.id }, data: { ...input, complianceUpdatedById: me(req).id } });
    await audit(tx, req, { propertyId: lease.propertyId, entityType: "LEASE", entityId: lease.id, action: "lease.compliance", newValue: { fields: keys } });
    return row;
  });
  if (input.policeVerificationStatus && input.policeVerificationStatus !== lease.policeVerificationStatus) {
    const other = isTenant ? lease.landlordId : lease.tenantId;
    await notify(other, "Police verification update", `Police verification is now: ${input.policeVerificationStatus.replace("_", " ").toLowerCase()}.`, `/leases/${lease.id}`, undefined, { type: "LEASE_COMPLIANCE", leaseId: lease.id });
  }
  res.locals.message = "Saved";
  res.json(leaseView(updated, isTenant));
}

// ───── Job: document expiry reminders ─────

/** Tell owners 30 days before a property document expires, and when it has expired (once each). */
export async function processDocumentExpiry(): Promise<void> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const in30 = new Date(today.getTime() + 30 * 86_400_000);
  const docs = await prisma.propertyDocument.findMany({
    where: { isCurrent: true, archivedAt: null, expiryDate: { not: null, lte: in30 }, expiryNoticeStage: { lt: 2 }, property: { revisionOfId: null } },
    select: { id: true, docType: true, customName: true, expiryDate: true, expiryNoticeStage: true, propertyId: true, property: { select: { ownerId: true, title: true, code: true } } },
    take: 500,
  });
  for (const d of docs) {
    const expired = d.expiryDate! < today;
    const stage = expired ? 2 : 1;
    if (d.expiryNoticeStage >= stage) continue;
    const claimed = await prisma.propertyDocument.updateMany({ where: { id: d.id, expiryNoticeStage: d.expiryNoticeStage }, data: { expiryNoticeStage: stage } });
    if (!claimed.count) continue;
    const name = documentName(d);
    const place = d.property.title ?? d.property.code;
    await notify(
      d.property.ownerId,
      expired ? "Document expired" : "Document expires soon",
      expired ? `"${name}" for "${place}" expired on ${day(d.expiryDate)}. Upload the renewed one.` : `"${name}" for "${place}" expires on ${day(d.expiryDate)}. Renew it in time.`,
      `/properties/${d.propertyId}?tab=documents`,
      undefined,
      { type: "DOCUMENT_EXPIRY", propertyId: d.propertyId, documentId: d.id },
    );
  }
}
