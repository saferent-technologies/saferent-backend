import type { NextFunction, Request, Response } from "express";
import { RATE_LIMITS } from "../config/constants";
import { consumeRateLimit } from "../lib/rateLimit";

/** Per-user limit on property write operations (protects against scripted abuse). Runs after `protect()`. */
export async function writeLimit(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user) await consumeRateLimit(`property-write:${req.user.id}`, RATE_LIMITS.PROPERTY_WRITE.limit, RATE_LIMITS.PROPERTY_WRITE.windowMs);
    next();
  } catch (error) {
    next(error);
  }
}
