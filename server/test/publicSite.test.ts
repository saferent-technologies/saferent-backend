import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { publicLimit } from "../src/middleware/publicLimit";

const req = (ip: string) => ({ ip }) as Request;
const res = {} as Response;

describe("public website rate limit", () => {
  it("allows up to the limit per IP, then refuses with RATE_LIMITED", () => {
    const limit = publicLimit(3, 60_000);
    const next = vi.fn();
    for (let i = 0; i < 3; i++) limit(req("1.1.1.1"), res, next as unknown as NextFunction);
    expect(next.mock.calls.every((c) => c.length === 0)).toBe(true);

    limit(req("1.1.1.1"), res, next as unknown as NextFunction);
    const err = next.mock.calls[3][0] as { reason?: string };
    expect(err?.reason).toBe("RATE_LIMITED");
  });

  it("counts each IP separately and resets after the window", () => {
    vi.useFakeTimers();
    try {
      const limit = publicLimit(1, 1_000);
      const next = vi.fn();
      limit(req("2.2.2.2"), res, next as unknown as NextFunction);
      limit(req("3.3.3.3"), res, next as unknown as NextFunction);
      expect(next.mock.calls.every((c) => c.length === 0)).toBe(true);
      limit(req("2.2.2.2"), res, next as unknown as NextFunction);
      expect(next.mock.calls[2][0]).toBeTruthy();
      vi.advanceTimersByTime(1_001);
      limit(req("2.2.2.2"), res, next as unknown as NextFunction);
      expect(next.mock.calls[3]).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
