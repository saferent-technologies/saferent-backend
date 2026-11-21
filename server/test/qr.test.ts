import { describe, expect, it } from "vitest";
import { qrMatrix, qrSvg } from "../src/lib/qr";

describe("qr encoder", () => {
  it("picks the smallest version and draws finder patterns", () => {
    expect(qrMatrix("HELLO").length).toBe(21);
    const m = qrMatrix("https://app.saferenttechnologies.com/p/SR-PROP-000123/u/SR-UNIT-000456");
    expect(m.length).toBe(37); // version 5
    // Top-left finder: dark ring, light ring, dark core.
    expect([m[0]![0], m[1]![1], m[2]![2], m[3]![3]]).toEqual([true, false, true, true]);
    expect(m[m.length - 8]![8]).toBe(true); // dark module
  });
  it("rejects text that is too long and renders SVG", () => {
    expect(() => qrMatrix("x".repeat(400))).toThrow();
    expect(qrSvg("HELLO", 256, "Flat <101>")).toContain("Flat &lt;101&gt;");
  });
});
