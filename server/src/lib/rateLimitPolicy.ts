/** Fixed-window rate limiting math. Pure (no Firestore) so it can be unit-tested. */

export interface RateLimitState {
  count: number;
  windowStartMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  next: RateLimitState;
  retryAfterMs: number;
}

export function evaluateRateLimit(
  state: RateLimitState | null,
  nowMs: number,
  limit: number,
  windowMs: number,
): RateLimitDecision {
  const windowActive = state !== null && nowMs - state.windowStartMs < windowMs;
  const current: RateLimitState = windowActive ? state : { count: 0, windowStartMs: nowMs };
  if (current.count >= limit) {
    return { allowed: false, next: current, retryAfterMs: current.windowStartMs + windowMs - nowMs };
  }
  return { allowed: true, next: { count: current.count + 1, windowStartMs: current.windowStartMs }, retryAfterMs: 0 };
}

