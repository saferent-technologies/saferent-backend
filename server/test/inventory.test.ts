import { describe, expect, it } from "vitest";
import { itemCreateSchema, repairCreateSchema, workingStatusAfterRepair } from "../src/lib/inventory";

describe("furniture register", () => {
  it("item: name required, sensible defaults", () => {
    const v = itemCreateSchema.parse({ name: "Sofa", category: "LIVING_ROOM" });
    expect(v).toMatchObject({ quantity: 1, condition: "GOOD", workingStatus: "WORKING" });
    expect(itemCreateSchema.safeParse({ name: "S" }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ name: "Sofa", unknown: 1 }).success).toBe(false);
  });
  it("item: a flat or a room, not both; no future purchase date", () => {
    const u = "11111111-1111-4111-8111-111111111111";
    expect(itemCreateSchema.safeParse({ name: "Bed", unitId: u, roomId: u }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ name: "AC", purchaseDate: "2999-01-01" }).success).toBe(false);
    expect(itemCreateSchema.safeParse({ name: "AC", purchaseDate: "2024-05-01", serialNumber: "", brand: "LG" }).success).toBe(true);
  });
  it("repair: description and date required", () => {
    expect(repairCreateSchema.safeParse({ repairDate: "2026-11-01", description: "Gas refill", cost: 2500, paidBy: "OWNER" }).success).toBe(true);
    expect(repairCreateSchema.safeParse({ description: "Gas refill" }).success).toBe(false);
  });
  it("working status follows repairs", () => {
    expect(workingStatusAfterRepair("WORKING", "OPEN")).toBe("NEEDS_REPAIR");
    expect(workingStatusAfterRepair("NOT_WORKING", "OPEN")).toBe("NOT_WORKING");
    expect(workingStatusAfterRepair("NEEDS_REPAIR", "DONE")).toBe("WORKING");
  });
});
