import { describe, expect, it } from "vitest";
import { approvalSchema, monthlyMaintenance, parkingSlotSchema, societySchema } from "../src/lib/society";

describe("society", () => {
  it("maintenance needs a frequency; tenant-paid needs pay-to", () => {
    expect(societySchema.safeParse({ maintenanceAmount: 3000, maintenanceFrequency: "MONTHLY", maintenancePaidBy: "TENANT", maintenancePayTo: "SOCIETY" }).success).toBe(true);
    expect(societySchema.safeParse({ maintenanceAmount: 3000 }).success).toBe(false);
    expect(societySchema.safeParse({ maintenancePaidBy: "TENANT" }).success).toBe(false);
    expect(societySchema.safeParse({ maintenancePaidBy: "OWNER", maintenancePayTo: "SOCIETY" }).success).toBe(false);
  });
  it("contacts, gate, move rules", () => {
    expect(societySchema.safeParse({ contactPhone: "+919876543210" }).success).toBe(false);
    expect(societySchema.safeParse({ gateAccessMethods: ["MYGATE", "MYGATE"] }).success).toBe(false);
    expect(societySchema.safeParse({ moveRequiresPermission: false, moveChargeAmount: 1000 }).success).toBe(false);
    expect(societySchema.safeParse({ commonAreas: [{ name: "Gym", timings: "6 AM - 10 PM" }], rules: [{ title: "No parking on the ramp" }] }).success).toBe(true);
  });
  it("parking and approval", () => {
    expect(parkingSlotSchema.parse({ slotNumber: "B1-23" })).toMatchObject({ vehicleType: "CAR", covered: false });
    expect(approvalSchema.safeParse({ status: "APPROVED" }).success).toBe(false);
    expect(approvalSchema.safeParse({ status: "REJECTED", date: "2026-11-20" }).success).toBe(false);
    expect(approvalSchema.safeParse({ status: "PENDING" }).success).toBe(true);
  });
  it("monthly equivalent", () => {
    expect(monthlyMaintenance(9000, "QUARTERLY")).toBe(3000);
    expect(monthlyMaintenance(null, "MONTHLY")).toBeNull();
  });
});
