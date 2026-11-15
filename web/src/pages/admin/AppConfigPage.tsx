import { ArrowDown, ArrowUp, ExternalLink, History, Plus, RotateCcw, Save, Smartphone, Trash2, Undo2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { DataTable, Pagination } from "@/components/data/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Tabs } from "@/components/ui/Tabs";
import { useQuery } from "@/hooks/useQuery";
import { API_URL } from "@/firebase/config";
import { request, upload } from "@/services/api";
import type { Paged } from "@/types/auth";
import { cn } from "@/utils/cn";
import { AppError, errorMessage } from "@/utils/errors";
import { formatTimestamp } from "@/utils/format";

/* ─────────────── Types ─────────────── */

type Config = Record<string, Record<string, unknown>>;

interface AdminConfig {
  version: number;
  config: Config;
  defaults: Config;
  updatedAt: string | null;
  updatedBy: { id: string; fullName: string } | null;
  criticalPaths: string[];
  linked: {
    propertyTypes: Array<{ key: string; label: string; category: string; enabled: boolean }>;
    paymentGateways: Array<{ provider: string; label: string; enabled: boolean; available: boolean; mode: string | null }>;
    referralPrograms: Array<{ type: string; enabled: boolean; rewardAmount: string | number | null }>;
  };
}

interface HistoryRow {
  id: string;
  version: number;
  action: string;
  note: string | null;
  rolledBackFromVersion: number | null;
  changedPaths: string[];
  createdAt: string;
  createdBy: { id: string; fullName: string } | null;
  active: boolean;
}

type Kind = "toggle" | "text" | "textarea" | "number" | "color" | "url" | "select" | "datetime" | "multi" | "roles" | "screens" | "media" | "readonly";
interface Field {
  path: string;
  label: string;
  kind: Kind;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  /** kind "media": what the upload picker accepts. */
  media?: OnboardingScreen["mediaType"];
}
interface Section {
  key: string;
  title: string;
  description: string;
  fields: Field[];
}

const STAFF_ROLES = ["ADMIN", "FINANCE_ADMIN", "PROPERTY_MANAGER", "SUPPORT", "MODERATOR", "VIEWER", "LANDLORD", "TENANT", "PROPERTY_AGENT", "SERVICE_PROVIDER"];
const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", FINANCE_ADMIN: "Finance Admin", PROPERTY_MANAGER: "Property Manager", SUPPORT: "Support", MODERATOR: "Moderator", VIEWER: "Viewer", LANDLORD: "Landlord", TENANT: "Tenant", PROPERTY_AGENT: "Property Agent", SERVICE_PROVIDER: "Service Provider" };
const fmt = (v: string) => ({ value: v, label: v.toUpperCase() });

/* ─────────────── What the page shows (one section per tab) ─────────────── */

const SECTIONS: Section[] = [
  {
    key: "app",
    title: "App information",
    description: "Versions and update rules the Android app checks on every start.",
    fields: [
      { path: "name", label: "App name", kind: "text" },
      { path: "packageName", label: "Package name", kind: "text", hint: "e.g. com.saferent.app" },
      { path: "latestVersion", label: "Latest app version", kind: "text", hint: "e.g. 1.4.2" },
      { path: "minimumSupportedVersion", label: "Minimum supported version", kind: "text", hint: "Older apps must update before they can be used." },
      { path: "forceUpdate", label: "Force update to the latest version", kind: "toggle", hint: "Everyone below the latest version must update." },
      { path: "updateMessage", label: "Update message", kind: "textarea" },
      { path: "playStoreUrl", label: "Play Store URL", kind: "url" },
    ],
  },
  {
    key: "maintenance",
    title: "Maintenance",
    description: "Blocks the app and the API for everyone except Super Admins and the roles you allow.",
    fields: [
      { path: "enabled", label: "Maintenance mode", kind: "toggle", hint: "Takes effect within a minute for every user." },
      { path: "title", label: "Title", kind: "text" },
      { path: "message", label: "Description", kind: "textarea" },
      { path: "startsAt", label: "Start time (optional)", kind: "datetime", hint: "Leave empty to start as soon as it's switched on." },
      { path: "expectedEndAt", label: "Expected completion (optional)", kind: "datetime" },
      { path: "allowedRoles", label: "Roles that keep access", kind: "roles", hint: "Super Admin always keeps access." },
    ],
  },
  {
    key: "features",
    title: "Features",
    description: "Switch modules on or off. The server refuses a switched-off feature for landlords, tenants and other customers; staff keep access.",
    fields: [
      { path: "properties", label: "Property management", kind: "toggle" },
      { path: "tenants", label: "Tenant management (invites, applications)", kind: "toggle" },
      { path: "landlords", label: "Landlord management (owner verification, PAN)", kind: "toggle" },
      { path: "rentManagement", label: "Rent management", kind: "toggle" },
      { path: "rentPayments", label: "Rent payments (online)", kind: "toggle" },
      { path: "rentReminders", label: "Rent reminders", kind: "toggle" },
      { path: "documents", label: "Document management", kind: "toggle" },
      { path: "notifications", label: "Notifications", kind: "toggle" },
      { path: "referrals", label: "Referral system", kind: "toggle" },
      { path: "support", label: "Customer support", kind: "toggle" },
      { path: "chat", label: "Chat (coming later)", kind: "toggle" },
    ],
  },
  {
    key: "auth",
    title: "Authentication",
    description: "Firebase still does the sign-in. These control what the app offers and the email-code timings. Staff always sign in with email + code.",
    fields: [
      { path: "phoneLogin", label: "Phone login", kind: "toggle", hint: "Off = customers can't sign in or register by phone." },
      { path: "phoneOtp", label: "Phone OTP", kind: "toggle" },
      { path: "emailLogin", label: "Email login (customer apps)", kind: "toggle" },
      { path: "emailOtp", label: "Email OTP (customer apps)", kind: "toggle" },
      { path: "googleLogin", label: "Google login (coming later)", kind: "toggle" },
      { path: "otpExpiryMinutes", label: "OTP expiry (minutes)", kind: "number", min: 2, max: 15 },
      { path: "otpResendSeconds", label: "OTP resend wait (seconds)", kind: "number", min: 30, max: 600 },
      { path: "otpMaxAttempts", label: "Maximum OTP attempts", kind: "number", min: 3, max: 10 },
      { path: "showDemographics", label: "Show the profile details (demographic) screen after sign-in", kind: "toggle", hint: "Asks name, landlord / tenant, gender, date of birth, city and state while the profile is incomplete. New users always see it." },
      { path: "demographicsSkippable", label: "Existing users can skip it", kind: "toggle", hint: "Skipped users are asked again at their next sign-in until the profile is complete." },
    ],
  },
  {
    key: "properties",
    title: "Properties",
    description: "Upload limits for property photos. Property types are switched on and off on their own page (below).",
    fields: [
      { path: "maxImages", label: "Maximum photos per property", kind: "number", min: 1, max: 100 },
      { path: "maxDocuments", label: "Maximum documents per property", kind: "number", min: 1, max: 200 },
      { path: "maxImageSizeMB", label: "Maximum photo size (MB)", kind: "number", min: 1, max: 15 },
      { path: "allowedImageFormats", label: "Allowed photo formats", kind: "multi", options: ["jpg", "jpeg", "png", "webp"].map(fmt) },
    ],
  },
  {
    key: "documents",
    title: "Documents",
    description: "Which documents can be uploaded and how. Ownership proofs (sale deed etc.) are always allowed for verification.",
    fields: [
      { path: "@features.rentalAgreements", label: "Agreement upload", kind: "toggle" },
      { path: "@features.electricityBills", label: "Electricity bill upload", kind: "toggle" },
      { path: "@features.propertyTaxDocuments", label: "Property tax upload", kind: "toggle" },
      { path: "@features.otherDocuments", label: "Other document upload", kind: "toggle" },
      { path: "customNameRequired", label: "Name required for “Other” documents", kind: "toggle" },
      { path: "maxFileSizeMB", label: "Maximum file size (MB)", kind: "number", min: 1, max: 25 },
      { path: "allowedFormats", label: "Allowed formats", kind: "multi", options: ["pdf", "jpg", "jpeg", "png", "webp"].map(fmt) },
      { path: "notifyTenantOnUpload", label: "Notify tenant when the landlord shares a document", kind: "toggle" },
      { path: "defaultVisibility", label: "Default visibility of a new document", kind: "select", options: [{ value: "PRIVATE", label: "Private (owner only)" }, { value: "SHARED_WITH_TENANT", label: "Shared with tenant" }] },
    ],
  },
  {
    key: "notifications",
    title: "Notifications",
    description: "Which notifications are sent. Turning one off stops it for every user.",
    fields: [
      { path: "pushEnabled", label: "Push notifications", kind: "toggle", hint: "Used by the Android app when push is added." },
      { path: "rentDue", label: "Rent due reminders", kind: "toggle" },
      { path: "rentOverdue", label: "Rent overdue", kind: "toggle" },
      { path: "paymentSuccess", label: "Payment success", kind: "toggle" },
      { path: "documentUploaded", label: "Document uploaded", kind: "toggle" },
      { path: "agreementUploaded", label: "Agreement uploaded", kind: "toggle" },
      { path: "propertyAssigned", label: "Property assigned", kind: "toggle" },
      { path: "maintenance", label: "Maintenance updates", kind: "toggle" },
    ],
  },
  {
    key: "payments",
    title: "Payments",
    description: "Online payment rules. Gateway keys never appear here — they stay in the server's settings file.",
    fields: [
      { path: "enabled", label: "Payment module", kind: "toggle", hint: "Off = no online rent payment or wallet top-up." },
      { path: "upi", label: "UPI", kind: "toggle" },
      { path: "card", label: "Cards", kind: "toggle" },
      { path: "netbanking", label: "Net banking", kind: "toggle" },
      { path: "currency", label: "Currency", kind: "select", options: [{ value: "INR", label: "INR (₹)" }] },
      { path: "convenienceFee.type", label: "Convenience fee", kind: "select", options: [{ value: "NONE", label: "None" }, { value: "PERCENT", label: "Percentage" }, { value: "FLAT", label: "Flat amount (₹)" }] },
      { path: "convenienceFee.value", label: "Fee value (% or ₹)", kind: "number", min: 0, max: 500 },
      { path: "convenienceFee.maxAmount", label: "Fee cap (₹, optional)", kind: "number", min: 0, max: 5000 },
    ],
  },
  {
    key: "referrals",
    title: "Referrals",
    description: "Reward amounts per program are set on the Referrals page (below), so they live in one place.",
    fields: [
      { path: "@features.referrals", label: "Referral system", kind: "toggle" },
      { path: "minSuccessfulReferrals", label: "Minimum successful referrals (shown in the app)", kind: "number", min: 1, max: 100 },
      { path: "eligibilityRules", label: "Eligibility rules (shown in the app)", kind: "textarea" },
    ],
  },
  {
    key: "support",
    title: "Support",
    description: "Contact details shown in the app's Help screen.",
    fields: [
      { path: "email", label: "Support email", kind: "text" },
      { path: "phone", label: "Support phone", kind: "text", hint: "e.g. +919876543210" },
      { path: "whatsapp", label: "WhatsApp number", kind: "text" },
      { path: "helpCenterUrl", label: "Help center URL", kind: "url" },
      { path: "faqEnabled", label: "Show FAQ", kind: "toggle" },
    ],
  },
  {
    key: "splash",
    title: "Splash screen",
    description: "The first screen of the app. Switch it off to go straight to sign-in (only the short system splash shows).",
    fields: [
      { path: "version", label: "Splash version", kind: "readonly", hint: "Goes up automatically every time you save a change in this section: 1.0 → 1.1 … 1.9 → 2.0." },
      { path: "enabled", label: "Show splash screen", kind: "toggle" },
      { path: "title", label: "Title", kind: "text" },
      { path: "description", label: "Description", kind: "textarea" },
      { path: "lightLogoUrl", label: "Light theme logo", kind: "media", media: "IMAGE", hint: "Shown when the phone is in light mode. Upload a PNG / JPG / WEBP (max 5 MB) or paste an https:// link. Empty = the logo built into the app." },
      { path: "darkLogoUrl", label: "Dark theme logo", kind: "media", media: "IMAGE", hint: "Shown when the phone is in dark mode. Upload a PNG / JPG / WEBP (max 5 MB) or paste an https:// link. Empty = the light theme logo is used." },
      { path: "lottieUrl", label: "Loading animation (Lottie)", kind: "media", media: "LOTTIE", hint: "Upload a Lottie .json (max 5 MB) or paste an https:// link. Empty = the app's default spinner." },
      { path: "minDurationMs", label: "Show for at least (milliseconds)", kind: "number", min: 0, max: 5000, hint: "0–5000. The splash may stay longer while the app loads." },
    ],
  },
  {
    key: "onboarding",
    title: "Onboarding",
    description: "Intro screens shown after the splash and before sign-in. Add as many as you need (up to 10); each has a title, description and an optional image, video or Lottie animation.",
    fields: [
      { path: "version", label: "Onboarding version", kind: "readonly", hint: "Goes up automatically every time you save a change in this section (1.0 → 1.1 … 1.9 → 2.0) — with \"show once\", the app shows the new version again." },
      { path: "enabled", label: "Show onboarding", kind: "toggle" },
      { path: "showOnce", label: "Show only once per install", kind: "toggle", hint: "Shown again automatically if you change the screens." },
      { path: "skippable", label: "Allow Skip", kind: "toggle" },
      { path: "nextButtonText", label: "Next button text", kind: "text", hint: "Used on every screen except the last, unless the screen has its own text." },
      { path: "finishButtonText", label: "Last screen button text", kind: "text", hint: "e.g. Get started — used on the last screen unless it has its own text." },
      { path: "skipButtonText", label: "Skip button text", kind: "text" },
      { path: "screens", label: "Screens", kind: "screens" },
    ],
  },
  {
    key: "ui",
    title: "Branding & UI",
    description: "Colours, images and the announcement / promo banner in the app.",
    fields: [
      { path: "primaryColor", label: "Primary colour", kind: "color" },
      { path: "secondaryColor", label: "Secondary colour", kind: "color" },
      { path: "accentColor", label: "Accent colour", kind: "color" },
      { path: "logoUrl", label: "Logo URL", kind: "url" },
      { path: "darkMode", label: "Dark mode available", kind: "toggle" },
      { path: "announcementEnabled", label: "Show announcement", kind: "toggle" },
      { path: "announcementTitle", label: "Announcement title", kind: "text" },
      { path: "announcementMessage", label: "Announcement message", kind: "textarea" },
      { path: "bannerEnabled", label: "Show promotional banner", kind: "toggle" },
      { path: "bannerImageUrl", label: "Banner image URL", kind: "url" },
      { path: "bannerLinkUrl", label: "Banner link URL (optional)", kind: "url" },
    ],
  },
  {
    key: "legal",
    title: "Legal",
    description: "Links opened from the app's sign-up and settings screens, and the current Terms / Privacy versions recorded when users accept them.",
    fields: [
      { path: "privacyPolicyUrl", label: "Privacy policy URL", kind: "url" },
      { path: "termsUrl", label: "Terms and conditions URL", kind: "url" },
      { path: "refundPolicyUrl", label: "Refund policy URL", kind: "url" },
      { path: "termsVersion", label: "Terms of Service version", kind: "text", hint: "e.g. 2026-11-01. Recorded with each user's acceptance at sign-in." },
      { path: "privacyVersion", label: "Privacy Policy version", kind: "text", hint: "e.g. 2026-11-01. Recorded with each user's acceptance at sign-in." },
    ],
  },
];

/**
 * Tab order follows how the app is experienced: the app itself and its availability, what users see
 * first (splash, onboarding, branding), signing in, the modules, money, messages, help and legal.
 */
const TAB_ORDER = ["app", "maintenance", "splash", "onboarding", "ui", "auth", "features", "properties", "documents", "payments", "referrals", "notifications", "support", "legal"];
const ORDERED_SECTIONS = [...SECTIONS].sort((a, b) => {
  const ia = TAB_ORDER.indexOf(a.key);
  const ib = TAB_ORDER.indexOf(b.key);
  return (ia === -1 ? TAB_ORDER.length : ia) - (ib === -1 ? TAB_ORDER.length : ib);
});

/* ─────────────── Onboarding screens editor ─────────────── */

interface OnboardingScreen {
  id: string;
  title: string;
  description: string;
  /** Empty = the section's Next / last-screen text. */
  buttonText: string;
  mediaType: "NONE" | "IMAGE" | "VIDEO" | "LOTTIE";
  /** Only the field that matches mediaType is filled (the server clears the others). */
  imageUrl: string;
  videoUrl: string;
  lottieUrl: string;
}
const MEDIA_FIELD = { IMAGE: "imageUrl", VIDEO: "videoUrl", LOTTIE: "lottieUrl" } as const;
const mediaOf = (sc: OnboardingScreen) => (sc.mediaType === "NONE" ? "" : (sc[MEDIA_FIELD[sc.mediaType]] ?? ""));
const MAX_SCREENS = 10;
const MEDIA_OPTIONS = [
  { value: "NONE", label: "No media" },
  { value: "IMAGE", label: "Image (PNG / JPG / WebP)" },
  { value: "VIDEO", label: "Video (MP4)" },
  { value: "LOTTIE", label: "Lottie animation (JSON)" },
];
const newScreenId = () => `screen-${Math.random().toString(36).slice(2, 8)}`;

/** Uploaded assets are stored as "/api/v1/app/assets/…" — shown from the API server. */
const mediaSrc = (url: string) => (url.startsWith("/api/") ? `${API_URL}${url}` : url);

function MediaPreview({ type, url, dark = false }: { type: OnboardingScreen["mediaType"]; url: string; dark?: boolean }) {
  if (type === "NONE" || !(/^https:\/\//i.test(url) || url.startsWith("/api/v1/app/assets/"))) return null;
  const src = mediaSrc(url);
  if (type === "IMAGE") return <img src={src} alt="" className={cn("h-28 w-full rounded-control border border-line object-contain p-2", dark ? "bg-[#0F1115]" : "bg-subtle")} />;
  if (type === "VIDEO") return <video src={src} muted loop autoPlay playsInline className="h-28 w-full rounded-control border border-line bg-ink object-contain" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-dark underline">
      Open Lottie file <ExternalLink className="size-3" />
    </a>
  );
}

const ACCEPT: Record<OnboardingScreen["mediaType"], string> = {
  NONE: "",
  IMAGE: "image/png,image/jpeg,image/webp",
  VIDEO: "video/mp4",
  LOTTIE: ".json,application/json",
};

/** Link field with an Upload button: upload a file (stored by the API) or paste an https:// link. */
function MediaInput({ label, hint, type, value, onChange, darkPreview = false }: { label: string; hint?: string; type: OnboardingScreen["mediaType"]; value: string; onChange: (v: string) => void; darkPreview?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await upload<{ url: string }>("/admin/app-config/assets", form);
      onChange(r.url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Input label={label} hint={hint ?? "Upload a file or paste an https:// link"} value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />
        </div>
        <input ref={input} type="file" hidden accept={ACCEPT[type]} onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="flex gap-2 sm:mb-6">
          <Button variant="secondary" loading={busy} leftIcon={<Upload className="size-4" />} onClick={() => input.current?.click()}>Upload</Button>
          {value && <Button variant="ghost" aria-label={`Clear ${label}`} onClick={() => onChange("")}><X className="size-4" /></Button>}
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <MediaPreview type={type} url={value} dark={darkPreview} />
    </div>
  );
}

/** Add, edit, reorder and remove onboarding screens. The order here is the order in the app. */
function OnboardingScreensEditor({ value, onChange }: { value: OnboardingScreen[]; onChange: (v: OnboardingScreen[]) => void }) {
  const update = (i: number, patch: Partial<OnboardingScreen>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {value.length === 0 && <p className="rounded-control border border-dashed border-line p-4 text-center text-sm text-muted">No screens yet. Add the first one.</p>}
      {value.map((sc, i) => (
        <div key={sc.id} className="rounded-control border border-line p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Screen {i + 1}</p>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
              <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
              <Button size="sm" variant="ghost" aria-label="Remove screen" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></Button>
            </div>
          </div>
          <div className="space-y-2">
            <Input label="Title" value={sc.title} maxLength={80} onChange={(e) => update(i, { title: e.target.value })} />
            <Textarea label="Description" rows={2} value={sc.description} maxLength={300} onChange={(e) => update(i, { description: e.target.value })} />
            <Input
              label="Button text (optional)"
              hint={`Empty = "${i === value.length - 1 ? "last screen button text (Get started)" : "Next button text"}" from the settings above.`}
              placeholder={i === value.length - 1 ? "Get started" : "Next"}
              value={sc.buttonText ?? ""}
              maxLength={30}
              onChange={(e) => update(i, { buttonText: e.target.value })}
            />
            <div className="grid gap-2 sm:max-w-sm">
              <Select label="Media" options={MEDIA_OPTIONS} value={sc.mediaType} onChange={(e) => update(i, { mediaType: e.target.value as OnboardingScreen["mediaType"], imageUrl: "", videoUrl: "", lottieUrl: "" })} />
            </div>
            {sc.mediaType !== "NONE" && (
              <MediaInput
                key={sc.mediaType}
                label={sc.mediaType === "IMAGE" ? "Image" : sc.mediaType === "VIDEO" ? "Video" : "Lottie animation"}
                type={sc.mediaType}
                value={mediaOf(sc)}
                onChange={(v) => update(i, { [MEDIA_FIELD[sc.mediaType as keyof typeof MEDIA_FIELD]]: v })}
              />
            )}
          </div>
        </div>
      ))}
      <Button
        variant="secondary"
        leftIcon={<Plus className="size-4" />}
        disabled={value.length >= MAX_SCREENS}
        onClick={() => onChange([...value, { id: newScreenId(), title: "", description: "", buttonText: "", mediaType: "NONE", imageUrl: "", videoUrl: "", lottieUrl: "" }])}
      >
        Add screen{value.length >= MAX_SCREENS ? ` (max ${MAX_SCREENS})` : ""}
      </Button>
    </div>
  );
}

/* ─────────────── Helpers ─────────────── */

/** "@features.x" points into another section; "a.b" walks nested objects. */
function resolve(section: string, path: string): string[] {
  return path.startsWith("@") ? path.slice(1).split(".") : [section, ...path.split(".")];
}
function getAt(cfg: Config, parts: string[]): unknown {
  return parts.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), cfg);
}
function setAt(cfg: Config, parts: string[], value: unknown): Config {
  const next = structuredClone(cfg);
  let o = next as Record<string, unknown>;
  for (const k of parts.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[parts.at(-1)!] = value;
  return next;
}
function diff(a: unknown, b: unknown, prefix = ""): string[] {
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
}
/** ISO ↔ the value a datetime-local input wants (local time). */
function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function explain(err: unknown): string {
  const issues = err instanceof AppError ? (err.details?.issues as Array<{ path?: string | string[]; message: string }> | undefined) : undefined;
  if (!issues?.length) return errorMessage(err);
  return issues.map((i) => `${Array.isArray(i.path) ? i.path.join(".") : (i.path ?? "")}: ${i.message}`.replace(/^: /, "")).join(" · ");
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors", on ? "bg-brand" : "bg-line")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function FieldRow({ field, value, changed, onChange }: { field: Field; value: unknown; changed: boolean; onChange: (v: unknown) => void }) {
  const label = (
    <span className="flex items-center gap-2">
      {field.label}
      {changed && <Badge tone="warning">Changed</Badge>}
    </span>
  );
  switch (field.kind) {
    case "toggle":
      return (
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{label}</p>
            {field.hint && <p className="text-xs text-muted">{field.hint}</p>}
          </div>
          <Toggle on={value === true} onChange={onChange} label={field.label} />
        </div>
      );
    case "textarea":
      return <div className="py-2"><Textarea label={field.label} hint={field.hint} rows={3} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{changed && <Badge tone="warning">Changed</Badge>}</div>;
    case "number":
      return (
        <div className="py-2">
          <Input
            label={field.label}
            type="number"
            min={field.min}
            max={field.max}
            hint={field.hint ?? (field.min !== undefined ? `${field.min}–${field.max}` : undefined)}
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? (field.path.endsWith("maxAmount") ? null : 0) : Number(e.target.value))}
          />
          {changed && <Badge tone="warning">Changed</Badge>}
        </div>
      );
    case "color":
      return (
        <div className="flex items-end gap-3 py-2">
          <input type="color" aria-label={field.label} value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#000000"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-10 w-12 cursor-pointer rounded-control border border-line" />
          <div className="flex-1"><Input label={field.label} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} /></div>
          {changed && <Badge tone="warning">Changed</Badge>}
        </div>
      );
    case "select":
      return <div className="py-2"><Select label={field.label} hint={field.hint} options={field.options ?? []} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />{changed && <Badge tone="warning">Changed</Badge>}</div>;
    case "datetime":
      return (
        <div className="py-2">
          <Input label={field.label} hint={field.hint} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />
          {changed && <Badge tone="warning">Changed</Badge>}
        </div>
      );
    case "readonly":
      return (
        <div className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{field.label}</p>
            {field.hint && <p className="text-xs text-muted">{field.hint}</p>}
          </div>
          <Badge>v{String(value ?? "1.0")}</Badge>
        </div>
      );
    case "media":
      return (
        <div className="py-2">
          <MediaInput label={field.label} hint={field.hint} type={field.media ?? "IMAGE"} value={String(value ?? "")} onChange={onChange} darkPreview={field.path === "darkLogoUrl"} />
          {changed && <Badge tone="warning">Changed</Badge>}
        </div>
      );
    case "screens":
      return (
        <div className="py-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-ink">{label}</p>
          <OnboardingScreensEditor value={Array.isArray(value) ? (value as OnboardingScreen[]) : []} onChange={onChange} />
        </div>
      );
    case "multi":
    case "roles": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      const opts = field.kind === "roles" ? STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r })) : (field.options ?? []);
      return (
        <fieldset className="py-3">
          <legend className="text-sm font-medium text-ink">{label}</legend>
          {field.hint && <p className="text-xs text-muted">{field.hint}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {opts.map((o) => {
              const checked = list.includes(o.value);
              return (
                <label key={o.value} className={cn("flex cursor-pointer items-center gap-2 rounded-control border px-3 py-1.5 text-sm", checked ? "border-brand bg-brand-bg text-brand-dark" : "border-line")}>
                  <input type="checkbox" checked={checked} onChange={() => onChange(checked ? list.filter((x) => x !== o.value) : [...list, o.value])} />
                  {o.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }
    default:
      return (
        <div className="py-2">
          <Input label={field.label} hint={field.hint ?? (field.kind === "url" ? "https:// link, or leave empty" : undefined)} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
          {changed && <Badge tone="warning">Changed</Badge>}
        </div>
      );
  }
}

/** Read-only view of settings that live on their own pages (one source of truth). */
function Linked({ section, data }: { section: string; data: AdminConfig["linked"] }) {
  if (section === "properties") {
    const on = data.propertyTypes.filter((t) => t.enabled);
    return (
      <div className="rounded-control bg-subtle p-4 text-sm">
        <p className="font-medium">Property types: {on.length} of {data.propertyTypes.length} on</p>
        <p className="mt-1 text-muted">{on.map((t) => t.label).join(", ") || "None"}</p>
        <Link to="/property-types" className="mt-2 inline-flex items-center gap-1 text-brand-dark underline">Manage property types <ExternalLink className="size-3.5" /></Link>
      </div>
    );
  }
  if (section === "payments") {
    return (
      <div className="rounded-control bg-subtle p-4 text-sm">
        <p className="font-medium">Gateways</p>
        <ul className="mt-1 space-y-1">
          {data.paymentGateways.map((g) => (
            <li key={g.provider} className="flex items-center gap-2">{g.label} <Badge tone={g.available ? "success" : "neutral"}>{g.available ? `On${g.mode ? ` · ${g.mode}` : ""}` : g.enabled ? "On, not ready" : "Off"}</Badge></li>
          ))}
        </ul>
        <Link to="/admin/payment-gateways" className="mt-2 inline-flex items-center gap-1 text-brand-dark underline">Manage payment gateways <ExternalLink className="size-3.5" /></Link>
      </div>
    );
  }
  if (section === "referrals") {
    return (
      <div className="rounded-control bg-subtle p-4 text-sm">
        <p className="font-medium">Referral programs</p>
        <ul className="mt-1 space-y-1">
          {data.referralPrograms.map((r) => (
            <li key={r.type} className="flex items-center gap-2">{r.type.replaceAll("_", " ").toLowerCase()} <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? `On${r.rewardAmount ? ` · ₹${r.rewardAmount}` : ""}` : "Off"}</Badge></li>
          ))}
        </ul>
        <Link to="/admin/referrals" className="mt-2 inline-flex items-center gap-1 text-brand-dark underline">Manage referral programs <ExternalLink className="size-3.5" /></Link>
      </div>
    );
  }
  return null;
}

/* ─────────────── Page ─────────────── */

/** /admin/app-config — central control of the Android app (app_config.manage). */
export function AppConfigPage() {
  const { data, loading, error, reload } = useQuery(() => request<AdminConfig>("/admin/app-config"), []);
  const [tab, setTab] = useState<string>("app");
  const [draft, setDraft] = useState<Config | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (data) setDraft(structuredClone(data.config));
  }, [data]);

  const changes = useMemo(() => (data && draft ? diff(data.config, draft) : []), [data, draft]);

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="size-7 text-brand" /></div>;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data || !draft) return null;

  const critical = changes.filter((c) => data.criticalPaths.includes(c));
  const tabItems = [...ORDERED_SECTIONS.map((s) => ({ value: s.key, label: s.title })), { value: "history", label: "History" }];
  const section = SECTIONS.find((s) => s.key === tab);

  const save = () =>
    confirm({
      title: critical.length ? "Save important changes?" : `Save as version ${data.version + 1}?`,
      tone: critical.length ? "danger" : "primary",
      confirmLabel: "Save configuration",
      message: (
        <div className="space-y-2">
          <p>{changes.length} setting{changes.length === 1 ? "" : "s"} changed. The app picks this up within a minute.</p>
          {critical.length > 0 && <Alert kind="error">These affect every user right away: {critical.join(", ")}</Alert>}
          <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs text-muted">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ),
      reason: { label: "Note for the history (optional)", required: false },
      onConfirm: async (note) => {
        setSaving(true);
        setMsg(null);
        try {
          const r = await request<{ version: number }>("/admin/app-config", { method: "PUT", body: { baseVersion: data.version, config: draft, note: note || undefined } });
          setMsg({ kind: "success", text: `Saved as version ${r.version}.` });
          await reload();
        } catch (err) {
          setMsg({ kind: "error", text: explain(err) });
        } finally {
          setSaving(false);
        }
      },
    });

  return (
    <>
      <PageHeader
        title="App configuration"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Smartphone className="size-4" /> Version {data.version}
            {data.updatedAt ? ` · last changed ${formatTimestamp(data.updatedAt)}${data.updatedBy ? ` by ${data.updatedBy.fullName}` : ""}` : " · defaults (never saved)"}
          </span>
        }
        actions={
          tab !== "history" && (
            <>
              <Button variant="secondary" leftIcon={<Undo2 className="size-4" />} disabled={!changes.length || saving} onClick={() => setDraft(structuredClone(data.config))}>Discard</Button>
              <Button leftIcon={<Save className="size-4" />} disabled={!changes.length} loading={saving} onClick={save}>Save{changes.length ? ` (${changes.length})` : ""}</Button>
            </>
          )
        }
      />
      {msg && <Alert kind={msg.kind} className="mb-4">{msg.text}</Alert>}
      {draft.maintenance?.enabled === true && <Alert kind="error" className="mb-4">Maintenance mode is ON in this configuration{data.config.maintenance?.enabled ? " — customers can't use the app right now." : " (not saved yet)."}</Alert>}

      {/* Phones: a dropdown. Tablets and up: every tab with its full name, wrapping onto more rows. */}
      <div className="mb-4 md:hidden">
        <Select label="Section" options={tabItems} value={tab} onChange={(e) => setTab(e.target.value)} />
      </div>
      <div className="mb-4 hidden md:block">
        <Tabs<string> idPrefix="appcfg" layout="wrap" value={tab} onChange={setTab} items={tabItems} />
      </div>

      {section && (
        <section className="card w-full space-y-2 p-4 sm:p-6">
          <h2 className="font-semibold">{section.title}</h2>
          <p className="text-sm text-muted">{section.description}</p>
          <div className="divide-y divide-line">
            {section.fields.map((f) => {
              const parts = resolve(section.key, f.path);
              return (
                <FieldRow
                  key={f.path}
                  field={f}
                  value={getAt(draft, parts)}
                  changed={changes.includes(parts.join("."))}
                  onChange={(v) => setDraft((d) => (d ? setAt(d, parts, v) : d))}
                />
              );
            })}
          </div>
          <Linked section={section.key} data={data.linked} />
          <div className="flex justify-end pt-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw className="size-4" />}
              onClick={() => setDraft((d) => (d ? { ...d, [section.key]: structuredClone(data.defaults[section.key]) } : d))}
            >
              Reset this section to defaults
            </Button>
          </div>
        </section>
      )}

      {tab === "history" && <HistoryTab currentVersion={data.version} onRestored={async (t) => { setMsg({ kind: "success", text: t }); await reload(); }} />}
      {dialog}
    </>
  );
}

