import type { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { logActivity } from "../../lib/activity";
import { RATE_LIMITS, REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found, paged, pagination } from "../../lib/http";
import { storage } from "../../lib/uploads";
import { notify } from "../../lib/notify";
import { prisma } from "../../lib/prisma";
import { consumeRateLimit } from "../../lib/rateLimit";
import { parseInput } from "../../lib/validation";
import { can, hasRole, me } from "../../middleware/auth";
import { and, propertyWhere, rentWhere } from "../../rbac/access";
import { hasPermission } from "../../rbac/policy";
import { hasRoleWhere } from "../../controllers/users.controller";
import {
  ACTIVE_STATUSES,
  DEFAULT_COMPLETENESS_WEIGHTS,
  AVAILABILITY,
  BHK_TYPES,
  CATEGORIES,
  DISCLOSURE,
  DOCUMENT_TYPES,
  FURNISHING,
  ID_PREFIX,
  IMAGE_CATEGORIES,
  LISTING_TYPES,
  PG_TYPES,
  PROPERTY_COLUMNS,
  PUBLICATION_STATUSES,
  SHARING_TYPES,
  VERIFICATION_STATUSES,
  VILLA_CONFIGURATIONS,
  unitPrefix,
} from "../catalog";
import { computeCompleteness, submissionProblems } from "../completeness";
import { fieldsSchema, flatValues, mergeAttributes, splitValues } from "../fields";
import { nextCode } from "../ids";
import { presentProperty, propertySummary } from "../presenters";
import { CHARGE_BILLING, CHARGE_FREQUENCY, CHARGE_KINDS, createPropertySchema, listPropertiesQuery, reviewSchema, statusChangeSchema, transferOwnershipSchema, updatePropertySchema } from "../schemas";
import {
  audit,
  checkVersion,
  completenessInput,
  completenessWeights,
  diff,
  inScope,
  invalidateWeights,
  isModerator,
  isPropertyAdmin,
  loadAggregate,
  propertyKey,
  recordStatus,
  refreshAggregates,
  scopedProperty,
  typeOf,
  updateWithVersion,
  withProperty,
} from "../service";
import { canChangeActiveStatus, canEditContent, canPublish, canReview, canSubmit, canUnpublish, publicationAfterEdit } from "../workflow";
import { evaluateForUser } from "../../services/referral.service";

export const WIZARD_STEPS = [
  { step: 1, key: "category", title: "Select category" },
  { step: 2, key: "type", title: "Select property type" },
  { step: 3, key: "basic", title: "Basic property information" },
  { step: 4, key: "building", title: "Building / property details" },
  { step: 5, key: "units", title: "Units, rooms or beds" },
  { step: 6, key: "utilities", title: "Utilities" },
  { step: 7, key: "policies", title: "Guest policies and restrictions" },
  { step: 8, key: "amenities", title: "Amenities and facilities" },
  { step: 9, key: "pricing", title: "Rent and financial details" },
  { step: 10, key: "media", title: "Documents and images" },
  { step: 11, key: "inspection", title: "Condition and inspection" },
  { step: 12, key: "review", title: "Review and publish" },
] as const;

/** GET /api/v1/property-types — categories, types, field schemas and enums for dynamic forms. */
export async function listPropertyTypes(_req: Request, res: Response): Promise<void> {
  // Every type is returned so existing listings of a turned-off type still open; `enabled` says
  // whether new listings of that type can be created (clients only offer enabled types).
  const rows = await prisma.propertyTypeDefinition.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }] });
  res.json({
    categories: CATEGORIES.map((c) => ({
      key: c,
      label: c.charAt(0) + c.slice(1).toLowerCase(),
      types: rows.filter((r) => r.category === c).map((r) => ({ key: r.key, label: r.label, structure: r.structure, enabled: r.active, ...(r.schema as object) })),
    })),
    wizardSteps: WIZARD_STEPS,
    enums: {
      listingTypes: LISTING_TYPES,
      disclosure: DISCLOSURE,
      availability: AVAILABILITY,
      activeStatuses: ACTIVE_STATUSES,
      publicationStatuses: PUBLICATION_STATUSES,
      verificationStatuses: VERIFICATION_STATUSES,
      furnishing: FURNISHING,
      imageCategories: IMAGE_CATEGORIES,
      documentTypes: DOCUMENT_TYPES,
      chargeKinds: CHARGE_KINDS,
      chargeBilling: CHARGE_BILLING,
      chargeFrequency: CHARGE_FREQUENCY,
      sharingTypes: SHARING_TYPES,
      pgTypes: PG_TYPES,
      villaConfigurations: VILLA_CONFIGURATIONS,
      bhkTypes: BHK_TYPES,
    },
  });
}

