/**
 * Referral code from a /ref link opened before sign-up. The FIRST valid link is kept (a later link
 * doesn't replace it) for 30 days; it is sent with registration, where the server decides and locks
 * the attribution.
 */
const KEY = "saferent.pendingReferral";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VALID = /^SR-(TEN|LAND)-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;

export function savePendingReferral(code: string, kind: "TENANT" | "LANDLORD"): void {
  if (!VALID.test(code) || pendingReferral()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, kind, at: Date.now() }));
  } catch {
    /* storage unavailable */
  }
}

export function pendingReferral(): { code: string; kind: "TENANT" | "LANDLORD" } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { code: string; kind: "TENANT" | "LANDLORD"; at: number };
    if (Date.now() - v.at > TTL_MS || !VALID.test(v.code)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { code: v.code, kind: v.kind };
  } catch {
    return null;
  }
}

export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
