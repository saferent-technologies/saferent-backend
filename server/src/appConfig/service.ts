import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { changedPaths, defaultConfig, normalizeStored, withSectionVersions, type AppConfig } from "./schema";

/*
 * Active app configuration with a short in-memory cache. Every API instance reads the same
 * database row, so a save is picked up by other instances within CACHE_MS (this one at once).
 */

const CACHE_MS = 15_000;

export interface ActiveConfig {
  version: number;
  config: AppConfig;
  updatedAt: Date | null;
  updatedById: string | null;
}

let cached: { at: number; value: ActiveConfig } | null = null;

export function invalidateAppConfig(): void {
  cached = null;
}

/** Seeds the first version's defaults from the existing platform settings, so nothing disagrees on day one. */
async function seededDefaults(): Promise<AppConfig> {
  const cfg = defaultConfig();
  const rows = await prisma.platformSetting.findMany({ where: { key: { in: ["support_email", "platform_name"] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  if (get("support_email")) cfg.support.email = get("support_email")!;
  if (get("platform_name")) cfg.app.name = get("platform_name")!.slice(0, 60);
  return cfg;
}

/** The active configuration (defaults, version 0, until a Super Admin saves the first one). */
export async function activeConfig(): Promise<ActiveConfig> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const row = await prisma.appConfigVersion.findFirst({ orderBy: { version: "desc" } });
  const value: ActiveConfig = row
    ? { version: row.version, config: normalizeStored(row.data).config, updatedAt: row.updatedAt, updatedById: row.createdById }
    : { version: 0, config: await seededDefaults(), updatedAt: null, updatedById: null };
  cached = { at: Date.now(), value };
  return value;
}

/** Shortcut for hot paths (uploads, gates). */
export async function appConfig(): Promise<AppConfig> {
  return (await activeConfig()).config;
}

export class ConfigConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("Configuration changed since it was loaded.");
  }
}

/**
 * Writes a new version. `baseVersion` must be the version the editor loaded (optimistic lock);
 * the unique version column also stops two parallel saves from both landing.
 */
export async function saveConfigVersion(input: {
  config: AppConfig;
  baseVersion: number;
  actorId: string;
  action: "UPDATE" | "ROLLBACK";
  note?: string | null;
  rolledBackFromVersion?: number | null;
}): Promise<{ version: number; changed: string[] }> {
  const current = await prisma.appConfigVersion.findFirst({ orderBy: { version: "desc" } });
  const currentVersion = current?.version ?? 0;
  if (input.baseVersion !== currentVersion) throw new ConfigConflictError(currentVersion);
  const before = current ? normalizeStored(current.data).config : await seededDefaults();
  const config = withSectionVersions(before, input.config);
  const changed = changedPaths(before, config);
  try {
    const row = await prisma.appConfigVersion.create({
      data: {
        version: currentVersion + 1,
        data: config as unknown as Prisma.InputJsonValue,
        action: input.action,
        note: input.note ?? null,
        rolledBackFromVersion: input.rolledBackFromVersion ?? null,
        changedPaths: changed as unknown as Prisma.InputJsonValue,
        createdById: input.actorId,
      },
    });
    invalidateAppConfig();
    return { version: row.version, changed };
  } catch (err) {
    // Another admin saved version currentVersion + 1 a moment earlier.
    if ((err as { code?: string }).code === "P2002") throw new ConfigConflictError(currentVersion + 1);
    throw err;
  }
}
