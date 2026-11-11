/**
 * Turns catalog field definitions into validation and storage helpers (pure — unit tested).
 *
 *  - fieldsSchema():     zod schema for incoming values (types and ranges; every field optional so
 *                        drafts can be saved part-way). Unknown keys are rejected.
 *  - missingRequired():  which required fields are still empty (checked on submit).
 *  - splitValues():      column values vs. `attributes` JSON values.
 */
import { z } from "zod";
import type { FieldDef } from "./catalog";

export const moneySchema = z
  .union([z.number(), z.string().trim()])
  .transform((v, ctx) => {
    const s = typeof v === "number" ? String(v) : v;
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount (up to 2 decimals, no negatives)." });
      return z.NEVER;
    }
    return Number(s).toFixed(2);
  });

/** Larger amounts (sale prices). */
export const bigMoneySchema = z
  .union([z.number(), z.string().trim()])
  .transform((v, ctx) => {
    const s = typeof v === "number" ? String(v) : v;
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount (up to 2 decimals, no negatives)." });
      return z.NEVER;
    }
    return Number(s).toFixed(2);
  });

export const decimalSchema = (min = 0, max = 100_000_000) =>
  z
    .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d{1,8})?$/, "Enter a number.")])
    .transform((v) => Number(v))
    .pipe(z.number().min(min, `Must be at least ${min}.`).max(max, `Must be at most ${max}.`));

const dateSchema = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use YYYY-MM-DD."), z.date()]).pipe(z.coerce.date());

function fieldSchema(def: FieldDef): z.ZodTypeAny {
  switch (def.type) {
    case "text":
      return z.string().trim().max(def.maxLength ?? 255);
    case "textarea":
      return z.string().trim().max(def.maxLength ?? 5000);
    case "integer":
      return z.coerce.number().int(`${def.label} must be a whole number.`).min(def.min ?? 0, `${def.label} is too small.`).max(def.max ?? 1_000_000, `${def.label} is too large.`);
    case "decimal":
      return decimalSchema(def.min ?? 0, def.max ?? 100_000_000);
    case "money":
      return moneySchema;
    case "boolean":
      return z.boolean();
    case "date":
      return dateSchema;
    case "disclosure":
    case "select": {
      const options = def.options ?? [];
      return z.string().refine((v) => options.includes(v), { message: `${def.label}: choose one of ${options.join(", ")}.` });
    }
  }
}

/** Strict object schema: every field optional + nullable (null clears a value). */
export function fieldsSchema(defs: readonly FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of defs) shape[def.key] = fieldSchema(def).nullable().optional();
  return z.object(shape).strict();
}

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Labels of required fields that are still empty. */
export function missingRequired(defs: readonly FieldDef[], values: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const def of defs) {
    const required = def.required || (def.requiredWhen && values[def.requiredWhen.field] === def.requiredWhen.equals);
    if (required && isEmpty(values[def.key])) missing.push(def.label);
  }
  return missing;
}

/** Splits validated values into real columns and `attributes` JSON (undefined = not sent, untouched). */
export function splitValues(values: Record<string, unknown>, columns: readonly string[]): { columns: Record<string, unknown>; attributes: Record<string, unknown> } {
  const out = { columns: {} as Record<string, unknown>, attributes: {} as Record<string, unknown> };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (columns.includes(key)) out.columns[key] = value;
    else out.attributes[key] = value;
  }
  return out;
}

/** Merge attribute updates into the stored JSON (null removes a key). */
export function mergeAttributes(current: unknown, updates: Record<string, unknown>): Record<string, unknown> {
  const base = current && typeof current === "object" && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete base[key];
    else base[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  }
  return base;
}

/** Flattens a stored record (columns + attributes) into one value map for required-field checks. */
export function flatValues(record: Record<string, unknown> & { attributes?: unknown }): Record<string, unknown> {
  const attrs = record.attributes && typeof record.attributes === "object" ? (record.attributes as Record<string, unknown>) : {};
  return { ...attrs, ...record };
}
