import type { Prisma } from "@prisma/client";
import type { IdPrefix } from "./catalog";

/** SR-PROP-000001 (pure — unit tested). Grows past 6 digits instead of wrapping. */
export function formatCode(prefix: IdPrefix, n: number | bigint): string {
  const value = typeof n === "bigint" ? n : BigInt(n);
  if (value < 1n) throw new Error("Counter values start at 1.");
  return `${prefix}-${value.toString().padStart(6, "0")}`;
}

/**
 * Collision-safe sequential code, generated on the backend only.
 * INSERT … ON DUPLICATE KEY UPDATE takes a row lock on the counter, so two concurrent transactions
 * can never read the same value (no read-then-increment race). Must run inside a transaction so the
 * counter and the record it names commit together.
 */
export async function nextCode(tx: Prisma.TransactionClient, prefix: IdPrefix): Promise<string> {
  await tx.$executeRaw`INSERT INTO id_counters (name, value) VALUES (${prefix}, 1) ON DUPLICATE KEY UPDATE value = value + 1`;
  const rows = await tx.$queryRaw<Array<{ value: bigint | number }>>`SELECT value FROM id_counters WHERE name = ${prefix}`;
  return formatCode(prefix, BigInt(rows[0]!.value));
}

/** Several codes at once (bulk flat / bed creation) with a single counter update. */
export async function nextCodes(tx: Prisma.TransactionClient, prefix: IdPrefix, count: number): Promise<string[]> {
  if (count <= 0) return [];
  await tx.$executeRaw`INSERT INTO id_counters (name, value) VALUES (${prefix}, ${count}) ON DUPLICATE KEY UPDATE value = value + ${count}`;
  const rows = await tx.$queryRaw<Array<{ value: bigint | number }>>`SELECT value FROM id_counters WHERE name = ${prefix}`;
  const last = BigInt(rows[0]!.value);
  return Array.from({ length: count }, (_, i) => formatCode(prefix, last - BigInt(count - 1 - i)));
}
