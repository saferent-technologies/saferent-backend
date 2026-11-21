import { z } from "zod";

/*
 * What an owner may ask a tenant when inviting them, and the tenant's answers. Privacy first: only what
 * a rental needs. Never asked: religion, caste, food habits, marital status, salary, ID numbers.
 * Pure schemas (unit tested in test/tenantDetails.test.ts).
 */

export const TENANT_TYPES = ["STUDENT", "WORKING_PROFESSIONAL", "FAMILY", "OTHER"] as const;
export const EMPLOYMENT_TYPES = ["SALARIED", "SELF_EMPLOYED", "STUDENT", "NOT_WORKING", "OTHER"] as const;
export const COMPANY_NAME_RULES = ["OFF", "OPTIONAL", "REQUIRED"] as const;

/** Documents an owner may ask for; the tenant shares them from their encrypted ID vault after accepting. */
export const DOCUMENT_REQUIREMENTS = {
  ID_PROOF: { label: "Government ID (any one)", vaultTypes: ["AADHAAR", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "PAN"] },
  PAN: { label: "PAN card", vaultTypes: ["PAN"] },
  EMPLOYMENT_OR_STUDENT_ID: { label: "Employee or student ID", vaultTypes: ["EMPLOYEE_ID", "OTHER"] },
  OTHER: { label: "Other document", vaultTypes: ["OTHER"] },
} as const;
export type DocumentRequirement = keyof typeof DOCUMENT_REQUIREMENTS;
const DOC_KEYS = Object.keys(DOCUMENT_REQUIREMENTS) as [DocumentRequirement, ...DocumentRequirement[]];

/** Set by the owner on the invitation. */
export const requirementsSchema = z
  .object({
    /** Ask the basic details (tenant type, employment, occupants, pets, smoking, stay). */
    askDetails: z.boolean().default(true),
    companyName: z.enum(COMPANY_NAME_RULES).default("OFF"),
    /** How many references (name, relation, phone) the tenant must give: 0–2. */
    references: z.coerce.number().int().min(0).max(2).default(0),
    /** The tenant agrees to a background verification. */
    backgroundVerification: z.boolean().default(false),
    documents: z
      .array(z.enum(DOC_KEYS))
      .max(4)
      .default([])
      .refine((xs) => new Set(xs).size === xs.length, "List each document once."),
  })
  .strict();
export type Requirements = z.infer<typeof requirementsSchema>;

/** Nothing to ask (old invitations, or the owner turned everything off). */
export function asksNothing(r: Requirements | null | undefined): boolean {
  return !r || (!r.askDetails && r.companyName === "OFF" && r.references === 0 && !r.backgroundVerification && r.documents.length === 0);
}

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .refine((v) => /^\+?[1-9]\d{9,14}$/.test(v), "Enter a valid phone number.");

const referenceSchema = z.object({ name: z.string().trim().min(2).max(120), relation: z.string().trim().min(2).max(40), phone }).strict();

/** The tenant's answers, checked against what the invitation asks. */
export function answersSchema(r: Requirements) {
  const base = z
    .object({
      tenantType: r.askDetails ? z.enum(TENANT_TYPES) : z.enum(TENANT_TYPES).optional(),
      employmentType: r.askDetails ? z.enum(EMPLOYMENT_TYPES) : z.enum(EMPLOYMENT_TYPES).optional(),
      companyName: z.string().trim().max(120).nullable().optional().or(z.literal("").transform(() => null)),
      adults: r.askDetails ? z.coerce.number().int().min(1).max(20) : z.coerce.number().int().min(1).max(20).optional(),
      children: z.coerce.number().int().min(0).max(20).default(0),
      hasPets: r.askDetails ? z.boolean() : z.boolean().optional(),
      petDetails: z.string().trim().max(120).nullable().optional().or(z.literal("").transform(() => null)),
      smokes: r.askDetails ? z.boolean() : z.boolean().optional(),
      /** How long the tenant plans to stay (months). */
      stayMonths: z.coerce.number().int().min(1).max(120).nullable().optional(),
      references: z.array(referenceSchema).max(2).default([]),
      backgroundConsent: z.boolean().default(false),
    })
    .strict();
  return base.superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (r.companyName === "REQUIRED" && !v.companyName && v.employmentType !== "STUDENT" && v.employmentType !== "NOT_WORKING") issue("companyName", "Enter your company or business name.");
    if (r.companyName === "OFF" && v.companyName) issue("companyName", "The owner didn't ask for your company name.");
    if (v.references.length < r.references) issue("references", `Add ${r.references} reference${r.references > 1 ? "s" : ""}.`);
    if (v.references.length > r.references) issue("references", "The owner didn't ask for this many references.");
    if (r.backgroundVerification && !v.backgroundConsent) issue("backgroundConsent", "Agree to the background verification to accept this invitation.");
    if (!v.hasPets && v.petDetails) issue("petDetails", "Remove the pet details, or choose that you have a pet.");
  });
}
export type Answers = z.infer<ReturnType<typeof answersSchema>>;

/** Which requested documents the tenant has shared (by vault type). */
export function documentStatus(required: DocumentRequirement[], sharedTypes: string[]) {
  return required.map((key) => ({ key, label: DOCUMENT_REQUIREMENTS[key].label, shared: DOCUMENT_REQUIREMENTS[key].vaultTypes.some((t) => (sharedTypes as string[]).includes(t)) }));
}

/** House-rule mismatches the owner should see (never blocks: the owner already chose this tenant). */
export function ruleConflicts(a: { hasPets?: boolean | null; smokes?: boolean | null; stayMonths?: number | null }, rules: { petsAllowed?: string | null; smokingAllowed?: string | null; lockInMonths?: number | null }): string[] {
  const out: string[] = [];
  if (a.hasPets && rules.petsAllowed === "NO") out.push("Has a pet; pets are not allowed.");
  if (a.smokes && rules.smokingAllowed === "NO") out.push("Smokes; smoking is not allowed.");
  if (a.stayMonths && rules.lockInMonths && a.stayMonths < rules.lockInMonths) out.push(`Plans to stay ${a.stayMonths} months; lock-in is ${rules.lockInMonths} months.`);
  return out;
}