/** GET /api/v1/amenities */
export async function listAmenities(_req: Request, res: Response): Promise<void> {
  const rows = await prisma.amenityDefinition.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  res.json({ items: rows.map((r) => ({ key: r.key, label: r.label, categories: r.categories })), total: rows.length, page: 1, pageSize: rows.length, totalPages: 1 });
}

/** POST /api/v1/properties — create a draft. Owner is derived from the verified token, never from the body. */
export async function createProperty(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const input = parseInput(createPropertySchema, req.body);
  await consumeRateLimit(`property-create:${user.id}`, RATE_LIMITS.PROPERTY_CREATE.limit, RATE_LIMITS.PROPERTY_CREATE.windowMs);

  const typeRow = await prisma.propertyTypeDefinition.findUnique({ where: { key: input.propertyTypeKey } });
  if (!typeRow) fail("invalid-argument", REASONS.INVALID_INPUT, "Choose a valid property type.");
  if (!typeRow.active) fail("failed-precondition", REASONS.INVALID_STATE, `${typeRow.label} listings can't be added right now.`);
  const type = typeOf({ propertyTypeKey: typeRow.key });
  if (input.category && input.category !== type.category) fail("invalid-argument", REASONS.INVALID_INPUT, `${type.label} belongs to the ${type.category.toLowerCase()} category.`);
  if (!type.listingTypes.includes(input.listingType)) fail("invalid-argument", REASONS.INVALID_INPUT, `${type.label} cannot be listed for ${input.listingType.toLowerCase()}.`);

  // Who owns it: a landlord creates their own; staff / agents create for a registered landlord.
  let ownerId = user.id;
  if (input.landlordPhone) {
    const scopes = user.permissions["properties.create"] ?? [];
    if (!scopes.includes("ALL") && !scopes.includes("ASSIGNED")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only SafeRent staff or agents can create a property for another landlord.");
    const landlord = await prisma.user.findFirst({ where: { AND: [{ phoneNumber: input.landlordPhone, accountStatus: "ACTIVE" }, hasRoleWhere("LANDLORD")] }, select: { id: true } });
    if (!landlord) fail("not-found", REASONS.NOT_FOUND, "No active landlord is registered with this phone number.");
    ownerId = landlord.id;
  } else if (!hasRole(req, "LANDLORD") && !hasPermission(user.permissions, "properties.create", "ALL")) {
    fail("invalid-argument", REASONS.INVALID_INPUT, "Enter the landlord's registered phone number.");
  }

  const created = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, ID_PREFIX.PROPERTY);
    const property = await tx.property.create({
      data: { code, ownerId, createdById: user.id, category: type.category, propertyTypeKey: type.key, listingType: input.listingType, title: input.title ?? null, wizardStep: 3 },
    });
    // Independent houses, duplexes, farmhouses and plots are one record with exactly one unit.
    if (type.structure === "SINGLE_UNIT" && type.unitKind) {
      const unitCode = await nextCode(tx, unitPrefix(type.unitKind));
      await tx.propertyUnit.create({ data: { code: unitCode, propertyId: property.id, kind: type.unitKind } });
    }
    if (hasRole(req, "PROPERTY_AGENT") && ownerId !== user.id) {
      await tx.propertyAssignment.create({ data: { propertyId: property.id, userId: user.id, type: "AGENT", createdById: user.id } });
    }
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "publicationStatus", from: null, to: "DRAFT" });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "property.create", newValue: { code, ownerId, propertyType: type.key, listingType: input.listingType } });
    return refreshAggregates(tx, property.id);
  });
  if (ownerId !== user.id) await notify(ownerId, "A property was added for you", `${user.fullName} started "${created.title ?? created.code}". Review it before it is submitted.`, `/properties/${created.id}`);
  res.locals.message = "Property created successfully";
  res.status(201).json({ property: presentProperty(await loadAggregate(prisma, created.id)) });
}

