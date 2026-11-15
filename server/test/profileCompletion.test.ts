import { describe, expect, it } from "vitest";
import { appConfigSchema } from "../src/appConfig/schema";
import { ageOn, completionView, demographicsSchema, profileCompletion } from "../src/lib/profileCompletion";

const full = { fullName: "Shaik Shabeer", gender: "MALE", dateOfBirth: new Date("1995-04-10T00:00:00Z"), city: "Hyderabad", state: "Telangana" };

describe("profile completion (demographic screen)", () => {
  it("is complete only when every required field is filled", () => {
    expect(profileCompletion(full)).toEqual({ isProfileCompleted: true, missingFields: [] });
    expect(profileCompletion({ ...full, gender: null, city: " " })).toEqual({ isProfileCompleted: false, missingFields: ["gender", "city"] });
    expect(profileCompletion({ fullName: "Ravi", gender: null, dateOfBirth: null, city: null, state: null }).missingFields).toEqual(["gender", "dateOfBirth", "city", "state"]);
  });

  it("validates the demographic form (18+, real dates, required fields)", () => {
    const ok = (v: Record<string, unknown>) => demographicsSchema.safeParse({ isProfileCompleted: true, role: "TENANT", gender: "FEMALE", dateOfBirth: "1998-01-31", city: "Pune", state: "Maharashtra", ...v }).success;
    expect(ok({})).toBe(true);
    expect(ok({ email: "" })).toBe(true);
    // Optional fields sent as null by the app = not sent.
    expect(ok({ email: null, occupation: null, referralCode: null, consents: null, clientAcceptedAt: null, appVersion: null, fullName: null })).toBe(true);
    expect(ok({ isProfileCompleted: null })).toBe(false); // still required
    expect(ok({ dateOfBirth: "2015-01-01" })).toBe(false); // under 18
    expect(ok({ dateOfBirth: "1990-02-30" })).toBe(false); // not a real date
    expect(ok({ dateOfBirth: "01-02-1990" })).toBe(false); // wrong format
    expect(ok({ gender: "UNKNOWN" })).toBe(false);
    expect(ok({ city: "" })).toBe(false);
    expect(ok({ isProfileCompleted: undefined })).toBe(false); // the app must send true or false
    expect(ok({ isProfileCompleted: "yes" })).toBe(false);
    // Skip: only the flag (details optional).
    expect(demographicsSchema.safeParse({ isProfileCompleted: false, role: "LANDLORD" }).success).toBe(true);
    expect(ok({ role: "LANDLORD" })).toBe(true); // user type is chosen on this screen
    expect(ok({ role: undefined })).toBe(false); // ...and it's required
    expect(ok({ role: "SUPER_ADMIN" })).toBe(false); // never a staff role
  });

  it("computes age on the birthday boundary", () => {
    expect(ageOn("2000-06-15", new Date("2018-06-14T12:00:00Z"))).toBe(17);
    expect(ageOn("2000-06-15", new Date("2018-06-15T00:00:00Z"))).toBe(18);
  });

  it("login config: demographic screen switches default on", () => {
    const auth = appConfigSchema.shape.auth.parse({});
    expect(auth.showDemographics).toBe(true);
    expect(auth.demographicsSkippable).toBe(true);
  });

  it("auth responses return the app's stored flag plus the still-empty fields", () => {
    expect(completionView({ ...full, profileCompleted: true })).toEqual({ isProfileCompleted: true, missingFields: [] });
    expect(completionView({ ...full, gender: null, profileCompleted: false })).toEqual({ isProfileCompleted: false, missingFields: ["gender"] });
  });
});
