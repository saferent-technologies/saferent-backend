import { z } from "zod";
import { ROLES } from "../rbac/catalog";

/*
 * Android / client app configuration — the shape, the defaults and the validation rules.
 * Pure module (no database), unit-tested in test/appConfig.test.ts.
 *
 * Single source of truth rules (nothing is stored twice):
 *   - Property types on/off   → property_types table (Admin → Property types)
 *   - Razorpay on/off, limits → payment_gateways table (Admin → Payment gateways)
 *   - Referral reward amounts → referral_campaigns table (Admin → Referrals)
 *   These are READ into the public config, never copied into it.
 */

export const IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp"] as const;
export const DOCUMENT_FORMATS = ["pdf", "jpg", "jpeg", "png", "webp"] as const;
export const FORMAT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** Hard ceilings: the server's upload parser never accepts more than this, whatever the config says. */
export const UPLOAD_CEILING_MB = 25;

const text = (max: number, def = "") => z.string().trim().max(max).default(def);
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), { message: "Use a full https:// link (or leave it empty)." })
  .default("");
/**
 * Files uploaded from Admin → App configuration (splash logo, Lottie, onboarding media) are stored by
 * the API and referenced by this path; the public config turns it into a full URL for the app.
 */
export const APP_ASSET_PATH = /^\/api\/v1\/app\/assets\/[0-9a-f-]{36}\.(png|jpg|webp|mp4|json)$/;
/** An https:// link or an uploaded app asset (or empty). */
const mediaLink = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v) || APP_ASSET_PATH.test(v), { message: "Upload a file or use a full https:// link (or leave it empty)." })
  .default("");
/** Images for the app: PNG / JPG / WEBP only — SVG links are refused (the app doesn't render SVG). */
const SVG_LINK = /\.svgz?([?#].*)?$/i;
const imageLink = mediaLink.refine((v) => !SVG_LINK.test(v), { message: "SVG isn't supported. Use a PNG, JPG or WEBP image." });
/** Legal document version, e.g. "2026-11-01" or "v3". Letters, digits, dot, dash, underscore; max 32. */
const legalVersion = z.string().trim().regex(/^[A-Za-z0-9._-]{1,32}$/, "Use a version like 2026-11-01 (letters, numbers, . - _ ; max 32).").default("2026-11-01");
const color = (def: string) => z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, "Use a colour like #F97316.").default(def);
const semver = (def: string) => z.string().trim().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, "Use a version like 1.4.2.").default(def);
const phone = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\+?\d{10,15}$/.test(v), { message: "Enter a phone number with 10 to 15 digits, e.g. +919876543210." })
  .default("");
const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Enter a valid date and time." })
  .nullable()
  .default(null);
const on = z.boolean().default(true);
const off = z.boolean().default(false);

/** Compares "1.10.0" with "1.9.3" numerically. Negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa.at(i) ?? 0) - (pb.at(i) ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Section version like "1.0", "1.7", "2.0" (major.minor, minor 0–9). Older saved configs used a plain
 * number (1, 2, 3): those read as "1.0", "2.0", "3.0".
 */
const sectionVersion = z.preprocess(
  (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 ? `${v}.0` : v),
  z.string().trim().regex(/^[1-9]\d{0,3}\.\d$/, "Use a version like 1.0 or 2.3."),
).default("1.0");

