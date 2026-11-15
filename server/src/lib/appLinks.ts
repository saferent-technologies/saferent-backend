import type { Request, Response } from "express";
import { env } from "../config/env";

/**
 * Android App Links.
 *  - appLink(path): absolute https link for links people share or receive (invitations, emails, SMS),
 *    on APP_LINK_ORIGIN so the installed app opens it directly; the website serves the same paths.
 *  - GET /.well-known/assetlinks.json: Digital Asset Links statement built from env (no code change
 *    to add a fingerprint). Must be reachable on every app host without redirects or auth.
 */
export function appLinkOrigin(): string {
  return (env.APP_LINK_ORIGIN || env.APP_ORIGIN.split(",")[0] || "http://localhost:5173").trim().replace(/\/$/, "");
}

/** "/invite/abc" → "https://app.saferenttechnologies.com/invite/abc" */
export function appLink(path: string): string {
  return `${appLinkOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Valid fingerprints from ANDROID_SHA256_FINGERPRINTS (normalised to uppercase); invalid ones are reported. */
export function assetFingerprints(raw = env.ANDROID_SHA256_FINGERPRINTS): { valid: string[]; invalid: string[] } {
  const items = raw.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  return { valid: [...new Set(items.filter((x) => FINGERPRINT.test(x)))], invalid: items.filter((x) => !FINGERPRINT.test(x)) };
}

export function assetLinksStatement(packageName = env.ANDROID_APP_PACKAGE, raw = env.ANDROID_SHA256_FINGERPRINTS) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: assetFingerprints(raw).valid },
    },
  ];
}

let warned = false;
/** GET /.well-known/assetlinks.json — 200, application/json, no auth, no redirect. */
export function serveAssetLinks(_req: Request, res: Response): void {
  const { valid, invalid } = assetFingerprints();
  if (!warned && (invalid.length || !valid.length)) {
    warned = true;
    console.warn(`[assetlinks] ${valid.length} valid fingerprint(s)${invalid.length ? `; ignored invalid: ${invalid.join(", ")}` : ""}. Set ANDROID_SHA256_FINGERPRINTS (AB:CD:… format).`);
  }
  res.status(200).type("application/json").set("Cache-Control", "public, max-age=300").send(JSON.stringify(assetLinksStatement(), null, 2));
}
