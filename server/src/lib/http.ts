import type { Request } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { fail } from "./errors";
import { parseInput } from "./validation";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function pagination(req: Request): Pagination & { skip: number; take: number } {
  const p = parseInput(paginationSchema, req.query);
  return { ...p, skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paged<T>(items: T[], total: number, p: Pagination) {
  return { items, page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

const idSchema = z.string().uuid();

/** Validates a :param UUID (so invalid ids never reach the database). */
export function idParam(req: Request, name = "id"): string {
  const parsed = idSchema.safeParse(req.params[name]);
  if (!parsed.success) fail("not-found", REASONS.NOT_FOUND, "Not found.");
  return parsed.data;
}

/** Throws 404 when a scoped lookup returns nothing (also hides records outside the user's scope). */
export function found<T>(value: T | null | undefined, what = "Record"): T {
  if (value === null || value === undefined) fail("not-found", REASONS.NOT_FOUND, `${what} not found.`);
  return value;
}

/** Optional enum filter from the query string. */
export function enumQuery<T extends string>(req: Request, name: string, values: readonly T[]): T | undefined {
  const v = req.query[name];
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : undefined;
}