/** GET /api/v1/properties — properties in the caller's scope, filterable and paginated. */
export async function listProperties(req: Request, res: Response): Promise<void> {
  const scope = propertyWhere(me(req), "properties.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to view properties.");
  const p = pagination(req);
  const f = parseInput(listPropertiesQuery, req.query);
  const where = and<Prisma.PropertyWhereInput>(
    scope,
    f.activeStatus ? { activeStatus: f.activeStatus } : f.includeArchived === "true" ? undefined : { activeStatus: { not: "ARCHIVED" } },
    f.publicationStatus && { publicationStatus: f.publicationStatus },
    f.verificationStatus && { verificationStatus: f.verificationStatus },
    f.category && { category: f.category },
    f.propertyType ? { propertyTypeKey: f.propertyType } : undefined,
    f.city ? { city: { contains: f.city } } : undefined,
    f.ownerId ? { ownerId: f.ownerId } : undefined,
    p.q ? { OR: [{ code: { contains: p.q } }, { title: { contains: p.q } }, { name: { contains: p.q } }, { locality: { contains: p.q } }, { city: { contains: p.q } }, { pincode: { contains: p.q } }] } : undefined,
  );
  const orderBy: Prisma.PropertyOrderByWithRelationInput =
    f.sort === "created" ? { createdAt: "desc" } : f.sort === "title" ? { title: "asc" } : f.sort === "completeness" ? { completenessScore: "desc" } : { updatedAt: "desc" };
  const [items, total] = await Promise.all([
    prisma.property.findMany({
      where,
      orderBy,
      skip: p.skip,
      take: p.take,
      include: { owner: { select: { id: true, fullName: true } }, images: { select: { id: true, status: true }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], take: 3 } },
    }),
    prisma.property.count({ where }),
  ]);
  res.json(paged(items.map(propertySummary), total, p));
}

async function permissionsFor(req: Request, propertyId: string, ownerId: string) {
  const user = me(req);
  const within = async (perm: Parameters<typeof propertyWhere>[1]) => {
    const scope = propertyWhere(user, perm);
    return !!scope && (await prisma.property.count({ where: and(scope, { id: propertyId }) })) > 0;
  };
  const [manage, inspect, verifyDocs] = await Promise.all([within("properties.manage"), within("inspections.manage"), within("documents.verify")]);
  return {
    manage,
    review: isModerator(req) && ownerId !== user.id,
    verifyDocuments: verifyDocs && ownerId !== user.id,
    assign: can(req, "assignments.manage"),
    inspect: inspect || manage,
    suspend: isModerator(req),
    transferOwnership: isPropertyAdmin(req) && can(req, "users.manage"),
    viewAudit: true,
  };
}

/** GET /api/v1/properties/:propertyId — full record (accepts the UUID or SR-PROP code). */
export async function getProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const agg = await loadAggregate(prisma, property.id);
  const completeness = computeCompleteness(completenessInput(agg), await completenessWeights());
  res.json({ property: presentProperty(agg, completeness), can: await permissionsFor(req, property.id, property.ownerId) });
}

/** GET /api/v1/properties/:propertyId/completeness */
export async function getCompleteness(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const agg = await loadAggregate(prisma, property.id);
  const input = completenessInput(agg);
  res.json({ completeness: computeCompleteness(input, await completenessWeights()), submissionProblems: submissionProblems(input) });
}

