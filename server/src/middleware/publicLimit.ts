import type { NextFunction, Request, Response } from "express";
import { evaluateRateLimit, throwRateLimited, type RateLimitState } from "../lib/rateLimit";

/**
 * In-memory, per-IP limit for the public (no-login) website endpoints. Kept out of the database on
 * purpose: these are anonymous read requests (listings, photos) and must stay cheap. With several
 * API instances each one counts separately, which is fine for scraping protection.
 */
export function publicLimit(limit: number, windowMs: number) {
  const hits = new Map<string, RateLimitState>();
  let lastSweep = Date.now();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, v] of hits) if (now - v.windowStartMs > windowMs) hits.delete(k);
      lastSweep = now;
    }
    const key = req.ip ?? "unknown";
    const decision = evaluateRateLimit(hits.get(key) ?? null, now, limit, windowMs);
    if (!decision.allowed) {
      try {
        throwRateLimited(decision.retryAfterMs);
      } catch (err) {
        next(err);
        return;
      }
    }
    hits.set(key, decision.next);
    next();
  };
}
