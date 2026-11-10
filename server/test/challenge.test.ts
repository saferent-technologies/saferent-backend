import { describe, expect, it } from "vitest";
import { evaluateChallenge, resendWaitMs, type ChallengeState } from "../src/lib/challenge";

const NOW = 1_800_000_000_000;
const AUTH_TIME = 1_799_999_990;

function challenge(overrides: Partial<ChallengeState> = {}): ChallengeState {
  return {
    challengeId: "c-1",
    otpHash: "hash-of-123456",
    authTime: AUTH_TIME,
    expiresAtMs: NOW + 5 * 60_000,
    resendAvailableAtMs: NOW + 60_000,
    attempts: 0,
    maxAttempts: 5,
    consumed: false,
    ...overrides,
  };
}

const verify = (code: string, hash: string) => hash === `hash-of-${code}`;

function run(c: ChallengeState | null, code = "123456", extra: Partial<{ challengeId: string; authTime: number; nowMs: number }> = {}) {
  return evaluateChallenge({
    challenge: c,
    challengeId: extra.challengeId ?? "c-1",
    authTime: extra.authTime ?? AUTH_TIME,
    nowMs: extra.nowMs ?? NOW,
    code,
    verify,
  });
}

describe("evaluateChallenge", () => {
  it("accepts the correct code", () => {
    expect(run(challenge())).toEqual({ ok: true });
  });

  it("rejects an incorrect code and counts the attempt", () => {
    expect(run(challenge(), "000000")).toEqual({ ok: false, reason: "OTP_INVALID", incrementAttempts: true, attemptsRemaining: 4 });
  });

  it("locks the challenge on the 5th wrong attempt", () => {
    expect(run(challenge({ attempts: 4 }), "000000")).toMatchObject({ ok: false, reason: "OTP_TOO_MANY_ATTEMPTS", attemptsRemaining: 0 });
  });

  it("refuses even the correct code after max attempts", () => {
    expect(run(challenge({ attempts: 5 }))).toMatchObject({ ok: false, reason: "OTP_TOO_MANY_ATTEMPTS", incrementAttempts: false });
  });

  it("rejects an expired code", () => {
    expect(run(challenge(), "123456", { nowMs: NOW + 5 * 60_000 })).toMatchObject({ ok: false, reason: "OTP_EXPIRED" });
  });

  it("prevents replay of a consumed code", () => {
    expect(run(challenge({ consumed: true }))).toMatchObject({ ok: false, reason: "OTP_ALREADY_USED" });
  });

  it("rejects a superseded challenge (a newer OTP was issued)", () => {
    expect(run(challenge({ challengeId: "c-2" }))).toMatchObject({ ok: false, reason: "CHALLENGE_NOT_FOUND" });
  });

  it("rejects a challenge from a different sign-in", () => {
    expect(run(challenge(), "123456", { authTime: AUTH_TIME + 100 })).toMatchObject({ ok: false, reason: "CHALLENGE_NOT_FOUND" });
  });

  it("rejects when no challenge exists", () => {
    expect(run(null)).toMatchObject({ ok: false, reason: "CHALLENGE_NOT_FOUND" });
  });
});

describe("resendWaitMs", () => {
  it("allows the first request", () => {
    expect(resendWaitMs(null, AUTH_TIME, NOW)).toBe(0);
  });

  it("enforces the 60 second cooldown", () => {
    expect(resendWaitMs(challenge(), AUTH_TIME, NOW + 10_000)).toBe(50_000);
  });

  it("allows a resend after the cooldown", () => {
    expect(resendWaitMs(challenge(), AUTH_TIME, NOW + 60_000)).toBe(0);
  });

  it("does not apply the cooldown to a new sign-in", () => {
    expect(resendWaitMs(challenge(), AUTH_TIME + 1, NOW)).toBe(0);
  });
});