/** PATCH /api/v1/properties/:propertyId — basic info, location and building details. */
export async function updateProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const input = parseInput(updatePropertySchema, req.body);
  const decision = canEditContent(property, isModerator(req));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  checkVersion(property, input.version);
  const type = typeOf(property);

  const { version: _v, building, wizardStep, ...basic } = input;
  void _v;
  if (basic.listingType && !type.listingTypes.includes(basic.listingType)) fail("invalid-argument", REASONS.INVALID_INPUT, `${type.label} cannot be listed for ${basic.listingType.toLowerCase()}.`);

  const data: Prisma.PropertyUncheckedUpdateManyInput = { ...basic } as Prisma.PropertyUncheckedUpdateManyInput;
  const changed: Record<string, unknown> = { ...basic };
  if (building) {
    const values = parseInput(fieldsSchema(type.buildingFields), building) as Record<string, unknown>;
    const { columns, attributes } = splitValues(values, PROPERTY_COLUMNS);
    Object.assign(data, columns);
    if (Object.keys(attributes).length) data.attributes = mergeAttributes(property.attributes, attributes) as Prisma.InputJsonValue;
    Object.assign(changed, columns, attributes);
  }
  if (wizardStep && wizardStep > property.wizardStep) data.wizardStep = wizardStep;

  const before = flatValues(property as unknown as Record<string, unknown>);
  const delta = diff(before, changed);
  const changedFields = Object.keys(delta.new).map((k) => (k in basic ? k : "building"));
  const nextPublication = publicationAfterEdit(property, changedFields);

  // Nothing in the listing changed (e.g. only the wizard progress moved): don't bump `version`,
  // otherwise the open form would hold a stale version and its next save would conflict.
  if (!Object.keys(delta.new).length && nextPublication === property.publicationStatus) {
    if (data.wizardStep) await prisma.property.update({ where: { id: property.id }, data: { wizardStep: data.wizardStep } });
    res.locals.message = "Property updated successfully";
    res.json({ property: presentProperty(await loadAggregate(prisma, property.id)) });
    return;
  }

  await withProperty(property.id, async (tx) => {
    if (nextPublication !== property.publicationStatus) {
      data.publicationStatus = nextPublication;
      data.verificationStatus = "PENDING";
      data.submittedAt = new Date();
    }
    await updateWithVersion(tx, property.id, property.version, data);
    if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "property.update", oldValue: delta.old, newValue: delta.new });
    if (nextPublication !== property.publicationStatus) {
      await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "publicationStatus", from: property.publicationStatus, to: nextPublication, reason: "Listing details changed — re-verification required." });
    }
  });
  res.locals.message = nextPublication !== property.publicationStatus ? "Saved. The changes will be visible after SafeRent verifies them." : "Property updated successfully";
  res.json({ property: presentProperty(await loadAggregate(prisma, property.id)) });
}

async function hasActiveLeases(propertyId: string): Promise<boolean> {
  return (await prisma.lease.count({ where: { propertyId, status: "ACTIVE" } })) > 0;
}

/** Moderators act on any property; everyone else within their properties.manage scope. */
async function loadForStatus(req: Request) {
  if (isModerator(req) || isPropertyAdmin(req)) return found(await prisma.property.findFirst({ where: propertyKey(req) }), "Property");
  return scopedProperty(req, "properties.manage");
}

async function changeActive(req: Request, res: Response, to: (typeof ACTIVE_STATUSES)[number], reason?: string): Promise<void> {
  const property = await loadForStatus(req);
  // Moderators without management rights on this property may only suspend / lift a suspension.
  const suspension = to === "SUSPENDED" || property.activeStatus === "SUSPENDED";
  if (!suspension && !isPropertyAdmin(req) && !(await inScope(req, "properties.manage", property.id))) {
    fail("permission-denied", REASONS.PERMISSION_DENIED, "You can only suspend or reinstate this property.");
  }
  const decision = canChangeActiveStatus(property.activeStatus, to, { isModerator: isModerator(req), isAdmin: isPropertyAdmin(req) }, await hasActiveLeases(property.id));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  await withProperty(property.id, async (tx) => {
    await updateWithVersion(tx, property.id, property.version, {
      activeStatus: to,
      archivedAt: to === "ARCHIVED" ? new Date() : to === "ACTIVE" ? null : undefined,
      moderationNote: to === "SUSPENDED" ? (reason ?? null) : undefined,
    });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "activeStatus", from: property.activeStatus, to, reason });
  });
  if (property.ownerId !== me(req).id) await notify(property.ownerId, `Property ${to.toLowerCase()}`, `"${property.title ?? property.code}" is now ${to.toLowerCase()}${reason ? `: ${reason}` : "."}`, `/properties/${property.id}`);
  res.locals.message = `Property ${to.toLowerCase()}`;
  res.json({ property: propertySummary((await prisma.property.findUniqueOrThrow({ where: { id: property.id } }))) });
}

