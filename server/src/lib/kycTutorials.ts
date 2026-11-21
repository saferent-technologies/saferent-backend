/**
 * Owner verification guides: pure validation (unit tested in test/kycTutorials.test.ts).
 * Files must be directly playable / downloadable: uploaded here, or an https link to the file itself.
 */
export const TUTORIAL_TYPES = ["VIDEO", "PDF", "IMAGE"] as const;
export type TutorialType = (typeof TUTORIAL_TYPES)[number];

export const TUTORIAL_MAX_BYTES: Record<TutorialType, number> = {
  VIDEO: 50 * 1024 * 1024,
  PDF: 30 * 1024 * 1024,
  IMAGE: 5 * 1024 * 1024,
};

const EXT: Record<TutorialType, RegExp> = {
  VIDEO: /\.mp4$/i,
  PDF: /\.pdf$/i,
  IMAGE: /\.(jpe?g|png|webp)$/i,
};

/** Share / page hosts that don't serve the file itself. */
const PAGE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com|docs\.google\.com|dropbox\.com|onedrive\.live\.com|1drv\.ms|instagram\.com|facebook\.com)$/i;

/** External link check. Returns a message, or null when it's acceptable. */
export function tutorialUrlProblem(type: TutorialType, raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "Enter a valid link.";
  }
  if (u.protocol !== "https:") return "The link must start with https://.";
  if (PAGE_HOSTS.test(u.hostname)) return "Use a direct file link (not YouTube, Drive or other share pages), or upload the file.";
  // Firebase Storage download URLs keep the file name (URL-encoded) in the path.
  const path = decodeURIComponent(u.pathname);
  if (!EXT[type].test(path)) return type === "VIDEO" ? "The link must point to an .mp4 file." : type === "PDF" ? "The link must point to a .pdf file." : "The link must point to a .jpg, .png or .webp file.";
  return null;
}

/** Uploaded file check by magic bytes + size. `mp4H264` = the file has an H.264 (avc1) track. */
export function tutorialFileProblem(type: TutorialType, head: Uint8Array, size: number, mime: string | null, mp4H264 = false): string | null {
  if (size > TUTORIAL_MAX_BYTES[type]) return `This file is too large. ${type === "VIDEO" ? "Videos" : type === "PDF" ? "PDFs" : "Images"} can be up to ${TUTORIAL_MAX_BYTES[type] / 1048576} MB.`;
  if (type === "VIDEO") {
    const isMp4 = head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70; // "ftyp"
    if (!isMp4) return "Upload an MP4 video.";
    if (!mp4H264) return "The video must be MP4 with H.264. Export it again as H.264 MP4.";
    return null;
  }
  if (type === "PDF") return head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 ? null : "Upload a PDF file.";
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp" ? null : "Upload a JPG, PNG or WEBP image.";
}

/** ID type key of a guide: a known one or any new key staff add later (e.g. VOTER_ID). */
export const ID_TYPE_KEY = /^[A-Z][A-Z0-9_]{1,29}$/;

/** Title: required, at most 60 characters, no dashes. Returns a message or null. */
export function tutorialTitleProblem(title: string): string | null {
  const t = title.trim();
  if (t.length < 2) return "Enter a title.";
  if (t.length > 60) return "Keep the title to 60 characters.";
  if (/[\u2012-\u2015]/.test(t) || /(^|\s)-(\s|$)/.test(t)) return "Write the title without dashes.";
  return null;
}