/** "1.0" → "1.1", … "1.9" → "2.0", "2.9" → "3.0". */
export function nextSectionVersion(v: string): string {
  const [major, minor] = v.split(".").map((n) => Number.parseInt(n, 10));
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return "1.0";
  return minor >= 9 ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

export const MAX_ONBOARDING_SCREENS = 10;
export const ONBOARDING_MEDIA = ["NONE", "IMAGE", "VIDEO", "LOTTIE"] as const;

/** Which URL field carries the media for each media type (only that one is filled). */
export const MEDIA_FIELD = { IMAGE: "imageUrl", VIDEO: "videoUrl", LOTTIE: "lottieUrl" } as const;
type MediaField = (typeof MEDIA_FIELD)[keyof typeof MEDIA_FIELD];
const MEDIA_FIELDS: MediaField[] = ["imageUrl", "videoUrl", "lottieUrl"];

/**
 * Older saves kept one "mediaUrl"; it moves into the field that matches the media type. Links in the
 * fields that don't match the media type are cleared, so exactly one (or none) is ever filled.
 */
function normalizeScreenMedia(v: unknown): unknown {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
  const x = { ...(v as Record<string, unknown>) };
  const type = typeof x.mediaType === "string" ? x.mediaType : "NONE";
  const target = (MEDIA_FIELD as Record<string, MediaField | undefined>)[type];
  if (typeof x.mediaUrl === "string" && x.mediaUrl && target && !x[target]) x[target] = x.mediaUrl;
  delete x.mediaUrl;
  for (const f of MEDIA_FIELDS) if (f !== target) x[f] = "";
  return x;
}

/** One onboarding slide: title, description and optional media — an image, a video or a Lottie animation. */
const onboardingScreen = z.preprocess(
  normalizeScreenMedia,
  z
    .object({
      /** Stable id (the admin page generates it) so the app can track which slides were seen. */
      id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/, "Use letters, numbers and dashes for the screen id."),
      title: z.string().trim().min(1, "Every onboarding screen needs a title.").max(80),
      description: text(300),
      /** Button on this screen. Empty = "Next" (or "Get started" on the last screen) from the section settings. */
      buttonText: text(30),
      mediaType: z.enum(ONBOARDING_MEDIA).default("NONE"),
      imageUrl: imageLink,
      videoUrl: mediaLink,
      lottieUrl: mediaLink,
    })
    .superRefine((x, ctx) => {
      if (x.mediaType === "NONE") return;
      const field = MEDIA_FIELD[x.mediaType];
      if (!x[field]) ctx.addIssue({ code: "custom", message: "Upload a file or add the https:// link for this screen's image / video / animation (or choose no media).", path: [field] });
    }),
);