/** POST /api/v1/properties/:propertyId/status — ACTIVE / INACTIVE / SUSPENDED / ARCHIVED. */
export async function changeStatus(req: Request, res: Response): Promise<void> {
  const input = parseInput(statusChangeSchema, req.body);
  await changeActive(req, res, input.activeStatus, input.reason);
}

/**
 * DELETE /api/v1/properties/:propertyId
 *  - A draft that was never submitted and has no tenant activity is deleted permanently (with its photos
 *    and documents). The audit entries are kept.
 *  - Anything else is archived (soft delete): records and history stay.
 */
export async function archiveProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const neverSubmitted = property.publicationStatus === "DRAFT" && !property.submittedAt && property.activeStatus !== "SUSPENDED";
  if (neverSubmitted) {
    const [leases, applications, maintenance] = await Promise.all([
      prisma.lease.count({ where: { propertyId: property.id } }),
      prisma.rentalApplication.count({ where: { propertyId: property.id } }),
      prisma.maintenanceRequest.count({ where: { propertyId: property.id } }),
    ]);
    if (leases + applications + maintenance === 0) {
      const [images, documents] = await Promise.all([
        prisma.propertyImage.findMany({ where: { propertyId: property.id }, select: { filePath: true } }),
        prisma.propertyDocument.findMany({ where: { propertyId: property.id }, select: { filePath: true } }),
      ]);
      await prisma.$transaction(async (tx) => {
        await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "property.delete_draft", oldValue: { code: property.code, title: property.title } });
        await tx.property.delete({ where: { id: property.id } });
      });
      await Promise.all([...images, ...documents].map((f) => storage.remove(f.filePath)));
      res.locals.message = "Draft deleted";
      res.json({ deleted: true, archived: false });
      return;
    }
  }
  await changeActive(req, res, "ARCHIVED", "Archived by user.");
}

/** POST /api/v1/properties/:propertyId/submit — send for SafeRent verification. */
export async function submitProperty(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.manage");
  const decision = canSubmit(property);
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  const agg = await loadAggregate(prisma, property.id);
  const problems = submissionProblems(completenessInput(agg));
  if (problems.length) fail("failed-precondition", REASONS.INVALID_STATE, "Complete the required details before submitting.", { problems });
  await withProperty(property.id, async (tx) => {
    await updateWithVersion(tx, property.id, property.version, { publicationStatus: "PENDING_VERIFICATION", verificationStatus: "PENDING", submittedAt: new Date(), moderationNote: null, wizardStep: 12 });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "publicationStatus", from: property.publicationStatus, to: "PENDING_VERIFICATION" });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "verificationStatus", from: property.verificationStatus, to: "PENDING" });
  });
  res.locals.message = "Submitted for verification";
  res.json({ property: propertySummary(await prisma.property.findUniqueOrThrow({ where: { id: property.id } })) });
}

/**
 * Fraud gate: a listing goes live only for a verified owner (DigiLocker + selfie, approved by staff)
 * and — at approval — with a verified ownership document (sale deed / tax receipt / power bill).
 */
async function assertOwnerVerified(property: { id: string; ownerId: string }, needProof: boolean): Promise<void> {
  const owner = await prisma.landlordProfile.findUnique({ where: { userId: property.ownerId }, select: { kycStatus: true } });
  if (owner?.kycStatus !== "APPROVED") fail("failed-precondition", REASONS.INVALID_STATE, "The owner isn't verified yet. Verify the owner first (Owner verification).");
  if (!needProof) return;
  const proof = await prisma.propertyDocument.count({ where: { propertyId: property.id, needsVerification: true, status: "APPROVED", isCurrent: true, archivedAt: null } });
  if (!proof) fail("failed-precondition", REASONS.INVALID_STATE, "Verify an ownership document (sale deed, property tax receipt or electricity bill) for this property first.");
}

