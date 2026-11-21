/** Pure name-lock rules (unit tested in test/nameLock.test.ts). */

/** Same name for the lock: trimmed, inner spaces collapsed, case insensitive. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return n(a) === n(b);
}

/** Would this request change a locked name? (No name sent, or the same name, is fine.) */
export function nameChangeBlocked(locked: boolean, stored: string, incoming: string | null | undefined): boolean {
  return locked && incoming !== undefined && incoming !== null && !sameName(stored, incoming);
}

export const NAME_LOCKED_MESSAGE = "Your name is verified, so it can't be changed. Contact support.";
