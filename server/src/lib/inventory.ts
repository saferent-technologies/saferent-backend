import { z } from "zod";

/** Furniture & appliance register: pure schemas (unit tested in test/inventory.test.ts). */

export const INVENTORY_CATEGORIES = ["BEDROOM", "LIVING_ROOM", "KITCHEN", "BATHROOM", "APPLIANCES", "OTHER"] as const;
export const CONDITIONS = ["GOOD", "FAIR", "POOR", "NOT_APPLICABLE", "NOT_INSPECTED"] as const;
export const WORKING_STATUSES = ["WORKING", "NEEDS_REPAIR", "NOT_WORKING"] as const;
export const REPAIR_STATUSES = ["OPEN", "IN_PROGRESS", "DONE"] as const;
export const PAID_BY = ["OWNER", "TENANT", "SHARED"] as const;
export const MAX_ITEMS_PER_PROPERTY = 500;
export const MAX_PHOTOS_PER_ITEM = 6;

/** Suggested items per category (apps show them as quick-add chips). */
export const INVENTORY_SUGGESTIONS: Record<(typeof INVENTORY_CATEGORIES)[number], string[]> = {
  BEDROOM: ["Bed", "Mattress", "Wardrobe", "Side table", "Dressing table", "Study table", "Chair"],
  LIVING_ROOM: ["Sofa", "TV", "TV unit", "Coffee table", "Dining table", "Dining chairs", "Curtains", "Shoe rack"],
  KITCHEN: ["Refrigerator", "Gas stove", "Chimney", "Microwave", "Water purifier", "Kitchen cabinets"],
  BATHROOM: ["Mirror", "Geyser", "Exhaust fan", "Towel rack"],
  APPLIANCES: ["AC", "Washing machine", "Geyser", "Ceiling fan", "Inverter", "Water purifier"],
  OTHER: [],
};

const optText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal("").transform(() => null));
const day = z.coerce.date().refine((d) => d.getTime() <= Date.now() + 86_400_000, "The date can't be in the future.");
const uuid = z.string().uuid().nullable().optional().or(z.literal("").transform(() => null));

export const itemCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    category: z.enum(INVENTORY_CATEGORIES).default("OTHER"),
    quantity: z.coerce.number().int().min(1).max(500).default(1),
    brand: optText(80),
    model: optText(80),
    purchaseDate: day.nullable().optional().or(z.literal("").transform(() => null)),
    condition: z.enum(CONDITIONS).default("GOOD"),
    workingStatus: z.enum(WORKING_STATUSES).default("WORKING"),
    serialNumber: optText(80),
    notes: optText(500),
    unitId: uuid,
    roomId: uuid,
  })
  .strict()
  .refine((v) => !(v.unitId && v.roomId), { message: "Choose a flat or a room, not both.", path: ["roomId"] });

export const itemUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    category: z.enum(INVENTORY_CATEGORIES).optional(),
    quantity: z.coerce.number().int().min(1).max(500).optional(),
    brand: optText(80),
    model: optText(80),
    purchaseDate: day.nullable().optional().or(z.literal("").transform(() => null)),
    condition: z.enum(CONDITIONS).optional(),
    workingStatus: z.enum(WORKING_STATUSES).optional(),
    serialNumber: optText(80),
    notes: optText(500),
    unitId: uuid,
    roomId: uuid,
    displayOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => !(v.unitId && v.roomId), { message: "Choose a flat or a room, not both.", path: ["roomId"] });

export const repairCreateSchema = z
  .object({
    repairDate: day,
    description: z.string().trim().min(3).max(1000),
    cost: z.coerce.number().min(0).max(10_000_000).multipleOf(0.01).nullable().optional(),
    paidBy: z.enum(PAID_BY).default("OWNER"),
    doneBy: optText(120),
    status: z.enum(REPAIR_STATUSES).default("DONE"),
  })
  .strict();

export const repairUpdateSchema = z
  .object({
    repairDate: day.optional(),
    description: z.string().trim().min(3).max(1000).optional(),
    cost: z.coerce.number().min(0).max(10_000_000).multipleOf(0.01).nullable().optional(),
    paidBy: z.enum(PAID_BY).optional(),
    doneBy: optText(120),
    status: z.enum(REPAIR_STATUSES).optional(),
  })
  .strict();

/** Working status the item gets from its open repairs: an open repair means it needs repair. */
export function workingStatusAfterRepair(current: (typeof WORKING_STATUSES)[number], repairStatus: (typeof REPAIR_STATUSES)[number]): (typeof WORKING_STATUSES)[number] {
  if (repairStatus === "DONE") return current === "NOT_WORKING" || current === "NEEDS_REPAIR" ? "WORKING" : current;
  return current === "WORKING" ? "NEEDS_REPAIR" : current;
}