export const sections = {
  app: z
    .object({
      name: text(60, "SafeRent"),
      packageName: z.string().trim().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "Use an Android package name like com.saferent.app.").default("com.saferent.app"),
      latestVersion: semver("1.0.0"),
      minimumSupportedVersion: semver("1.0.0"),
      forceUpdate: off,
      updateMessage: text(300, "A new version of SafeRent is available. Please update to continue."),
      playStoreUrl: httpsUrl,
    })
    .refine((a) => compareVersions(a.minimumSupportedVersion, a.latestVersion) <= 0, { message: "Minimum supported version can't be newer than the latest version.", path: ["minimumSupportedVersion"] }),

  maintenance: z
    .object({
      enabled: off,
      title: text(100, "We'll be right back"),
      message: text(500, "SafeRent is undergoing scheduled maintenance. Please try again shortly."),
      startsAt: isoDate,
      expectedEndAt: isoDate,
      /** Roles that keep working during maintenance. Super Admin always does. */
      allowedRoles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
    })
    .refine((m) => !m.startsAt || !m.expectedEndAt || Date.parse(m.expectedEndAt) >= Date.parse(m.startsAt), { message: "Expected completion must be after the start time.", path: ["expectedEndAt"] }),

  features: z.object({
    properties: on,
    tenants: on,
    landlords: on,
    rentManagement: on,
    rentPayments: on,
    rentReminders: on,
    documents: on,
    rentalAgreements: on,
    electricityBills: on,
    propertyTaxDocuments: on,
    otherDocuments: on,
    notifications: on,
    referrals: on,
    support: on,
    chat: off,
  }),

  auth: z.object({
    emailLogin: on,
    phoneLogin: on,
    emailOtp: on,
    phoneOtp: on,
    googleLogin: off,
    otpExpiryMinutes: z.number().int().min(2).max(15).default(5),
    otpResendSeconds: z.number().int().min(30).max(600).default(60),
    otpMaxAttempts: z.number().int().min(3).max(10).default(5),
    /** After sign-in, show the demographic screen while the profile is incomplete (gender, date of birth, city, state). */
    showDemographics: on,
    /** Existing users may skip it (asked again at the next sign-in). New users always fill it to create the account. */
    demographicsSkippable: on,
  }),

  properties: z.object({
    maxImages: z.number().int().min(1).max(100).default(40),
    maxDocuments: z.number().int().min(1).max(200).default(50),
    maxImageSizeMB: z.number().int().min(1).max(15).default(5),
    allowedImageFormats: z.array(z.enum(IMAGE_FORMATS)).min(1, "Allow at least one image format.").default(["jpg", "jpeg", "png", "webp"]),
  }),

  documents: z.object({
    customNameRequired: on,
    maxFileSizeMB: z.number().int().min(1).max(UPLOAD_CEILING_MB).default(10),
    allowedFormats: z.array(z.enum(DOCUMENT_FORMATS)).min(1, "Allow at least one document format.").default(["pdf", "jpg", "jpeg", "png"]),
    notifyTenantOnUpload: on,
    /** Visibility of a new document when the uploader doesn't choose: shared with the tenant or private. */
    defaultVisibility: z.enum(["PRIVATE", "SHARED_WITH_TENANT"]).default("PRIVATE"),
  }),

  notifications: z.object({
    pushEnabled: on,
    rentDue: on,
    rentOverdue: on,
    paymentSuccess: on,
    documentUploaded: on,
    agreementUploaded: on,
    propertyAssigned: on,
    maintenance: on,
  }),

  payments: z
    .object({
      enabled: on,
      upi: on,
      card: on,
      netbanking: on,
      currency: z.enum(["INR"]).default("INR"),
      convenienceFee: z
        .object({
          type: z.enum(["NONE", "PERCENT", "FLAT"]).default("NONE"),
          value: z.number().min(0).max(500).default(0),
          maxAmount: z.number().min(0).max(5000).nullable().default(null),
        })
        .refine((f) => f.type !== "PERCENT" || f.value <= 5, { message: "A percentage fee can be at most 5%.", path: ["value"] })
        .default({ type: "NONE", value: 0, maxAmount: null }),
    })
    .refine((p) => !p.enabled || p.upi || p.card || p.netbanking, { message: "Keep at least one payment method on, or switch payments off.", path: ["upi"] }),

  referrals: z.object({
    minSuccessfulReferrals: z.number().int().min(1).max(100).default(1),
    eligibilityRules: text(1000, "Rewards are credited after the referred person completes verification and their first lease or listing."),
  }),

  support: z.object({
    email: z.string().trim().max(254).refine((v) => v === "" || z.email().safeParse(v).success, { message: "Enter a valid email address." }).default("support@saferenttechnologies.com"),
    phone,
    whatsapp: phone,
    helpCenterUrl: httpsUrl,
    faqEnabled: off,
  }),

  /** First screen of the app. When off, the app goes straight to sign-in / home (system splash only). */
  splash: z.object({
    /** "1.0" → "1.1" … "1.9" → "2.0": raised by the server whenever anything in this section changes. */
    version: sectionVersion,
    enabled: on,
    title: text(60, "SafeRent"),
    description: text(200, "Verified homes. Honest renting."),
    /** Logo on the light-theme splash (empty = the logo bundled in the app). Uploaded PNG/JPG/WEBP or https link. */
    lightLogoUrl: imageLink,
    /** Logo on the dark-theme splash (empty = use the light logo, then the bundled one). */
    darkLogoUrl: imageLink,
    /** Lottie JSON for the loading animation (empty = the app's default progress indicator). Uploaded file or https link. */
    lottieUrl: mediaLink,
    /** How long the splash stays at least, so the animation is seen (the app may stay longer while loading). */
    minDurationMs: z.number().int().min(0).max(5000).default(1500),
  }),

  /** Intro slides shown after the splash, before sign-in. Any number of screens (up to MAX_ONBOARDING_SCREENS). */
  onboarding: z
    .object({
      /** "1.0" → "1.1" … "1.9" → "2.0": raised by the server whenever anything in this section changes ("show once" re-shows a new version). */
      version: sectionVersion,
      enabled: off,
      /** Show only on first launch, and again whenever the onboarding version changes. */
      showOnce: on,
      skippable: on,
      /** Default button texts (a screen can override its own button). */
      nextButtonText: z.string().trim().min(1, "Add the Next button text.").max(30).default("Next"),
      finishButtonText: z.string().trim().min(1, "Add the last screen's button text.").max(30).default("Get started"),
      skipButtonText: z.string().trim().min(1, "Add the Skip button text.").max(30).default("Skip"),
      screens: z.array(onboardingScreen).max(MAX_ONBOARDING_SCREENS, `At most ${MAX_ONBOARDING_SCREENS} onboarding screens.`).default([]),
    })
    .refine((o) => new Set(o.screens.map((x) => x.id)).size === o.screens.length, { message: "Each onboarding screen needs a unique id.", path: ["screens"] }),

  ui: z
    .object({
      primaryColor: color("#F97316"),
      secondaryColor: color("#111827"),
      accentColor: color("#FB923C"),
      logoUrl: httpsUrl,
      darkMode: on,
      announcementEnabled: off,
      announcementTitle: text(100),
      announcementMessage: text(500),
      bannerEnabled: off,
      bannerImageUrl: httpsUrl,
      bannerLinkUrl: httpsUrl,
    })
    .refine((u) => !u.announcementEnabled || u.announcementTitle.length > 0, { message: "Add a title to show the announcement.", path: ["announcementTitle"] })
    .refine((u) => !u.bannerEnabled || u.bannerImageUrl.length > 0, { message: "Add a banner image link to show the banner.", path: ["bannerImageUrl"] }),

  legal: z.object({
    privacyPolicyUrl: httpsUrl,
    termsUrl: httpsUrl,
    refundPolicyUrl: httpsUrl,
    /** Current Terms of Service / Privacy Policy versions — the app sends them with the consent so the record shows which version was accepted. */
    termsVersion: legalVersion,
    privacyVersion: legalVersion,
  }),
};

