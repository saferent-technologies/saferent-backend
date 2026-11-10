import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { REASONS } from "../config/constants";
import { fail } from "./errors";
import { prisma } from "./prisma";
import { evaluateRateLimit, type RateLimitState } from "./rateLimitPolicy";

export { evaluateRateLimit, type RateLimitDecision, type RateLimitState } from "./rateLimitPolicy";

/** Keys may contain emails/IPs, so rows are addressed by a SHA-256 of the key. */
export function rateLimitKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function throwRateLimited(retryAfterMs: number): never {
  fail("resource-exhausted", REASONS.RATE_LIMITED, "Too many requests. Please try again later.", {
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
  });
}

/**
 * Consumes one unit of a fixed-window limit inside the given transaction.
 * The row is locked with SELECT … FOR UPDATE so concurrent requests are counted correctly.
 */
export async function consumeRateLimitTx(
  tx: Prisma.TransactionClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const id = rateLimitKey(key);
  const rows = await tx.$queryRaw<Array<{ count: number; window_start: Date }>>`
    SELECT count, window_start FROM rate_limits WHERE rate_key = ${id} FOR UPDATE`;
  const state: RateLimitState | null = rows[0] ? { count: Number(rows[0].count), windowStartMs: new Date(rows[0].window_start).getTime() } : null;
  const decision = evaluateRateLimit(state, Date.now(), limit, windowMs);
  if (decision.allowed) {
    const data = {
      count: decision.next.count,
      windowStart: new Date(decision.next.windowStartMs),
      expiresAt: new Date(decision.next.windowStartMs + windowMs),
    };
    await tx.rateLimit.upsert({ where: { key: id }, create: { key: id, ...data }, update: data });
  }
  return { allowed: decision.allowed, retryAfterMs: decision.retryAfterMs };
}

/** Standalone version: consumes one unit or throws 429. */
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const result = await prisma.$transaction((tx) => consumeRateLimitTx(tx, key, limit, windowMs));
  if (!result.allowed) throwRateLimited(result.retryAfterMs);
}
