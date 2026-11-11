import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { AMENITIES, DEFAULT_COMPLETENESS_WEIGHTS, PROPERTY_TYPES } from "./catalog";

/**
 * Syncs the property catalog (types + field schemas, amenities) from code into MySQL at startup.
 * Admin choices are preserved: `active` and the display label of existing rows are not overwritten.
 */
export async function syncPropertyCatalog(): Promise<void> {
  for (const [i, t] of PROPERTY_TYPES.entries()) {
    const schema = {
      category: t.category,
      unitKind: t.unitKind ?? null,
      unitLabel: t.unitLabel ?? null,
      listingTypes: t.listingTypes,
      floorWise: !!t.floorWise,
      buildingFields: t.buildingFields,
      unitFields: t.unitFields,
    } as unknown as Prisma.InputJsonValue;
    await prisma.propertyTypeDefinition.upsert({
      where: { key: t.key },
      create: { key: t.key, category: t.category, label: t.label, structure: t.structure, sortOrder: i, schema },
      update: { category: t.category, structure: t.structure, sortOrder: i, schema },
    });
  }
  for (const [i, a] of AMENITIES.entries()) {
    await prisma.amenityDefinition.upsert({
      where: { key: a.key },
      create: { key: a.key, label: a.label, categories: a.categories as unknown as Prisma.InputJsonValue, sortOrder: i },
      update: { categories: a.categories as unknown as Prisma.InputJsonValue, sortOrder: i },
    });
  }
  await prisma.platformSetting.upsert({
    where: { key: "completeness_weights" },
    create: { key: "completeness_weights", value: JSON.stringify(DEFAULT_COMPLETENESS_WEIGHTS) },
    update: {},
  });
}
