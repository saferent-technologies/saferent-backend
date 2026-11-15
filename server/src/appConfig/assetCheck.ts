import { sniffMime } from "../lib/upload-sniff";

/*
 * What can be uploaded as an app asset (splash logo, loading animation, onboarding media) and how
 * its content is checked. Pure — unit tested in test/appConfig.test.ts.
 */

export type AssetKind = "IMAGE" | "VIDEO" | "LOTTIE";

export const ASSET_TYPES: Record<string, { kind: AssetKind; ext: string; maxBytes: number; label: string }> = {
  "image/png": { kind: "IMAGE", ext: "png", maxBytes: 5 * 1024 * 1024, label: "PNG" },
  "image/jpeg": { kind: "IMAGE", ext: "jpg", maxBytes: 5 * 1024 * 1024, label: "JPG" },
  "image/webp": { kind: "IMAGE", ext: "webp", maxBytes: 5 * 1024 * 1024, label: "WEBP" },
  "video/mp4": { kind: "VIDEO", ext: "mp4", maxBytes: 25 * 1024 * 1024, label: "MP4" },
  "application/json": { kind: "LOTTIE", ext: "json", maxBytes: 5 * 1024 * 1024, label: "Lottie JSON" },
};

export const ASSET_MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(ASSET_TYPES).map(([mime, t]) => [t.ext, mime]));

/** MP4: an ISO-BMFF "ftyp" box right at the start (bytes 4–7). */
export function looksLikeMp4(head: Uint8Array): boolean {
  return head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

/** A Lottie animation is a JSON object with a version string and a layers array. */
export function looksLikeLottie(text: string): boolean {
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    return !!v && typeof v === "object" && !Array.isArray(v) && typeof v.v === "string" && Array.isArray(v.layers);
  } catch {
    return false;
  }
}

/** null when the content matches the declared type and size, otherwise a message for the admin. */
export function assetProblem(mime: string, size: number, head: Uint8Array, text?: string): string | null {
  const t = ASSET_TYPES[mime];
  if (!t) return "Upload a PNG, JPG or WEBP image, an MP4 video or a Lottie JSON file.";
  if (size > t.maxBytes) return `${t.label} files can be up to ${t.maxBytes / 1048576} MB.`;
  if (t.kind === "IMAGE" && sniffMime(head) !== mime) return "The file content does not match its type. Upload a real PNG, JPG or WEBP image.";
  if (t.kind === "VIDEO" && !looksLikeMp4(head)) return "This isn't a valid MP4 video.";
  if (t.kind === "LOTTIE" && !looksLikeLottie(text ?? "")) return "This isn't a Lottie animation (a JSON file exported from After Effects / LottieFiles).";
  return null;
}