function HistoryTab({ currentVersion, onRestored }: { currentVersion: number; onRestored: (msg: string) => Promise<void> }) {
  const [page, setPage] = useState(1);
  const list = useQuery(() => request<Paged<HistoryRow>>("/admin/app-config/history", { query: { page, pageSize: 20 } }), [page, currentVersion]);
  const [view, setView] = useState<HistoryRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const restore = (r: HistoryRow) =>
    confirm({
      title: `Restore version ${r.version}?`,
      tone: "danger",
      confirmLabel: "Restore",
      message: `Version ${r.version}'s settings become active again, saved as version ${currentVersion + 1}. Nothing is deleted from the history.`,
      reason: { label: "Reason (optional)", required: false },
      onConfirm: async (note) => {
        setErr(null);
        try {
          const res = await request<{ version: number }>(`/admin/app-config/rollback/${r.id}`, { method: "POST", body: { baseVersion: currentVersion, note: note || undefined } });
          await onRestored(`Version ${r.version} restored as version ${res.version}.`);
        } catch (e) {
          setErr(explain(e));
        }
      },
    });

  return (
    <section className="space-y-3">
      {err && <Alert kind="error">{err}</Alert>}
      <DataTable<HistoryRow>
        rows={list.data?.items}
        loading={list.loading}
        error={list.error}
        rowKey={(r) => r.id}
        empty="No saved versions yet — the app is using the defaults."
        columns={[
          { key: "v", header: "Version", render: (r) => <span className="flex items-center gap-2 font-semibold">v{r.version}{r.active && <Badge tone="success">Active</Badge>}</span> },
          { key: "what", header: "Change", render: (r) => <span className="text-sm">{r.action === "ROLLBACK" ? `Restored v${r.rolledBackFromVersion}` : r.changedPaths.length ? `${r.changedPaths.slice(0, 3).join(", ")}${r.changedPaths.length > 3 ? ` +${r.changedPaths.length - 3} more` : ""}` : "No changes"}{r.note && <span className="block text-xs text-muted">{r.note}</span>}</span> },
          { key: "by", header: "By", render: (r) => r.createdBy?.fullName ?? "—", className: "hidden md:table-cell" },
          { key: "when", header: "When", render: (r) => formatTimestamp(r.createdAt) },
          {
            key: "act",
            header: "",
            render: (r) => (
              <span className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" leftIcon={<History className="size-4" />} onClick={() => setView(r)}>View</Button>
                {!r.active && <Button size="sm" variant="secondary" leftIcon={<RotateCcw className="size-4" />} onClick={() => restore(r)}>Restore</Button>}
              </span>
            ),
          },
        ]}
      />
      {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onPage={setPage} />}
      {view && <VersionModal row={view} onClose={() => setView(null)} />}
      {dialog}
    </section>
  );
}

function VersionModal({ row, onClose }: { row: HistoryRow; onClose: () => void }) {
  const { data, loading, error } = useQuery(() => request<{ config: Config }>(`/admin/app-config/history/${row.id}`), [row.id]);
  return (
    <Modal open onClose={onClose} title={`Version ${row.version}`} description={`${formatTimestamp(row.createdAt)}${row.createdBy ? ` · ${row.createdBy.fullName}` : ""}`}>
      {loading && !data && <Spinner className="size-6 text-brand" />}
      {error && <Alert kind="error">{error}</Alert>}
      {row.changedPaths.length > 0 && <p className="mb-2 text-sm"><span className="font-medium">Changed:</span> {row.changedPaths.join(", ")}</p>}
      {data && <pre className="max-h-[60vh] overflow-auto rounded-control bg-subtle p-3 text-xs">{JSON.stringify(data.config, null, 2)}</pre>}
    </Modal>
  );
}
