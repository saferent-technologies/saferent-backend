/** Move-in vs move-out inspection comparison (pure; unit tested in test/inspectionCompare.test.ts). */

export const AREAS = [
  ["propertyCondition", "Overall"],
  ["wallCondition", "Walls"],
  ["flooringCondition", "Flooring"],
  ["doorsAndWindows", "Doors & windows"],
  ["electricalCondition", "Electrical"],
  ["plumbingCondition", "Plumbing"],
  ["bathroomCondition", "Bathroom"],
  ["kitchenCondition", "Kitchen"],
  ["furnitureCondition", "Furniture"],
  ["applianceCondition", "Appliances"],
] as const;

const RANK: Record<string, number> = { GOOD: 3, FAIR: 2, POOR: 1 };

type Item = { item: string; quantity: number; condition: string; inventoryItemId?: string | null; workingStatus?: string | null };
export interface InspectionSide {
  id: string;
  inspectionDate: Date | null;
  status: string;
  existingDamages: string | null;
  handoverMeterReading: unknown;
  keysHandedOver: number | null;
  furnitureInventory: unknown;
  applianceInventory: unknown;
  repairRequirements: unknown;
  [k: string]: unknown;
}

/** WORSE / BETTER / SAME / NOT_COMPARABLE between two condition ratings. */
export function change(before: string | null | undefined, after: string | null | undefined): "WORSE" | "BETTER" | "SAME" | "NOT_COMPARABLE" {
  const a = RANK[before ?? ""], b = RANK[after ?? ""];
  if (!a || !b) return "NOT_COMPARABLE";
  return b < a ? "WORSE" : b > a ? "BETTER" : "SAME";
}

const key = (i: Item) => i.inventoryItemId || i.item.trim().toLowerCase();

function compareItems(before: Item[], after: Item[]) {
  const out: Array<{ item: string; before: { quantity: number; condition: string } | null; after: { quantity: number; condition: string } | null; change: string; missing: number }> = [];
  const afterMap = new Map(after.map((i) => [key(i), i]));
  for (const b of before) {
    const a = afterMap.get(key(b));
    afterMap.delete(key(b));
    const missing = Math.max(0, b.quantity - (a?.quantity ?? 0));
    out.push({ item: b.item, before: { quantity: b.quantity, condition: b.condition }, after: a ? { quantity: a.quantity, condition: a.condition } : null, change: !a ? "MISSING" : missing > 0 ? "MISSING" : change(b.condition, a.condition), missing });
  }
  for (const a of afterMap.values()) out.push({ item: a.item, before: null, after: { quantity: a.quantity, condition: a.condition }, change: "ADDED", missing: 0 });
  return out;
}

const list = (v: unknown) => (Array.isArray(v) ? (v as Item[]) : []);

export function compareInspections(moveIn: InspectionSide, moveOut: InspectionSide) {
  const areas = AREAS.map(([k, label]) => ({ key: k, label, before: (moveIn[k] as string) ?? null, after: (moveOut[k] as string) ?? null, change: change(moveIn[k] as string, moveOut[k] as string) }));
  const furniture = compareItems(list(moveIn.furnitureInventory), list(moveOut.furnitureInventory));
  const appliances = compareItems(list(moveIn.applianceInventory), list(moveOut.applianceInventory));
  const mIn = moveIn.handoverMeterReading == null ? null : Number(moveIn.handoverMeterReading);
  const mOut = moveOut.handoverMeterReading == null ? null : Number(moveOut.handoverMeterReading);
  const worse = areas.filter((a) => a.change === "WORSE").length;
  const missingItems = [...furniture, ...appliances].filter((i) => i.change === "MISSING").length;
  const worseItems = [...furniture, ...appliances].filter((i) => i.change === "WORSE").length;
  return {
    areas,
    furniture,
    appliances,
    meter: { moveIn: mIn, moveOut: mOut, used: mIn != null && mOut != null ? Math.round((mOut - mIn) * 100) / 100 : null },
    keys: { moveIn: moveIn.keysHandedOver, moveOut: moveOut.keysHandedOver, missing: moveIn.keysHandedOver != null && moveOut.keysHandedOver != null ? Math.max(0, moveIn.keysHandedOver - moveOut.keysHandedOver) : null },
    damages: { moveIn: moveIn.existingDamages, moveOut: moveOut.existingDamages },
    repairsAtMoveOut: list(moveOut.repairRequirements),
    summary: { areasWorse: worse, itemsMissing: missingItems, itemsWorse: worseItems, hasIssues: worse + missingItems + worseItems > 0 },
  };
}