export const appConfigSchema = z.object(sections).strict();
export type AppConfig = z.infer<typeof appConfigSchema>;
export type SectionKey = keyof typeof sections;
export const SECTION_KEYS = Object.keys(sections) as SectionKey[];

/** The default configuration (every field at its default). */
export function defaultConfig(): AppConfig {
  return appConfigSchema.parse(Object.fromEntries(SECTION_KEYS.map((k) => [k, {}])));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * SVG support was removed: saved SVG logos / onboarding images are cleared (an onboarding screen whose
 * image was an SVG becomes text-only) instead of making the whole section invalid.
 */
function dropSvgLinks(section: unknown): unknown {
  if (!isObject(section)) return section;
  const out: Record<string, unknown> = { ...section };
  for (const k of ["lightLogoUrl", "darkLogoUrl"]) if (typeof out[k] === "string" && SVG_LINK.test(out[k] as string)) out[k] = "";
  if (Array.isArray(out.screens)) {
    out.screens = out.screens.map((sc) => {
      if (!isObject(sc)) return sc;
      const hasSvg = [sc.imageUrl, sc.mediaUrl].some((u) => typeof u === "string" && SVG_LINK.test(u));
      return hasSvg ? { ...sc, imageUrl: "", mediaUrl: "", mediaType: sc.mediaType === "IMAGE" ? "NONE" : sc.mediaType } : sc;
    });
  }
  return out;
}

/**
 * Reads a stored config safely: missing sections/fields get defaults (so new settings added in
 * later releases need no migration), and a section that no longer validates falls back to its
 * defaults instead of breaking the app.
 */
export function normalizeStored(stored: unknown): { config: AppConfig; repaired: SectionKey[] } {
  const src: Record<string, unknown> = isObject(stored) ? { ...stored } : {};
  // Configs saved before the splash section existed kept the splash image under ui.splashImageUrl.
  const oldUi = src.ui;
  if (!isObject(src.splash) && isObject(oldUi) && typeof oldUi.splashImageUrl === "string" && oldUi.splashImageUrl) {
    src.splash = { lightLogoUrl: oldUi.splashImageUrl };
  }
  // splash.logoUrl became lightLogoUrl (+ darkLogoUrl).
  if (isObject(src.splash) && typeof src.splash.logoUrl === "string") {
    const { logoUrl, ...rest } = src.splash;
    src.splash = { ...rest, lightLogoUrl: typeof rest.lightLogoUrl === "string" && rest.lightLogoUrl ? rest.lightLogoUrl : logoUrl };
  }
  src.splash = dropSvgLinks(src.splash);
  src.onboarding = dropSvgLinks(src.onboarding);
  const repaired: SectionKey[] = [];
  const out: Record<string, unknown> = {};
  for (const key of SECTION_KEYS) {
    const parsed = sections[key].safeParse(isObject(src[key]) ? src[key] : {});
    if (parsed.success) out[key] = parsed.data;
    else {
      repaired.push(key);
      out[key] = sections[key].parse({});
    }
  }
  return { config: out as AppConfig, repaired };
}

/** Leaf paths that differ between two configs, e.g. ["maintenance.enabled", "ui.primaryColor"]. */
export function changedPaths(a: unknown, b: unknown, prefix = ""): string[] {
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
}

/** Sections whose `version` the server maintains: next version ("1.3" → "1.4", "1.9" → "2.0") whenever anything else in the section changes. */
export const VERSIONED_SECTIONS = ["splash", "onboarding"] as const;

/**
 * Sets splash.version / onboarding.version on a config about to be saved: unchanged content keeps the
 * current version, changed content gets the next one. Whatever version the editor sent is ignored, so the
 * number only ever goes up (also after a rollback to older content).
 */
export function withSectionVersions(before: AppConfig, next: AppConfig): AppConfig {
  const out = structuredClone(next);
  for (const key of VERSIONED_SECTIONS) {
    const { version: prev, ...oldContent } = before[key];
    const { version: _ignored, ...newContent } = next[key];
    const same = JSON.stringify(oldContent) === JSON.stringify(newContent);
    (out[key] as { version: string }).version = same ? prev : nextSectionVersion(prev);
  }
  return out;
}

/** Changes that need an explicit confirmation in the admin UI (they affect every user immediately). */
export const CRITICAL_PATHS = ["maintenance.enabled", "app.forceUpdate", "app.minimumSupportedVersion", "auth.phoneLogin", "auth.emailLogin", "payments.enabled", "features.properties", "features.rentPayments"];

/** What an installed app must do. */
export function updateStatus(cfg: AppConfig["app"], installed: string) {
  const valid = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(installed);
  const behindLatest = valid && compareVersions(installed, cfg.latestVersion) < 0;
  const belowMinimum = valid && compareVersions(installed, cfg.minimumSupportedVersion) < 0;
  const updateRequired = belowMinimum || (cfg.forceUpdate && behindLatest);
  return {
    installedVersion: installed,
    validVersion: valid,
    latestVersion: cfg.latestVersion,
    minimumSupportedVersion: cfg.minimumSupportedVersion,
    updateAvailable: behindLatest,
    updateRequired,
    forceUpdate: cfg.forceUpdate,
    message: behindLatest ? cfg.updateMessage : "",
    playStoreUrl: cfg.playStoreUrl,
  };
}

export type NotificationCategory = "RENT_DUE" | "RENT_OVERDUE" | "PAYMENT_SUCCESS" | "DOCUMENT_UPLOADED" | "AGREEMENT_UPLOADED" | "PROPERTY_ASSIGNED" | "MAINTENANCE";
const CATEGORY_KEY: Record<NotificationCategory, keyof AppConfig["notifications"]> = {
  RENT_DUE: "rentDue",
  RENT_OVERDUE: "rentOverdue",
  PAYMENT_SUCCESS: "paymentSuccess",
  DOCUMENT_UPLOADED: "documentUploaded",
  AGREEMENT_UPLOADED: "agreementUploaded",
  PROPERTY_ASSIGNED: "propertyAssigned",
  MAINTENANCE: "maintenance",
};

/** Is this kind of notification switched on (and the notifications module itself)? */
export function notificationAllowed(cfg: AppConfig, category: NotificationCategory | undefined): boolean {
  if (!cfg.features.notifications) return false;
  return category ? cfg.notifications[CATEGORY_KEY[category]] : true;
}

/** Document category → the feature switch that controls uploads of it (ownership proofs are always allowed). */
export function documentUploadAllowed(cfg: AppConfig, docType: string): boolean {
  if (!cfg.features.documents) return false;
  if (docType === "RENTAL_AGREEMENT") return cfg.features.rentalAgreements;
  if (docType === "ELECTRICITY_BILL") return cfg.features.electricityBills;
  if (docType === "PROPERTY_TAX_RECEIPT") return cfg.features.propertyTaxDocuments;
  if (docType === "OTHER") return cfg.features.otherDocuments;
  return true;
}

/** MIME types an upload kind accepts under the current config. */
export function allowedMimes(cfg: AppConfig, kind: "image" | "document"): string[] {
  const formats: readonly string[] = kind === "image" ? cfg.properties.allowedImageFormats : cfg.documents.allowedFormats;
  return [...new Set(formats.map((f) => FORMAT_MIME[f]).filter(Boolean))];
}

export function maxUploadBytes(cfg: AppConfig, kind: "image" | "document"): number {
  return (kind === "image" ? cfg.properties.maxImageSizeMB : cfg.documents.maxFileSizeMB) * 1024 * 1024;
}

/** Maintenance is in force when switched on and its start time (if any) has come. */
export function maintenanceActive(m: AppConfig["maintenance"], now = Date.now()): boolean {
  return m.enabled && (!m.startsAt || Date.parse(m.startsAt) <= now);
}

export type FeatureKey = keyof AppConfig["features"];

/**
 * Which feature switch guards an API path (paths as mounted under /api or /api/v1).
 * Staff roles are not gated (they administer the platform); customers are.
 */
export function featuresForPath(method: string, path: string): FeatureKey[] {
  const p = path.toLowerCase();
  const out: FeatureKey[] = [];
  const under = (prefix: string) => p === prefix || p.startsWith(`${prefix}/`);
  if (under("/properties") || under("/browse")) out.push("properties");
  if (/\/documents?(\/|$)/.test(p) || /document-requests/.test(p) || under("/files/documents")) out.push("documents");
  if (under("/invitations") || under("/applications") || /^\/browse\/[^/]+\/apply$/.test(p)) out.push("tenants");
  if (under("/kyc") || under("/profile/pan")) out.push("landlords");
  if (under("/rent")) out.push("rentManagement");
  if ((method === "POST" && /^\/rent\/[^/]+\/pay$/.test(p)) || (method === "POST" && under("/wallet/topups"))) out.push("rentPayments");
  if (/^\/leases\/[^/]+\/agreement$/.test(p)) out.push("rentalAgreements");
  if (under("/referrals")) out.push("referrals");
  if (under("/support")) out.push("support");
  if (under("/notifications")) out.push("notifications");
  return [...new Set(out)];
}

/** Online payment endpoints also need the payment module switched on. */
export function isPaymentPath(method: string, path: string): boolean {
  const p = path.toLowerCase();
  return method === "POST" && (/^\/rent\/[^/]+\/pay$/.test(p) || p === "/wallet/topups" || p.startsWith("/wallet/topups/"));
}
