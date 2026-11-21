import { describe, expect, it } from "vitest";
import { nameChangeBlocked, sameName } from "../src/lib/nameLockRules";

describe("verified name lock", () => {
  it("compares trimmed, case insensitive, spaces collapsed", () => {
    expect(sameName("Shaik Shabeer", "  shaik   SHABEER ")).toBe(true);
    expect(sameName("Shaik Shabeer", "Shaik Shabbir")).toBe(false);
  });
  it("blocks only a different name when locked", () => {
    expect(nameChangeBlocked(false, "Ravi Kumar", "Someone Else")).toBe(false); // unlocked: updates
    expect(nameChangeBlocked(true, "Ravi Kumar", "ravi kumar")).toBe(false); // locked + same name
    expect(nameChangeBlocked(true, "Ravi Kumar", undefined)).toBe(false); // locked, name not sent
    expect(nameChangeBlocked(true, "Ravi Kumar", "Ravi K")).toBe(true); // locked + different
  });
});
