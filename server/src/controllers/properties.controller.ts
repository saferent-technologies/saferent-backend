/**
 * Property assignments (managers / agents). All other property endpoints live in src/properties/.
 */
import type { Request, Response } from "express";
import { REASONS } from "../config/constants";
import { fail } from "../lib/errors";
import { found } from "../lib/http";
import { notify } from "../lib/notify";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { assignmentSchema } from "../properties/schemas";
import { audit, propertyKey, withProperty } from "../properties/service";
import { hasRoleWhere } from "./users.controller";

/** POST /api/v1/properties/:propertyId/assignments — assign a property manager or agent (assignments.manage). */
export async function addAssignment(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findFirst({ where: propertyKey(req) }), "Property");
  const { userId, type } = parseInput(assignmentSchema, req.body);
  const expectedRole = type === "MANAGER" ? "PROPERTY_MANAGER" : "PROPERTY_AGENT";
  const assignee = await prisma.user.findFirst({ where: { AND: [{ id: userId, accountStatus: "ACTIVE" }, hasRoleWhere(expectedRole)] } });
  if (!assignee) fail("invalid-argument", REASONS.INVALID_INPUT, `Choose an active ${type === "MANAGER" ? "property manager" : "agent"}.`);
  await withProperty(property.id, async (tx) => {
    const row = await tx.propertyAssignment.upsert({
      where: { propertyId_userId_type: { propertyId: property.id, userId, type } },
      create: { propertyId: property.id, userId, type, createdById: me(req).id },
      update: {},
    });
    await audit(tx, req, { propertyId: property.id, entityType: "ASSIGNMENT", entityId: row.id, action: "assignment.add", newValue: { userId, type } });
  });
  await notify(userId, "New property assigned", `You were assigned to "${property.title ?? property.code}".`, `/properties/${property.id}`);
  res.status(201).json({ ok: true });
}

/** DELETE /api/v1/properties/:propertyId/assignments/:assignmentId */
export async function removeAssignment(req: Request, res: Response): Promise<void> {
  const property = found(await prisma.property.findFirst({ where: propertyKey(req) }), "Property");
  const assignment = found(await prisma.propertyAssignment.findFirst({ where: { id: String(req.params.assignmentId), propertyId: property.id } }), "Assignment");
  await withProperty(property.id, async (tx) => {
    await tx.propertyAssignment.delete({ where: { id: assignment.id } });
    await audit(tx, req, { propertyId: property.id, entityType: "ASSIGNMENT", entityId: assignment.id, action: "assignment.remove", oldValue: { userId: assignment.userId, type: assignment.type } });
  });
  res.json({ ok: true });
}
