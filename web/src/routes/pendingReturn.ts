/**
 * Where a visitor wanted to go before signing in (e.g. "Apply" on a public listing → /browse/:id).
 * Kept for this browser tab only; only same-site customer paths are accepted.
 */
const KEY = "saferent.returnTo";
const SAFE = /^\/(browse|invite|referrals|dashboard)(\/[A-Za-z0-9_-]+)*$/;

export function savePendingReturn(path: string): void {
  if (!SAFE.test(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* storage unavailable */
  }
}

export function pendingReturn(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && SAFE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
