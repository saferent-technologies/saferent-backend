import { prisma } from "./prisma";

/**
 * Human label for what a lease covers: "Flat 102", "Villa 7", "Room 203 · Bed B1", or null for a
 * whole property. Looked up in one batch for a page of rows.
 */
export async function placeLabels(leases: Array<{ unitId: string | null; bedId: string | null }>): Promise<Map<string, string>> {
  const unitIds = [...new Set(leases.map((l) => l.unitId).filter((x): x is string => !!x))];
  const bedIds = [...new Set(leases.map((l) => l.bedId).filter((x): x is string => !!x))];
  const [units, beds] = await Promise.all([
    unitIds.length ? prisma.propertyUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true, unitNumber: true, code: true, kind: true } }) : [],
    bedIds.length ? prisma.propertyBed.findMany({ where: { id: { in: bedIds } }, select: { id: true, code: true, bedNumber: true, room: { select: { roomNumber: true } } } }) : [],
  ]);
  const map = new Map<string, string>();
  for (const u of units) map.set(u.id, u.name || (u.unitNumber ? `${u.kind === "VILLA" ? "Villa" : u.kind === "FLAT" ? "Flat" : "Unit"} ${u.unitNumber}` : u.code));
  for (const b of beds) map.set(b.id, `Room ${b.room.roomNumber} · Bed ${b.bedNumber}`);
  for (const x of [...units, ...beds]) map.set(`#${x.id}`, x.code);
  return map;
}

/** The unique ID of what a lease covers: the bed (SR-BED-…), the flat / villa (SR-UNIT-… / SR-VILLA-…) or the property (SR-PROP-…). */
export async function placeCode(
  db: { propertyUnit: typeof prisma.propertyUnit; propertyBed: typeof prisma.propertyBed; property: typeof prisma.property },
  lease: { propertyId: string; unitId: string | null; bedId: string | null },
): Promise<string> {
  if (lease.bedId) {
    const bed = await db.propertyBed.findUnique({ where: { id: lease.bedId }, select: { code: true } });
    if (bed) return bed.code;
  }
  if (lease.unitId) {
    const unit = await db.propertyUnit.findUnique({ where: { id: lease.unitId }, select: { code: true } });
    if (unit) return unit.code;
  }
  const property = await db.property.findUnique({ where: { id: lease.propertyId }, select: { code: true } });
  return property?.code ?? "SR";
}

/**
 * Receipt number built from the unit's unique ID and the rent month, e.g.
 * SR-UNIT-000012 + 2026-11 → RCPT-UNIT-000012-202611. A second receipt for the same unit and month
 * (e.g. a new tenant moving in mid-month) gets -2, -3 …
 */
export function receiptNumberFor(code: string, period: string, attempt = 1): string {
  const base = `RCPT-${code.replace(/^SR-/, "")}-${period.replace("-", "")}`;
  return attempt > 1 ? `${base}-${attempt}` : base;
}

export function placeOf(map: Map<string, string>, lease: { unitId: string | null; bedId: string | null }): string | null {
  return (lease.bedId && map.get(lease.bedId)) || (lease.unitId && map.get(lease.unitId)) || null;
}

/** Unique ID (SR-UNIT-… / SR-BED-…) from the same batch; null for a whole-property lease. */
export function placeCodeOf(map: Map<string, string>, lease: { unitId: string | null; bedId: string | null }): string | null {
  return (lease.bedId && map.get(`#${lease.bedId}`)) || (lease.unitId && map.get(`#${lease.unitId}`)) || null;
}
