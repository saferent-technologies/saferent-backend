import { describe, expect, it } from "vitest";
import { answersSchema, asksNothing, documentStatus, requirementsSchema, ruleConflicts } from "../src/lib/tenantDetails";

const base = { tenantType: "WORKING_PROFESSIONAL", employmentType: "SALARIED", adults: 2, children: 1, hasPets: false, smokes: false, stayMonths: 11 };

describe("tenant details asked on an invitation", () => {
  it("requirements default to the basic details only", () => {
    const r = requirementsSchema.parse({});
    expect(r).toEqual({ askDetails: true, companyName: "OFF", references: 0, backgroundVerification: false, documents: [] });
    expect(asksNothing(null)).toBe(true);
    expect(asksNothing(requirementsSchema.parse({ askDetails: false }))).toBe(true);
    expect(requirementsSchema.safeParse({ documents: ["PAN", "PAN"] }).success).toBe(false);
    expect(requirementsSchema.safeParse({ religion: true }).success).toBe(false);
  });
  it("basic answers required when asked; extra personal fields rejected", () => {
    const r = requirementsSchema.parse({});
    expect(answersSchema(r).safeParse(base).success).toBe(true);
    expect(answersSchema(r).safeParse({ ...base, adults: undefined }).success).toBe(false);
    expect(answersSchema(r).safeParse({ ...base, salary: 50000 }).success).toBe(false);
    expect(answersSchema(r).safeParse({ ...base, companyName: "Acme" }).success).toBe(false);
  });
  it("company, references and background consent follow the requirements", () => {
    const r = requirementsSchema.parse({ companyName: "REQUIRED", references: 1, backgroundVerification: true });
    const ref = { name: "Ravi Kumar", relation: "Manager", phone: "+919876543210" };
    expect(answersSchema(r).safeParse({ ...base, companyName: "Acme", references: [ref], backgroundConsent: true }).success).toBe(true);
    expect(answersSchema(r).safeParse({ ...base, references: [ref], backgroundConsent: true }).success).toBe(false);
    expect(answersSchema(r).safeParse({ ...base, employmentType: "STUDENT", references: [ref], backgroundConsent: true }).success).toBe(true);
    expect(answersSchema(r).safeParse({ ...base, companyName: "Acme", references: [], backgroundConsent: true }).success).toBe(false);
    expect(answersSchema(r).safeParse({ ...base, companyName: "Acme", references: [ref], backgroundConsent: false }).success).toBe(false);
  });
  it("documents shared and house-rule conflicts", () => {
    expect(documentStatus(["ID_PROOF", "PAN"], ["PASSPORT"])).toEqual([
      { key: "ID_PROOF", label: "Government ID (any one)", shared: true },
      { key: "PAN", label: "PAN card", shared: false },
    ]);
    expect(ruleConflicts({ hasPets: true, smokes: false, stayMonths: 6 }, { petsAllowed: "NO", smokingAllowed: "YES", lockInMonths: 11 })).toHaveLength(2);
  });
});
