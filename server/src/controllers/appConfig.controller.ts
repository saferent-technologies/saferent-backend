import type { Request, Response } from "express";
import { z } from "zod";
import { REASONS } from "../config/constants";
import { APP_ASSET_PATH, appConfigSchema, CRITICAL_PATHS, defaultConfig, normalizeStored, updateStatus, type AppConfig } from "../appConfig/schema";
import { activeConfig, ConfigConflictError, saveConfigVersion } from "../appConfig/service";
import { logActivity } from "../lib/activity";
import { fail } from "../lib/errors";
import { found, paged, pagination } from "../lib/http";
import { prisma } from "../lib/prisma";
import { parseInput } from "../lib/validation";
import { me } from "../middleware/auth";
import { campaigns } from "../services/referral.service";
import { gatewayRows } from "./payments.controller";

/*
 * App configuration for the Android app (and any client).
 *   Public:  GET /app/config, /app/config/version, /app/config/check-update — no login, safe values only.
 *   Admin:   GET/PUT /admin/app-config, GET /admin/app-config/history, POST /admin/app-config/rollback/:id
 *            — app_config.manage (Super Admin by default; grantable to other staff roles).
 * Secrets (gateway keys, peppers, credentials) never enter this module: it only reads on/off states.
 */

/** Values that live in their own tables (single source of truth), read into the config. */
async function linkedSettings() {
  const [types, gateways, camp] = await Promise.all([
    prisma.propertyTypeDefinition.findMany({ orderBy: [{ category: "asc" }, { sortOrder: "asc" }], select: { key: true, label: true, category: true, structure: true, active: true } }),
    gatewayRows(),
    campaigns(),
  ]);
  return { types, gateways, campaigns: [...camp.values()] };
}

/** Uploaded app assets are stored as "/api/v1/app/assets/…": the app needs the full URL. */
function absoluteAsset(url: string, origin: string): string {
  return APP_ASSET_PATH.test(url) ? `${origin}${url}` : url;
}

/** The API's own origin as the caller reached it (works for the emulator, a phone on Wi-Fi and production). */
function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

/** The client-safe projection. Everything here is safe to ship to any phone. */
async function publicPayload(origin: string) {
  const { version, config: c, updatedAt } = await activeConfig();
  const linked = await linkedSettings();
  const razorpay = linked.gateways.find((g) => g.provider === "RAZORPAY");
  const anyGateway = linked.gateways.some((g) => g.available);
  return {
    configVersion: version,
    updatedAt,
    app: c.app,
    maintenance: c.maintenance.enabled
      ? { enabled: true, title: c.maintenance.title, message: c.maintenance.message, startsAt: c.maintenance.startsAt, expectedEndAt: c.maintenance.expectedEndAt }
      : { enabled: false, title: "", message: "", startsAt: null, expectedEndAt: null },
    features: c.features,
    auth: c.auth,
    properties: {
      enabledTypes: linked.types.filter((t) => t.active).map(({ key, label, category, structure }) => ({ key, label, category, structure })),
      maxImages: c.properties.maxImages,
      maxDocuments: c.properties.maxDocuments,
      maxImageSizeMB: c.properties.maxImageSizeMB,
      allowedImageFormats: c.properties.allowedImageFormats,
    },
    documents: {
      agreement: c.features.documents && c.features.rentalAgreements,
      electricityBill: c.features.documents && c.features.electricityBills,
      propertyTax: c.features.documents && c.features.propertyTaxDocuments,
      otherDocuments: c.features.documents && c.features.otherDocuments,
      customNameRequired: c.documents.customNameRequired,
      maxFileSizeMB: c.documents.maxFileSizeMB,
      allowedFormats: c.documents.allowedFormats,
      notifyTenantOnUpload: c.documents.notifyTenantOnUpload,
      defaultVisibility: c.documents.defaultVisibility,
    },
    notifications: c.notifications,
    payments: {
      enabled: c.payments.enabled && anyGateway,
      razorpay: c.payments.enabled && !!razorpay?.available,
      upi: c.payments.upi,
      card: c.payments.card,
      netbanking: c.payments.netbanking,
      currency: c.payments.currency,
      convenienceFee: c.payments.convenienceFee,
      // Only the on/off state and limits — the key id is handed out per order, never here.
      minAmount: razorpay?.minAmount ?? null,
      maxAmount: razorpay?.maxAmount ?? null,
    },
    referrals: {
      enabled: c.features.referrals,
      minSuccessfulReferrals: c.referrals.minSuccessfulReferrals,
      eligibilityRules: c.referrals.eligibilityRules,
      programs: c.features.referrals
        ? linked.campaigns.filter((x) => x.enabled).map((x) => ({ type: x.type, rewardAmount: x.rewardAmount ?? null, durationMonths: x.durationMonths ?? null }))
        : [],
    },
    support: c.support,
    splash: {
      ...c.splash,
      lightLogoUrl: absoluteAsset(c.splash.lightLogoUrl, origin),
      darkLogoUrl: absoluteAsset(c.splash.darkLogoUrl, origin),
      lottieUrl: absoluteAsset(c.splash.lottieUrl, origin),
    },
    onboarding: {
      version: c.onboarding.version,
      enabled: c.onboarding.enabled && c.onboarding.screens.length > 0,
      showOnce: c.onboarding.showOnce,
      skippable: c.onboarding.skippable,
      skipButtonText: c.onboarding.skipButtonText,
      screens: c.onboarding.enabled
        ? c.onboarding.screens.map((x, i, all) => ({
            ...x,
            // Always filled for the app: the screen's own text, else "Next" / "Get started" on the last screen.
            buttonText: x.buttonText || (i === all.length - 1 ? c.onboarding.finishButtonText : c.onboarding.nextButtonText),
            imageUrl: absoluteAsset(x.imageUrl, origin),
            videoUrl: absoluteAsset(x.videoUrl, origin),
            lottieUrl: absoluteAsset(x.lottieUrl, origin),
          }))
        : [],
    },
    ui: c.ui,
    legal: c.legal,
  };
}

