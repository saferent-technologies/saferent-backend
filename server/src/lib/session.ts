/**
 * A verified admin session = proof that the second factor (email OTP or phone OTP) was completed
 * for ONE specific Firebase sign-in. It is bound to the ID token's `auth_time`, so signing in again
 * (even with the right password) produces a new auth_time and requires a fresh second factor.
 */
export interface SessionLike {
  authTime: number;
  expiresAt: Date;
  revoked: boolean;
}

export function isSessionValid(session: SessionLike | undefined | null, authTime: number, nowMs: number): boolean {
  if (!session) return false;
  if (session.revoked) return false;
  if (session.authTime !== authTime) return false;
  return session.expiresAt.getTime() > nowMs;
}

export function secondsSince(epochSeconds: number, nowMs: number): number {
  return Math.floor(nowMs / 1000) - epochSeconds;
}
