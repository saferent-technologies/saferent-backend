import type { Prisma, Property } from "@prisma/client";
import type { Request, Response } from "express";
import { REASONS } from "../../config/constants";
import { fail } from "../../lib/errors";
import { found } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { parseInput } from "../../lib/validation";
import { costBreakdown, type ChargeLike } from "../costs";
import { amenitiesSchema, policiesSchema, policyProblems, pricingSchema, utilitiesSchema, utilityProblems } from "../schemas";
import { audit, diff, isModerator, scopedProperty, withProperty, type Tx } from "../service";
import { canEditContent } from "../workflow";

const PROPERTY_SCOPE = "PROPERTY";

async function editable(req: Request) {
  const property = await scopedProperty(req, "properties.manage");
  const decision = canEditContent(property, isModerator(req));
  if (!decision.ok) fail("failed-precondition", REASONS.INVALID_STATE, decision.reason);
  return property;
}

/** Resolves the optional :unitId into a scope key, checking the unit belongs to the property. */
async function scopeKeyFor(req: Request, propertyId: string): Promise<{ scopeKey: string; unitId: string | null }> {
  const unitId = req.params.unitId ? String(req.params.unitId) : "";
  if (!unitId) return { scopeKey: PROPERTY_SCOPE, unitId: null };
  const unit = found(await prisma.propertyUnit.findFirst({ where: { OR: [{ id: unitId }, { code: unitId }], propertyId }, select: { id: true } }), "Unit");
  return { scopeKey: unit.id, unitId: unit.id };
}

// ───── Utilities ─────

/** GET /api/v1/properties/:propertyId/utilities  (and …/units/:unitId/utilities) */
export async function getUtilities(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const { scopeKey } = await scopeKeyFor(req, property.id);
  const utilities = await prisma.propertyUtility.findUnique({ where: { propertyId_scopeKey: { propertyId: property.id, scopeKey } } });
  res.json({ utilities });
}

