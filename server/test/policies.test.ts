import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone } from "../src/lib/mask";
import { evaluateRateLimit } from "../src/lib/rateLimitPolicy";
import { isSessionValid } from "../src/lib/session";
import { companyEmailSchema, isAllowedEmailDomain, passwordSchema, phoneE164Schema } from "../src/lib/validation";

describe("email domain eligibility", () => {
  it("accepts company addresses (case-insensitive)", () => {
    expect(isAllowedEmailDomain("admin@saferenttechnologies.com")).toBe(true);
    expect(isAllowedEmailDomain("  Admin@SafeRentTechnologies.com ")).toBe(true);
  });

  it("rejects look-alike and foreign domains", () => {
    for (const email of [
      "admin@gmail.com",
      "admin@saferenttechnologies.com.evil.io",
      "admin@evil-saferenttechnologies.com",
      "admin@sub.saferenttechnologies.com",
      "@saferenttechnologies.com",
      "a@b@saferenttechnologies.com",
    ]) {
      expect(isAllowedEmailDomain(email)).toBe(false);
    }
  });

  it("schema normalizes and validates", () => {
    expect(companyEmailSchema.parse(" Admin@SafeRentTechnologies.com")).toBe("admin@saferenttechnologies.com");
    expect(companyEmailSchema.safeParse("x@gmail.com").success).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts a strong password", () => {
    expect(passwordSchema.safeParse("Str0ng!Passw0rd").success).toBe(true);
  });
  it.each(["short1!A", "alllowercase1!", "ALLUPPERCASE1!", "NoNumbersHere!", "NoSymbols12345"])("rejects %s", (pw) => {
    expect(passwordSchema.safeParse(pw).success).toBe(false);
  });
});

describe("phone format", () => {
  it("accepts E.164", () => {
    expect(phoneE164Schema.safeParse("+919876543210").success).toBe(true);
  });
  it("rejects non E.164", () => {
    expect(phoneE164Schema.safeParse("9876543210").success).toBe(false);
    expect(phoneE164Schema.safeParse("+0123").success).toBe(false);
  });
});

describe("masking", () => {
  it("masks email", () => {
    expect(maskEmail("admin@saferenttechnologies.com")).toBe("a****@saferenttechnologies.com");
  });
  it("masks phone", () => {
    expect(maskPhone("+919876543210")).toBe("+91******3210");
  });
});

describe("rate limit window", () => {
  const WINDOW = 60_000;
  it("allows up to the limit then blocks", () => {
    let state = null as ReturnType<typeof evaluateRateLimit>["next"] | null;
    for (let i = 0; i < 3; i++) {
      const d = evaluateRateLimit(state, 1_000 + i, 3, WINDOW);
      expect(d.allowed).toBe(true);
      state = d.next;
    }
    const blocked = evaluateRateLimit(state, 2_000, 3, WINDOW);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(1_000 + WINDOW - 2_000);
  });
  it("resets after the window", () => {
    const d = evaluateRateLimit({ count: 3, windowStartMs: 0 }, WINDOW, 3, WINDOW);
    expect(d.allowed).toBe(true);
    expect(d.next).toEqual({ count: 1, windowStartMs: WINDOW });
  });
});

describe("verified session binding", () => {
  const now = 1_000_000;
  const ts = (ms: number) => new Date(ms);
  it("is valid for the same sign-in before expiry", () => {
    expect(isSessionValid({ authTime: 10, expiresAt: ts(now + 1), revoked: false }, 10, now)).toBe(true);
  });
  it("is invalid for a different sign-in (new password login)", () => {
    expect(isSessionValid({ authTime: 10, expiresAt: ts(now + 1), revoked: false }, 11, now)).toBe(false);
  });
  it("is invalid when expired or revoked", () => {
    expect(isSessionValid({ authTime: 10, expiresAt: ts(now), revoked: false }, 10, now)).toBe(false);
    expect(isSessionValid({ authTime: 10, expiresAt: ts(now + 1), revoked: true }, 10, now)).toBe(false);
    expect(isSessionValid(undefined, 10, now)).toBe(false);
  });
});
