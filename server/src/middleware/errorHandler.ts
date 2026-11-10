import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";

/** 404 for unknown API routes. */
export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("not-found", "NOT_FOUND", "Not found."));
}

/**
 * Single place that turns errors into JSON:  { error: { reason, message, ...extra } }
 * Unexpected errors are logged and returned as a generic 500 — internals never reach the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { reason: err.reason, message: err.message, ...err.extra } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { reason: "INVALID_INPUT", message: err.issues[0]?.message ?? "Invalid request." } });
    return;
  }
  if ((err as { type?: string }).type === "entity.parse.failed" || (err as { type?: string }).type === "entity.too.large") {
    res.status(400).json({ error: { reason: "INVALID_INPUT", message: "Invalid request." } });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { reason: "INTERNAL", message: "Something went wrong. Please try again." } });
}
