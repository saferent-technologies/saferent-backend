import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { OTP } from "../config/constants";

/** Cryptographically secure numeric OTP (uniform digits, leading zeros allowed). */
export function generateOtp(length: number = OTP.LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

export function newChallengeId(): string {
  return randomUUID();
}

/**
 * Only this keyed hash is stored — never the OTP itself.
 * HMAC with a server-side secret (pepper) means a database leak alone cannot be brute-forced offline,
 * and binding uid + challengeId means a hash cannot be replayed against another challenge.
 */
export function hashOtp(code: string, challengeId: string, uid: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`${uid}:${challengeId}:${code}`).digest("hex");
}

const OTP_PATTERN = new RegExp(`^\\d{${OTP.LENGTH}}$`);

/** Constant-time comparison of a submitted code against the stored hash. */
export function verifyOtpHash(
  code: string,
  expectedHash: string,
  challengeId: string,
  uid: string,
  pepper: string,
): boolean {
  if (!OTP_PATTERN.test(code)) return false;
  const actual = Buffer.from(hashOtp(code, challengeId, uid, pepper), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
