import { REASONS, type Reason } from "../config/constants";

/** Plain-data view of an otpChallenges/{uid} document (timestamps converted to ms). */
export interface ChallengeState {
  challengeId: string;
  otpHash: string;
  authTime: number;
  expiresAtMs: number;
  resendAvailableAtMs: number;
  attempts: number;
  maxAttempts: number;
  consumed: boolean;
}

export type ChallengeOutcome =
  | { ok: true }
  | { ok: false; reason: Reason; incrementAttempts: boolean; attemptsRemaining?: number };

/**
 * Pure decision function for OTP verification. Kept free of Firestore so it can be unit-tested.
 * The caller persists `incrementAttempts` / consumption inside a transaction.
 */
export function evaluateChallenge(input: {
  challenge: ChallengeState | null;
  challengeId: string;
  authTime: number;
  code: string;
  nowMs: number;
  verify: (code: string, otpHash: string) => boolean;
}): ChallengeOutcome {
  const { challenge, challengeId, authTime, code, nowMs, verify } = input;

  // A newer OTP replaces the document, so an old challengeId never matches (previous challenges are invalidated).
  if (!challenge || challenge.challengeId !== challengeId || challenge.authTime !== authTime) {
    return { ok: false, reason: REASONS.CHALLENGE_NOT_FOUND, incrementAttempts: false };
  }
  if (challenge.consumed) {
    return { ok: false, reason: REASONS.OTP_ALREADY_USED, incrementAttempts: false };
  }
  if (nowMs >= challenge.expiresAtMs) {
    return { ok: false, reason: REASONS.OTP_EXPIRED, incrementAttempts: false };
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    return { ok: false, reason: REASONS.OTP_TOO_MANY_ATTEMPTS, incrementAttempts: false, attemptsRemaining: 0 };
  }
  if (!verify(code, challenge.otpHash)) {
    const attemptsRemaining = Math.max(0, challenge.maxAttempts - (challenge.attempts + 1));
    return {
      ok: false,
      reason: attemptsRemaining === 0 ? REASONS.OTP_TOO_MANY_ATTEMPTS : REASONS.OTP_INVALID,
      incrementAttempts: true,
      attemptsRemaining,
    };
  }
  return { ok: true };
}

/** Milliseconds the caller must wait before a new OTP may be issued (0 = allowed now). */
export function resendWaitMs(
  existing: Pick<ChallengeState, "resendAvailableAtMs" | "consumed" | "authTime"> | null,
  authTime: number,
  nowMs: number,
): number {
  if (!existing || existing.consumed || existing.authTime !== authTime) return 0;
  return Math.max(0, existing.resendAvailableAtMs - nowMs);
}
