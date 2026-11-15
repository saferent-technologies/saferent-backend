import { describe, expect, it } from "vitest";
import { appConfigSchema } from "../src/appConfig/schema";
import { consentRequestSchema, consentStatus, consentsToInsert } from "../src/lib/consents";
import { errorCodeFor } from "../src/v1/envelope";

const body = (patch: Record<string, unknown> = {}) => ({
  consents: [
    { type: "TERMS", version: "2026-11-01", granted: true },
    { type: "PRIVACY", version: "2026-11-01", granted: true },
    { type: "WHATSAPP", version: "", granted: false },
  ],
  clientAcceptedAt: Date.now() - 1000,
  role: "TENANT",
  source: "ANDROID",
  appVersion: "1.0",
  ...patch,
});
const at = new Date("2026-11-14T07:54:00.000Z");

describe("consent records — rules", () => {
  it("app config has the current legal versions", () => {
    const l = appConfigSchema.shape.legal.parse({});
    expect(l.termsVersion).toBe("2026-11-01");
    expect(l.privacyVersion).toBe("2026-11-01");
    expect(appConfigSchema.shape.legal.safeParse({ termsVersion: "bad version!" }).success).toBe(false);
  });

  it("validates the request body (400 VALIDATION_ERROR)", () => {
    expect(consentRequestSchema.safeParse(body()).success).toBe(true);
    expect(consentRequestSchema.safeParse(body({ source: "DESKTOP" })).success).toBe(false);
    expect(consentRequestSchema.safeParse(body({ role: "ADMIN" })).success).toBe(false);
    expect(consentRequestSchema.safeParse(body({ consents: [{ type: "MARKETING", version: "", granted: true }] })).success).toBe(false);
    expect(consentRequestSchema.safeParse(body({ consents: [{ type: "TERMS", version: "2026-11-01", granted: false }] })).success).toBe(false); // can't decline Terms
    expect(consentRequestSchema.safeParse(body({ consents: [{ type: "TERMS", version: "a", granted: true }, { type: "TERMS", version: "a", granted: true }] })).success).toBe(false); // duplicate type
    expect(consentRequestSchema.safeParse(body({ consents: [{ type: "WHATSAPP", version: "v1", granted: true }] })).success).toBe(false); // WhatsApp has no version
    expect(consentRequestSchema.safeParse(body({ consents: [] })).success).toBe(false);
    expect(consentRequestSchema.safeParse(body({ clientAcceptedAt: Date.now() + 7 * 864e5 })).success).toBe(false); // implausible phone time
    expect(consentRequestSchema.safeParse(body({ extra: 1 })).success).toBe(false); // unknown field
    expect(errorCodeFor(400, "INVALID_INPUT")).toBe("VALIDATION_ERROR");
  });

  it("is idempotent: only changed consents are inserted", () => {
    const parsed = consentRequestSchema.parse(body());
    expect(consentsToInsert(parsed.consents, {}).map((c) => c.type)).toEqual(["TERMS", "PRIVACY", "WHATSAPP"]);
    const latest = { TERMS: { version: "2026-11-01", granted: true, acceptedAt: at }, PRIVACY: { version: "2026-11-01", granted: true, acceptedAt: at }, WHATSAPP: { version: "", granted: false, acceptedAt: at } };
    expect(consentsToInsert(parsed.consents, latest)).toEqual([]);
    // WhatsApp opt-in after an opt-out → a NEW row (never an update).
    const optIn = consentRequestSchema.parse(body({ consents: [{ type: "WHATSAPP", version: "", granted: true }] }));
    expect(consentsToInsert(optIn.consents, latest)).toEqual([{ type: "WHATSAPP", version: "", granted: true }]);
  });

  it("status: accepted yes / no, with the version and time recorded", () => {
    expect(consentStatus({})).toEqual({
      terms: { accepted: false, acceptedVersion: null, acceptedAt: null },
      privacy: { accepted: false, acceptedVersion: null, acceptedAt: null },
      whatsapp: { granted: false, updatedAt: null },
    });
    const latest = { TERMS: { version: "2026-11-01", granted: true, acceptedAt: at }, PRIVACY: { version: "2026-11-01", granted: true, acceptedAt: at }, WHATSAPP: { version: "", granted: true, acceptedAt: at } };
    const st = consentStatus(latest);
    expect(st.terms).toEqual({ accepted: true, acceptedVersion: "2026-11-01", acceptedAt: "2026-11-14T07:54:00.000Z" });
    expect(st.privacy.accepted).toBe(true);
    expect(st.whatsapp).toEqual({ granted: true, updatedAt: "2026-11-14T07:54:00.000Z" });
    expect("needsReconsent" in st).toBe(false);
  });
});
