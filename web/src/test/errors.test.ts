import { describe, expect, it } from "vitest";
import { toAppError } from "@/utils/errors";

describe("toAppError", () => {
  it("maps backend reasons to friendly text and keeps metadata", () => {
    const err = toAppError({ code: "functions/permission-denied", message: "internal detail", details: { reason: "OTP_INVALID", attemptsRemaining: 3 } });
    expect(err.reason).toBe("OTP_INVALID");
    expect(err.message).toBe("That code is incorrect. Please check and try again.");
    expect(err.attemptsRemaining).toBe(3);
  });

  it("does not leak Firebase internals for wrong passwords", () => {
    const err = toAppError({ code: "auth/invalid-credential", message: "Firebase: Error (auth/invalid-credential)." });
    expect(err.message).toBe("Incorrect email or password.");
    expect(err.message).not.toMatch(/firebase/i);
  });

  it("treats blocking-function rejections as unauthorized", () => {
    const err = toAppError({ code: "auth/internal-error", message: 'HTTP Cloud Function returned an error: {"error":{"status":"PERMISSION_DENIED"}} BLOCKING_FUNCTION_ERROR_RESPONSE' });
    expect(err.reason).toBe("NOT_AUTHORIZED");
  });

  it("maps disabled accounts and rate limits", () => {
    expect(toAppError({ code: "auth/user-disabled" }).message).toMatch(/disabled/);
    expect(toAppError({ details: { reason: "RATE_LIMITED", retryAfterSeconds: 120 } }).retryAfterSeconds).toBe(120);
  });

  it("falls back to a generic message", () => {
    expect(toAppError(new Error("boom")).message).toBe("Something went wrong. Please try again.");
  });
});
