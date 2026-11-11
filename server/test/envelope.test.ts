import { describe, expect, it } from "vitest";
import { sniffMime } from "../src/lib/upload-sniff";
import { errorCodeFor, toEnvelope } from "../src/v1/envelope";

describe("v1 response envelope", () => {
  it("wraps data and moves pagination into meta", () => {
    expect(toEnvelope(200, { items: [1, 2], page: 1, pageSize: 20, total: 2, totalPages: 1 })).toEqual({ success: true, message: "OK", data: [1, 2], meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 } });
    expect(toEnvelope(201, { property: { id: "p" } }, "Property created successfully")).toEqual({ success: true, message: "Property created successfully", data: { property: { id: "p" } }, meta: null });
    expect(toEnvelope(200, { ok: true })).toEqual({ success: true, message: "OK", data: null, meta: null });
  });
  it("turns errors into { success:false, errorCode } without internals", () => {
    const e = toEnvelope(403, { error: { reason: "PERMISSION_DENIED", message: "You do not have permission to access this property" } });
    expect(e).toEqual({ success: false, message: "You do not have permission to access this property", errorCode: "FORBIDDEN", reason: "PERMISSION_DENIED", data: null });
    expect(toEnvelope(400, { error: { reason: "INVALID_INPUT", message: "Bad", issues: [{ path: "x", message: "y" }] } }).details).toEqual({ issues: [{ path: "x", message: "y" }] });
    expect(toEnvelope(500, { error: { reason: "INTERNAL", message: "Something went wrong. Please try again." } }).errorCode).toBe("INTERNAL_ERROR");
  });
  it("maps statuses and reasons to stable codes", () => {
    expect(errorCodeFor(404)).toBe("NOT_FOUND");
    expect(errorCodeFor(409, "VERSION_CONFLICT")).toBe("CONFLICT");
    expect(errorCodeFor(412, "INVALID_STATE")).toBe("INVALID_STATE");
    expect(errorCodeFor(429)).toBe("RATE_LIMITED");
    expect(errorCodeFor(401)).toBe("UNAUTHENTICATED");
  });
});

describe("secure upload validation", () => {
  it("recognises real file signatures only", () => {
    expect(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("#!/bin/sh"))).toBeNull();
  });
});