/** PUT /api/v1/properties/:propertyId/utilities — partial update; cross-field rules are checked on the merged record. */
export async function putUtilities(req: Request, res: Response): Promise<void> {
  const property = await editable(req);
  const { scopeKey, unitId } = await scopeKeyFor(req, property.id);
  const input = parseInput(utilitiesSchema, req.body);
  const current = await prisma.propertyUtility.findUnique({ where: { propertyId_scopeKey: { propertyId: property.id, scopeKey } } });
  const merged = { ...(current ?? {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const problems = utilityProblems(merged);
  if (problems.length) fail("invalid-argument", REASONS.INVALID_INPUT, problems[0]!, { problems });
  if (input.meterReadingImageId) {
    const image = await prisma.propertyImage.count({ where: { id: input.meterReadingImageId, propertyId: property.id } });
    if (!image) fail("invalid-argument", REASONS.INVALID_INPUT, "The meter reading photo must be uploaded to this property first.");
  }
  const data = input as Prisma.PropertyUtilityUncheckedUpdateInput;
  const delta = diff((current ?? {}) as Record<string, unknown>, input as Record<string, unknown>);
  const saved = await withProperty(property.id, async (tx) => {
    const row = await tx.propertyUtility.upsert({
      where: { propertyId_scopeKey: { propertyId: property.id, scopeKey } },
      create: { ...(input as Prisma.PropertyUtilityUncheckedCreateInput), propertyId: property.id, unitId, scopeKey },
      update: data,
    });
    if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "UTILITY", entityId: row.id, action: "utilities.update", oldValue: delta.old, newValue: delta.new });
    return row;
  });
  res.locals.message = "Utilities saved";
  res.json({ utilities: saved });
}

// ───── Policies ─────

/** GET /api/v1/properties/:propertyId/policies */
export async function getPolicies(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  res.json({ policy: await prisma.propertyPolicy.findUnique({ where: { propertyId: property.id } }) });
}

/** PUT /api/v1/properties/:propertyId/policies */
export async function putPolicies(req: Request, res: Response): Promise<void> {
  const property = await editable(req);
  const input = parseInput(policiesSchema, req.body);
  const current = await prisma.propertyPolicy.findUnique({ where: { propertyId: property.id } });
  const merged = { ...(current ?? {}), ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const problems = policyProblems(merged);
  if (problems.length) fail("invalid-argument", REASONS.INVALID_INPUT, problems[0]!, { problems });
  const { additionalRules, ...rest } = input;
  const json = additionalRules === undefined ? {} : { additionalRules: (additionalRules ?? []) as Prisma.InputJsonValue };
  const delta = diff((current ?? {}) as Record<string, unknown>, input as Record<string, unknown>);
  const saved = await withProperty(property.id, async (tx) => {
    const row = await tx.propertyPolicy.upsert({
      where: { propertyId: property.id },
      create: { ...(rest as Prisma.PropertyPolicyUncheckedCreateInput), ...json, propertyId: property.id },
      update: { ...(rest as Prisma.PropertyPolicyUncheckedUpdateInput), ...json },
    });
    if (Object.keys(delta.new).length) await audit(tx, req, { propertyId: property.id, entityType: "POLICY", entityId: property.id, action: "policies.update", oldValue: delta.old, newValue: delta.new });
    return row;
  });
  res.locals.message = "Policies saved";
  res.json({ policy: saved });
}

// ───── Amenities ─────

/** PUT /api/v1/properties/:propertyId/amenities — replaces the amenity list of the property (or one unit). */
export async function putAmenities(req: Request, res: Response): Promise<void> {
  const property = await editable(req);
  const input = parseInput(amenitiesSchema, req.body);
  let scopeKey = PROPERTY_SCOPE;
  let unitId: string | null = null;
  if (input.unitId) {
    const unit = found(await prisma.propertyUnit.findFirst({ where: { id: input.unitId, propertyId: property.id }, select: { id: true } }), "Unit");
    scopeKey = unit.id;
    unitId = unit.id;
  }
  const catalog = await prisma.amenityDefinition.findMany({ where: { active: true } });
  const category = property.category;
  const rows: Prisma.PropertyAmenityCreateManyInput[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    const def = catalog.find((c) => c.key === item.key);
    if (!def) fail("invalid-argument", REASONS.INVALID_INPUT, `Unknown amenity: ${item.key}`);
    if (!(def.categories as string[]).includes(category)) fail("invalid-argument", REASONS.INVALID_INPUT, `${def.label} does not apply to ${category.toLowerCase()} properties.`);
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    rows.push({ propertyId: property.id, scopeKey, unitId, key: def.key, label: def.label, status: item.status, notes: item.notes ?? null });
  }
  for (const c of input.custom) {
    const slug = c.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const key = `custom:${slug}`;
    if (!slug || seen.has(key)) continue;
    seen.add(key);
    rows.push({ propertyId: property.id, scopeKey, unitId, key, label: c.label, status: c.status, notes: c.notes ?? null });
  }
  const before = await prisma.propertyAmenity.findMany({ where: { propertyId: property.id, scopeKey }, select: { key: true, status: true } });
  await withProperty(property.id, async (tx) => {
    await tx.propertyAmenity.deleteMany({ where: { propertyId: property.id, scopeKey } });
    if (rows.length) await tx.propertyAmenity.createMany({ data: rows });
    await audit(tx, req, { propertyId: property.id, entityType: "AMENITY", entityId: unitId ?? property.id, action: "amenities.update", oldValue: before, newValue: rows.map((r) => ({ key: r.key, status: r.status })) });
  });
  res.locals.message = "Amenities saved";
  res.json({ amenities: await prisma.propertyAmenity.findMany({ where: { propertyId: property.id, scopeKey }, orderBy: { label: "asc" } }) });
}

// ───── Pricing ─────

const CHARGE_LABELS: Record<string, string> = { MAINTENANCE: "Maintenance", ELECTRICITY: "Electricity", WATER: "Water", GAS: "Gas", PARKING: "Parking", INTERNET: "Internet", OTHER: "Other charges" };

/**
 * Validates and saves pricing for the property (unitId = null) or one unit, inside the caller's transaction.
 * Rent and deposit changes get their own audit actions.
 */
export async function savePricing(tx: Tx, req: Request, property: Property, unitId: string | null, body: unknown) {
  const input = parseInput(pricingSchema, body);
  const listing = property.listingType;
  if (listing === "SALE" && input.monthlyRent) fail("invalid-argument", REASONS.INVALID_INPUT, "A property listed for sale has a sale price, not a monthly rent.");
  if (listing !== "SALE" && input.salePrice) fail("invalid-argument", REASONS.INVALID_INPUT, "A sale price only applies to properties listed for sale.");
  const scopeKey = unitId ?? PROPERTY_SCOPE;
  const current = await tx.propertyPricing.findUnique({ where: { propertyId_scopeKey: { propertyId: property.id, scopeKey } }, include: { charges: true } });
  const { charges, ...core } = input;
  const row = await tx.propertyPricing.upsert({
    where: { propertyId_scopeKey: { propertyId: property.id, scopeKey } },
    create: { ...(core as Prisma.PropertyPricingUncheckedCreateInput), propertyId: property.id, unitId, scopeKey },
    update: core as Prisma.PropertyPricingUncheckedUpdateInput,
  });
  if (charges) {
    await tx.pricingCharge.deleteMany({ where: { pricingId: row.id } });
    if (charges.length) {
      await tx.pricingCharge.createMany({
        data: charges.map((c) => ({ pricingId: row.id, kind: c.kind, label: c.label ?? CHARGE_LABELS[c.kind]!, billing: c.billing, amount: c.amount ?? null, frequency: c.frequency ?? (c.billing === "FIXED_MONTHLY" ? "MONTHLY" : c.billing === "ONE_TIME" ? "ONE_TIME" : null), notes: c.notes ?? null })),
      });
    }
  }
  const delta = diff((current ?? {}) as Record<string, unknown>, core as Record<string, unknown>);
  const entityId = unitId ?? property.id;
  if (delta.new.monthlyRent !== undefined || delta.new.salePrice !== undefined) {
    await audit(tx, req, { propertyId: property.id, entityType: "PRICING", entityId, action: "pricing.rent_change", oldValue: { monthlyRent: delta.old.monthlyRent ?? null, salePrice: delta.old.salePrice ?? null }, newValue: { monthlyRent: delta.new.monthlyRent ?? null, salePrice: delta.new.salePrice ?? null } });
  }
  if (delta.new.securityDeposit !== undefined) {
    await audit(tx, req, { propertyId: property.id, entityType: "PRICING", entityId, action: "pricing.deposit_change", oldValue: { securityDeposit: delta.old.securityDeposit }, newValue: { securityDeposit: delta.new.securityDeposit } });
  }
  const other = Object.keys(delta.new).filter((k) => !["monthlyRent", "salePrice", "securityDeposit"].includes(k));
  if (other.length || charges) {
    await audit(tx, req, {
      propertyId: property.id,
      entityType: "PRICING",
      entityId,
      action: "pricing.update",
      oldValue: { ...Object.fromEntries(other.map((k) => [k, delta.old[k]])), ...(charges ? { charges: current?.charges.map((c) => ({ kind: c.kind, label: c.label, billing: c.billing, amount: c.amount })) ?? [] } : {}) },
      newValue: { ...Object.fromEntries(other.map((k) => [k, delta.new[k]])), ...(charges ? { charges } : {}) },
    });
  }
  return row;
}

async function pricingResponse(propertyId: string, scopeKey: string) {
  const [pricing, utility] = await Promise.all([
    prisma.propertyPricing.findUnique({ where: { propertyId_scopeKey: { propertyId, scopeKey } }, include: { charges: true } }),
    prisma.propertyUtility.findUnique({ where: { propertyId_scopeKey: { propertyId, scopeKey } } }).then(async (u) => u ?? (await prisma.propertyUtility.findUnique({ where: { propertyId_scopeKey: { propertyId, scopeKey: PROPERTY_SCOPE } } }))),
  ]);
  return { pricing, breakdown: pricing ? costBreakdown(pricing, pricing.charges as unknown as ChargeLike[], utility) : null };
}

/** GET /api/v1/properties/:propertyId/pricing  (and …/units/:unitId/pricing) */
export async function getPricing(req: Request, res: Response): Promise<void> {
  const property = await scopedProperty(req, "properties.view");
  const { scopeKey } = await scopeKeyFor(req, property.id);
  res.json(await pricingResponse(property.id, scopeKey));
}

/** PUT /api/v1/properties/:propertyId/pricing  (and …/units/:unitId/pricing) */
export async function putPricing(req: Request, res: Response): Promise<void> {
  const property = await editable(req);
  const { scopeKey, unitId } = await scopeKeyFor(req, property.id);
  await withProperty(property.id, (tx) => savePricing(tx, req, property, unitId, req.body));
  res.locals.message = "Pricing saved";
  res.json(await pricingResponse(property.id, scopeKey));
}
