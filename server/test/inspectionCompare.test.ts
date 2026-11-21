import { describe, expect, it } from "vitest";
import { change, compareInspections } from "../src/lib/inspectionCompare";

const base = { id: "a", inspectionDate: null, status: "COMPLETED", existingDamages: null, repairRequirements: null, propertyCondition: "GOOD", wallCondition: "GOOD", kitchenCondition: "FAIR" };

describe("inspection comparison", () => {
  it("condition change", () => {
    expect(change("GOOD", "POOR")).toBe("WORSE");
    expect(change("FAIR", "GOOD")).toBe("BETTER");
    expect(change("GOOD", "NOT_INSPECTED")).toBe("NOT_COMPARABLE");
  });
  it("areas, items, meter, keys", () => {
    const r = compareInspections(
      { ...base, handoverMeterReading: "1000.5", keysHandedOver: 3, furnitureInventory: [{ item: "Sofa", quantity: 1, condition: "GOOD" }, { item: "Chair", quantity: 4, condition: "GOOD" }], applianceInventory: [{ item: "Fridge", quantity: 1, condition: "GOOD", inventoryItemId: "f1" }] },
      { ...base, id: "b", wallCondition: "POOR", handoverMeterReading: "1450", keysHandedOver: 2, furnitureInventory: [{ item: "sofa", quantity: 1, condition: "FAIR" }, { item: "Chair", quantity: 3, condition: "GOOD" }, { item: "Rug", quantity: 1, condition: "GOOD" }], applianceInventory: [{ item: "Refrigerator", quantity: 1, condition: "POOR", inventoryItemId: "f1" }] },
    );
    expect(r.areas.find((a) => a.key === "wallCondition")!.change).toBe("WORSE");
    expect(r.furniture.find((i) => i.item === "Sofa")!.change).toBe("WORSE");
    expect(r.furniture.find((i) => i.item === "Chair")).toMatchObject({ change: "MISSING", missing: 1 });
    expect(r.furniture.find((i) => i.item === "Rug")!.change).toBe("ADDED");
    expect(r.appliances[0]!.change).toBe("WORSE");
    expect(r.meter.used).toBe(449.5);
    expect(r.keys.missing).toBe(1);
    expect(r.summary).toMatchObject({ areasWorse: 1, itemsMissing: 1, itemsWorse: 2, hasIssues: true });
  });
});
