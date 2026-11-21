import { prisma } from "./prisma";

export { NAME_LOCKED_MESSAGE, nameChangeBlocked, sameName } from "./nameLockRules";

/** Lock the user's name (identity verified). Keeps the first lock time. */
export async function lockName(userId: string, db: Pick<typeof prisma, "user"> = prisma): Promise<void> {
  await db.user.updateMany({ where: { id: userId, nameLocked: false }, data: { nameLocked: true, nameLockedAt: new Date() } });
}