/** POST /api/v1/properties/:propertyId/review — approve or reject (moderators; never your own property). */
export async function reviewProperty(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findFirst({ where: propertyKey(req) }), "Property");
  const user = me(req);
  if (property.ownerId === user.id || property.createdById === user.id) fail("permission-denied", REASONS.PERMISSION_DENIED, "You cannot verify a property you own or created.");
  const { decision, reason } = parseInput(reviewSchema, req.body);
  const allowed = canReview(property);
  if (!allowed.ok) fail("failed-precondition", REASONS.INVALID_STATE, allowed.reason);
  const approve = decision === "APPROVE";
  if (approve) await assertOwnerVerified(property, true);
  await withProperty(property.id, async (tx) => {
    await updateWithVersion(tx, property.id, property.version, {
      publicationStatus: approve ? "APPROVED" : "REJECTED",
      verificationStatus: approve ? "VERIFIED" : "REJECTED",
      moderationNote: approve ? null : reason,
      reviewedById: user.id,
      reviewedAt: new Date(),
    });
    if (approve) await tx.propertyImage.updateMany({ where: { propertyId: property.id, status: "PENDING" }, data: { status: "APPROVED", reviewedById: user.id } });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "publicationStatus", from: property.publicationStatus, to: approve ? "APPROVED" : "REJECTED", reason });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "verificationStatus", from: property.verificationStatus, to: approve ? "VERIFIED" : "REJECTED", reason });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: approve ? "verification.approve" : "verification.reject", newValue: { reason: reason ?? null } });
  });
  await notify(
    property.ownerId,
    approve ? "Your property was approved 🎉" : "Your property needs changes",
    approve ? `"${property.title ?? property.code}" is verified. Publish it to make it visible to tenants.` : `"${property.title ?? property.code}": ${reason}`,
    `/properties/${property.id}`,
  );
  if (approve) await evaluateForUser(property.ownerId);
  res.locals.message = approve ? "Property approved" : "Property rejected";
  res.json({ property: propertySummary(await prisma.property.findUniqueOrThrow({ where: { id: property.id } })) });
}

async function setPublished(req: Request, res: Response, publish: boolean): Promise<void> {
  const property = isModerator(req) ? found(await prisma.property.findFirst({ where: propertyKey(req) }), "Property") : await scopedProperty(req, "properties.manage");
  const decision = publish ? canPublish(property) : canUnpublish(property);
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  if (publish) await assertOwnerVerified(property, false);
  const to = publish ? "PUBLISHED" : "APPROVED";
  await withProperty(property.id, async (tx) => {
    await updateWithVersion(tx, property.id, property.version, { publicationStatus: to, publishedAt: publish ? new Date() : undefined });
    await recordStatus(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, field: "publicationStatus", from: property.publicationStatus, to });
  });
  res.locals.message = publish ? "Property published" : "Property unpublished";
  res.json({ property: propertySummary(await prisma.property.findUniqueOrThrow({ where: { id: property.id } })) });
}

/** POST /api/v1/properties/:propertyId/publish — only after approval. */
export const publishProperty = (req: Request, res: Response) => setPublished(req, res, true);
/** POST /api/v1/properties/:propertyId/unpublish */
export const unpublishProperty = (req: Request, res: Response) => setPublished(req, res, false);

/** POST /api/v1/properties/:propertyId/transfer-ownership — admins only; never managers. */
export async function transferOwnership(req: Request, res: Response): Promise<void> {
  if (!isPropertyAdmin(req) || !can(req, "users.manage")) fail("permission-denied", REASONS.PERMISSION_DENIED, "Only SafeRent admins can change property ownership.");
  const property = found(await prisma.property.findFirst({ where: propertyKey(req) }), "Property");
  const { newOwnerId, reason } = parseInput(transferOwnershipSchema, req.body);
  if (newOwnerId === property.ownerId) fail("invalid-argument", REASONS.INVALID_INPUT, "This user already owns the property.");
  const owner = await prisma.user.findFirst({ where: { AND: [{ id: newOwnerId, accountStatus: "ACTIVE" }, hasRoleWhere("LANDLORD")] }, select: { id: true } });
  if (!owner) fail("invalid-argument", REASONS.INVALID_INPUT, "The new owner must be an active landlord.");
  if (await hasActiveLeases(property.id)) fail("failed-precondition", REASONS.INVALID_STATE, "End or migrate the active leases before transferring ownership.");
  await withProperty(property.id, async (tx) => {
    await updateWithVersion(tx, property.id, property.version, { ownerId: newOwnerId });
    await audit(tx, req, { propertyId: property.id, entityType: "PROPERTY", entityId: property.id, action: "ownership.transfer", oldValue: { ownerId: property.ownerId }, newValue: { ownerId: newOwnerId, reason } });
  });
  await notify(newOwnerId, "A property was transferred to you", `"${property.title ?? property.code}" is now owned by your account.`, `/properties/${property.id}`);
  await notify(property.ownerId, "Property ownership changed", `"${property.title ?? property.code}" was transferred to another landlord: ${reason}`);
  res.json({ ok: true });
}

