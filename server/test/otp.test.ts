import { describe, expect, it } from "vitest";
import { generateOtp, hashOtp, newChallengeId, verifyOtpHash } from "../src/lib/otp";

const PEPPER = "test-pepper-not-a-real-secret";

describe("generateOtp", () => {
  it("produces exactly six digits", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("is not static", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe("hashOtp / verifyOtpHash", () => {
  const uid = "uid-123";
  const challengeId = newChallengeId();

  it("never stores the plain code", () => {
    const hash = hashOtp("123456", challengeId, uid, PEPPER);
    expect(hash).not.toContain("123456");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts the right code", () => {
    const hash = hashOtp("042917", challengeId, uid, PEPPER);
    expect(verifyOtpHash("042917", hash, challengeId, uid, PEPPER)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const hash = hashOtp("042917", challengeId, uid, PEPPER);
    expect(verifyOtpHash("042918", hash, challengeId, uid, PEPPER)).toBe(false);
  });

  it("binds the hash to the challenge, the user and the pepper", () => {
    const hash = hashOtp("111111", challengeId, uid, PEPPER);
    expect(verifyOtpHash("111111", hash, newChallengeId(), uid, PEPPER)).toBe(false);
    expect(verifyOtpHash("111111", hash, challengeId, "other-uid", PEPPER)).toBe(false);
    expect(verifyOtpHash("111111", hash, challengeId, uid, "other-pepper")).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const hash = hashOtp("111111", challengeId, uid, PEPPER);
    expect(verifyOtpHash("11111", hash, challengeId, uid, PEPPER)).toBe(false);
    expect(verifyOtpHash("abcdef", hash, challengeId, uid, PEPPER)).toBe(false);
    expect(verifyOtpHash("111111", "not-hex", challengeId, uid, PEPPER)).toBe(false);
  });
});
