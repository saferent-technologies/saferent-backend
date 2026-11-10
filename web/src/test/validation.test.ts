import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone } from "@/utils/mask";
import { findCountry, isValidNationalNumber, toE164 } from "@/utils/phone";
import { emailLoginSchema, isCompanyEmail, newPasswordSchema, otpCodeSchema, phoneLoginSchema } from "@/validations/auth.schemas";

describe("email login validation", () => {
  it("accepts company email", () => {
    expect(emailLoginSchema.safeParse({ email: "admin@saferenttechnologies.com", password: "x", rememberMe: true }).success).toBe(true);
  });

  it("rejects unauthorized domains", () => {
    expect(isCompanyEmail("admin@gmail.com")).toBe(false);
    expect(isCompanyEmail("admin@saferenttechnologies.com.attacker.io")).toBe(false);
    const result = emailLoginSchema.safeParse({ email: "admin@gmail.com", password: "x", rememberMe: false });
    expect(result.success).toBe(false);
  });

  it("requires a password", () => {
    expect(emailLoginSchema.safeParse({ email: "admin@saferenttechnologies.com", password: "", rememberMe: false }).success).toBe(false);
  });
});

describe("phone helpers", () => {
  it("builds E.164 for India by default", () => {
    expect(toE164(findCountry("IN"), "98765 43210")).toBe("+919876543210");
    expect(toE164(findCountry("IN"), "09876543210")).toBe("+919876543210");
  });

  it("validates national number length", () => {
    expect(isValidNationalNumber(findCountry("IN"), "9876543210")).toBe(true);
    expect(isValidNationalNumber(findCountry("IN"), "98765")).toBe(false);
    expect(phoneLoginSchema.safeParse({ countryIso: "IN", phone: "12345" }).success).toBe(false);
  });
});

describe("otp + password", () => {
  it("requires exactly six digits", () => {
    expect(otpCodeSchema.safeParse("123456").success).toBe(true);
    expect(otpCodeSchema.safeParse("12345").success).toBe(false);
    expect(otpCodeSchema.safeParse("12a456").success).toBe(false);
  });

  it("enforces the password policy and confirmation", () => {
    expect(newPasswordSchema.safeParse({ password: "Str0ng!Passw0rd", confirmPassword: "Str0ng!Passw0rd" }).success).toBe(true);
    expect(newPasswordSchema.safeParse({ password: "Str0ng!Passw0rd", confirmPassword: "different" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "weak", confirmPassword: "weak" }).success).toBe(false);
  });
});

describe("masking", () => {
  it("masks destinations on the OTP screen", () => {
    expect(maskEmail("admin@saferenttechnologies.com")).toBe("a****@saferenttechnologies.com");
    expect(maskPhone("+919876543210")).toBe("+91******3210");
  });
});

describe("phone number typing rules", () => {
  it("keeps digits only and limits India to 10 digits", async () => {
    const { sanitizeNationalNumber, maxNationalLength } = await import("@/utils/phone");
    const max = maxNationalLength(findCountry("IN"));
    expect(max).toBe(10);
    expect(sanitizeNationalNumber("98abc76-54 32", max)).toBe("98765432");
    expect(sanitizeNationalNumber("987654321012345", max)).toBe("9876543210");
    expect(sanitizeNationalNumber("09876543210", max)).toBe("9876543210");
  });
});