/** GET /api/v1/properties/summary — landlord / manager / admin dashboard numbers for the caller's scope. */
export async function propertySummaryStats(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const scope = propertyWhere(user, "properties.view");
  if (!scope) fail("permission-denied", REASONS.PERMISSION_DENIED, "You don't have permission to view properties.");
  const notArchived = and<Prisma.PropertyWhereInput>(scope, { activeStatus: { not: "ARCHIVED" } });
  const [byPublication, totals, unread] = await Promise.all([
    prisma.property.groupBy({ by: ["publicationStatus"], where: notArchived, _count: { _all: true } }),
    prisma.property.aggregate({ where: notArchived, _sum: { availableCount: true, occupiedCount: true }, _count: { _all: true } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  const counts = Object.fromEntries(PUBLICATION_STATUSES.map((s) => [s, byPublication.find((b) => b.publicationStatus === s)?._count._all ?? 0]));

  let rent: Record<string, unknown> | null = null;
  const rentScope = rentWhere(user, "rent.view");
  if (rentScope) {
    const period = new Date().toISOString().slice(0, 7);
    const [due, paid, overdue] = await Promise.all([
      prisma.rentPayment.aggregate({ where: and(rentScope, { period, landlordId: user.id }), _sum: { amount: true }, _count: { _all: true } }),
      prisma.rentPayment.aggregate({ where: and(rentScope, { period, landlordId: user.id, status: "PAID" }), _sum: { amount: true }, _count: { _all: true } }),
      prisma.rentPayment.aggregate({ where: and(rentScope, { landlordId: user.id, status: "OVERDUE" }), _sum: { amount: true }, _count: { _all: true } }),
    ]);
    rent = {
      period,
      expected: due._sum.amount ?? "0",
      collected: paid._sum.amount ?? "0",
      overdue: overdue._sum.amount ?? "0",
      overdueCount: overdue._count._all,
    };
  }
  res.json({
    properties: { total: totals._count._all, ...counts },
    units: { available: totals._sum.availableCount ?? 0, occupied: totals._sum.occupiedCount ?? 0 },
    rent,
    unreadNotifications: unread,
  });
}

/** GET /api/v1/properties/review-queue — verification work for moderators / document verifiers. */
export async function reviewQueue(req: Request, res: Response): Promise<void> {
  const user = me(req);
  const docScope = propertyWhere(user, "documents.verify");
  const [properties, documents, images] = await Promise.all([
    isModerator(req)
      ? prisma.property.findMany({
          where: { publicationStatus: "PENDING_VERIFICATION", activeStatus: "ACTIVE" },
          include: { owner: { select: { id: true, fullName: true } }, images: { select: { id: true, status: true }, take: 1 } },
          orderBy: { submittedAt: "asc" },
          take: 50,
        })
      : [],
    docScope
      ? prisma.propertyDocument.findMany({ where: { status: "PENDING", needsVerification: true, isCurrent: true, archivedAt: null, property: docScope }, include: { property: { select: { id: true, code: true, title: true } } }, orderBy: { createdAt: "asc" }, take: 50 })
      : [],
    isModerator(req)
      ? prisma.propertyImage.findMany({ where: { status: "PENDING", property: { publicationStatus: { in: ["APPROVED", "PUBLISHED"] } } }, include: { property: { select: { id: true, code: true, title: true } } }, orderBy: { createdAt: "asc" }, take: 60 })
      : [],
  ]);
  res.json({
    properties: properties.map(propertySummary),
    documents: documents.map((d) => ({ id: d.id, code: d.code, docType: d.docType, originalName: d.originalName, createdAt: d.createdAt, property: d.property })),
    images: images.map((i) => ({ id: i.id, category: i.category, createdAt: i.createdAt, property: i.property })),
  });
}

/** GET /api/v1/properties/:propertyId/status-history */
export async function statusHistory(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const p = pagination(req);
  const where = { propertyId: property.id };
  const [items, total] = await Promise.all([
    prisma.propertyStatusHistory.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.propertyStatusHistory.count({ where }),
  ]);
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.actorId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
  res.json(paged(items.map((i) => ({ ...i, actor: actors.find((a) => a.id === i.actorId) ?? null })), total, p));
}

/** GET /api/v1/properties/:propertyId/audit — immutable change history (read-only). */
export async function auditHistory(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const p = pagination(req);
  const where = { propertyId: property.id };
  const [items, total] = await Promise.all([
    prisma.propertyAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: p.skip, take: p.take }),
    prisma.propertyAuditLog.count({ where }),
  ]);
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.performedById).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
  res.json(paged(items.map((i) => ({ ...i, id: i.id.toString(), actor: actors.find((a) => a.id === i.performedById) ?? null })), total, p));
}

/** GET /api/v1/settings/completeness-weights */
export async function getCompletenessWeights(_req: Request, res: Response): Promise<void> {
  res.json({ weights: await completenessWeights(), defaults: DEFAULT_COMPLETENESS_WEIGHTS });
}

const weightsSchema = z
  .object(Object.fromEntries(Object.keys(DEFAULT_COMPLETENESS_WEIGHTS).map((k) => [k, z.number().min(0).max(100)])) as Record<keyof typeof DEFAULT_COMPLETENESS_WEIGHTS, z.ZodNumber>)
  .strict()
  .refine((w) => Math.round(Object.values(w).reduce((a, b) => a + b, 0)) === 100, { message: "Weights must add up to 100." });

/** PUT /api/v1/settings/completeness-weights — Super Admin (settings.manage). Scores refresh on the next change of each property. */
export async function putCompletenessWeights(req: Request, res: Response): Promise<void> {
  const weights = parseInput(weightsSchema, req.body);
  const before = await completenessWeights();
  await prisma.platformSetting.upsert({ where: { key: "completeness_weights" }, create: { key: "completeness_weights", value: JSON.stringify(weights), updatedById: me(req).id }, update: { value: JSON.stringify(weights), updatedById: me(req).id } });
  await logActivity(req, "settings.completeness_weights", "platform_setting", "completeness_weights", { before, after: weights });
  invalidateWeights();
  res.json({ weights });
}

/** GET /api/v1/property-types/manage — every type with its on/off switch and listing count (property_types.manage). */
export async function listManagedPropertyTypes(_req: Request, res: Response): Promise<void> {
  const [rows, counts] = await Promise.all([
    prisma.propertyTypeDefinition.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }], select: { key: true, label: true, category: true, structure: true, active: true, updatedAt: true } }),
    prisma.property.groupBy({ by: ["propertyTypeKey"], _count: { _all: true } }),
  ]);
  res.json({
    items: rows.map((r) => ({
      key: r.key,
      label: r.label,
      category: r.category,
      structure: r.structure,
      enabled: r.active,
      propertyCount: counts.find((c) => c.propertyTypeKey === r.key)?._count._all ?? 0,
      updatedAt: r.updatedAt,
    })),
  });
}

const typeToggleSchema = z.object({ enabled: z.boolean() }).strict();

/**
 * PATCH /api/v1/property-types/:typeKey — turn a type on or off (property_types.manage).
 * Turning a type off only stops new listings; existing ones keep working.
 */
export async function setPropertyTypeEnabled(req: Request, res: Response): Promise<void> {
  const { enabled } = parseInput(typeToggleSchema, req.body);
  const row = found(await prisma.propertyTypeDefinition.findUnique({ where: { key: String(req.params.typeKey) } }), "Property type");
  if (row.active !== enabled) {
    await prisma.propertyTypeDefinition.update({ where: { key: row.key }, data: { active: enabled } });
    await logActivity(req, enabled ? "property_type.enable" : "property_type.disable", "property_type", row.key, { label: row.label, before: row.active, after: enabled });
  }
  res.locals.message = `${row.label} ${enabled ? "enabled" : "disabled"} for new listings`;
  res.json({ key: row.key, label: row.label, enabled });
}