/** GET /app/config — active configuration for the Android app. Supports ETag / If-None-Match. */
export async function getPublicConfig(req: Request, res: Response): Promise<void> {
  const { version } = await activeConfig();
  const etag = `"app-config-${version}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=60");
  if (req.headers["if-none-match"] === etag) {
    res.status(304).end();
    return;
  }
  // Asset links are built from the host the app called, so the cached body differs per host.
  res.setHeader("Vary", "Host");
  res.json(await publicPayload(requestOrigin(req)));
}
export async function getPublicConfigVersion(_req: Request, res: Response): Promise<void> {
  const { version, updatedAt, config } = await activeConfig();
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json({ configVersion: version, updatedAt, splashVersion: config.splash.version, onboardingVersion: config.onboarding.version });
}

const checkSchema = z.object({ version: z.string().trim().min(1).max(20), platform: z.enum(["android", "ios"]).default("android") });

/** GET /app/config/check-update?version=1.2.0 — what the installed app must do. */
export async function checkUpdate(req: Request, res: Response): Promise<void> {
  const q = parseInput(checkSchema, req.query);
  const { config } = await activeConfig();
  const status = updateStatus(config.app, q.version);
  if (!status.validVersion) fail("invalid-argument", REASONS.INVALID_INPUT, "Send the installed version like 1.2.0.");
  const { validVersion: _v, ...rest } = status;
  void _v;
  res.json({ platform: q.platform, ...rest });
}

/* ─────────────── Admin (app_config.manage) ─────────────── */

async function nameOf(id: string | null) {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, fullName: true } });
  return u ?? { id, fullName: "Deleted user" };
}

/** GET /admin/app-config — full configuration, version, who changed it last, and the linked settings. */
export async function adminGetConfig(_req: Request, res: Response): Promise<void> {
  const active = await activeConfig();
  const linked = await linkedSettings();
  res.json({
    version: active.version,
    config: active.config,
    defaults: defaultConfig(),
    updatedAt: active.updatedAt,
    updatedBy: await nameOf(active.updatedById),
    criticalPaths: CRITICAL_PATHS,
    linked: {
      propertyTypes: linked.types.map((t) => ({ key: t.key, label: t.label, category: t.category, enabled: t.active })),
      paymentGateways: linked.gateways.map((g) => ({ provider: g.provider, label: g.label, enabled: g.enabled, available: g.available, mode: g.mode })),
      referralPrograms: linked.campaigns.map((x) => ({ type: x.type, enabled: x.enabled, rewardAmount: x.rewardAmount ?? null })),
    },
  });
}

const putSchema = z.object({
  baseVersion: z.number().int().min(0),
  config: z.unknown(),
  note: z.string().trim().max(300).optional(),
});

function conflict(err: unknown): never {
  if (err instanceof ConfigConflictError) {
    fail("already-exists", REASONS.VERSION_CONFLICT, `Someone saved the configuration meanwhile (now version ${err.currentVersion}). Reload and try again.`, { currentVersion: err.currentVersion });
  }
  throw err;
}

/** PUT /admin/app-config — validate everything, then save as a new version. */
export async function adminPutConfig(req: Request, res: Response): Promise<void> {
  const input = parseInput(putSchema, req.body);
  const config = parseInput(appConfigSchema, input.config) as AppConfig;
  const actor = me(req);
  let saved;
  try {
    saved = await saveConfigVersion({ config, baseVersion: input.baseVersion, actorId: actor.id, action: "UPDATE", note: input.note });
  } catch (err) {
    conflict(err);
  }
  if (!saved.changed.length) {
    res.locals.message = "Saved. Nothing changed";
  } else {
    res.locals.message = `Configuration saved as version ${saved.version}`;
  }
  await logActivity(req, "app_config.update", "app_config", String(saved.version), { changed: saved.changed, note: input.note ?? null });
  res.json({ version: saved.version, changed: saved.changed });
}

/** GET /admin/app-config/history — newest first, with who changed what. */
export async function adminHistory(req: Request, res: Response): Promise<void> {
  const p = pagination(req);
  const [rows, total] = await Promise.all([
    prisma.appConfigVersion.findMany({ orderBy: { version: "desc" }, skip: p.skip, take: p.take, select: { id: true, version: true, action: true, note: true, rolledBackFromVersion: true, changedPaths: true, createdById: true, createdAt: true } }),
    prisma.appConfigVersion.count(),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const active = rows.length && p.page === 1 ? rows[0].version : (await activeConfig()).version;
  res.json(
    paged(
      rows.map((r) => ({
        id: r.id,
        version: r.version,
        action: r.action,
        note: r.note,
        rolledBackFromVersion: r.rolledBackFromVersion,
        changedPaths: Array.isArray(r.changedPaths) ? r.changedPaths : [],
        createdAt: r.createdAt,
        createdBy: users.find((u) => u.id === r.createdById) ?? null,
        active: r.version === active,
      })),
      total,
      p,
    ),
  );
}

/** GET /admin/app-config/history/:id — one saved version's full config (to compare before a rollback). */
export async function adminHistoryItem(req: Request, res: Response): Promise<void> {
  const row = found(await prisma.appConfigVersion.findUnique({ where: { id: String(req.params.id) } }), "Configuration version");
  res.json({ id: row.id, version: row.version, action: row.action, note: row.note, createdAt: row.createdAt, config: normalizeStored(row.data).config });
}

const rollbackSchema = z.object({ baseVersion: z.number().int().min(0), note: z.string().trim().max(300).optional() });

/** POST /admin/app-config/rollback/:id — restore an older version (saved as a new version). */
export async function adminRollback(req: Request, res: Response): Promise<void> {
  const input = parseInput(rollbackSchema, req.body ?? {});
  const row = found(await prisma.appConfigVersion.findUnique({ where: { id: String(req.params.id) } }), "Configuration version");
  const { config, repaired } = normalizeStored(row.data);
  let saved;
  try {
    saved = await saveConfigVersion({
      config,
      baseVersion: input.baseVersion,
      actorId: me(req).id,
      action: "ROLLBACK",
      note: input.note ?? `Restored version ${row.version}`,
      rolledBackFromVersion: row.version,
    });
  } catch (err) {
    conflict(err);
  }
  await logActivity(req, "app_config.rollback", "app_config", String(saved.version), { from: row.version, changed: saved.changed, repairedSections: repaired });
  res.locals.message = `Version ${row.version} restored as version ${saved.version}`;
  res.json({ version: saved.version, restoredFrom: row.version, changed: saved.changed, repairedSections: repaired });
}
