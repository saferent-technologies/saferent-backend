/**
 * Remembers an invitation link opened while signed out, so the user lands back on it after signing in
 * or registering (those flows always go to the dashboard). Kept for one hour only.
 */
const KEY = "saferent.pendingInvite";
const TTL_MS = 60 * 60 * 1000;

export function savePendingInvite(path: string): void {
  if (!/^\/invite\/[A-Za-z0-9_-]{43}$/.test(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    /* storage unavailable: the user can open the link again */
  }
}

export function pendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path: string; at: number };
    if (Date.now() - at > TTL_MS || !/^\/invite\/[A-Za-z0-9_-]{43}$/.test(path)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
