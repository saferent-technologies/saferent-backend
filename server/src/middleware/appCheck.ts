import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import { appCheck } from "../lib/firebaseAdmin";

/**
 * Firebase App Check: proves the request comes from the genuine SafeRent web app.
 * Enabled with APP_CHECK_ENFORCE=true (recommended in production).
 */
export async function verifyAppCheck(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!env.APP_CHECK_ENFORCE) return next();
  const token = req.get("x-firebase-appcheck");
  if (!token) return next(new AppError("unauthenticated", "UNAUTHENTICATED", "Security check failed. Please refresh the page."));
  try {
    await appCheck.verifyToken(token);
    next();
  } catch {
    next(new AppError("unauthenticated", "UNAUTHENTICATED", "Security check failed. Please refresh the page."));
  }
}
