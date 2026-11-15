import { z } from "zod";

/*
 * Consent records — the rules, kept pure so they're unit tested (test/consents.test.ts).
 * The controller does the I/O; nothing here touches the database.
 */

export const CONSENT_TYPES = ["TERMS", "PRIVACY", "WHATSAPP"] as const;
export type ConsentTypeKey = (typeof CONSENT_TYPES)[number];
/** Types that need a version (the policy version the user saw) and can't be withdrawn. */
export const VERSIONED: readonly ConsentTypeKey[] = ["TERMS", "PRIVACY"];

const MIN_CLIENT_TIME = Date.UTC(2020, 0, 1);
const MAX_CLIENT_SKEW_MS = 24 * 60 * 60 * 1000;

const item = z
  .object({
    type: z.enum(CONSENT_TYPES, { error: "type must be TERMS, PRIVACY or WHATSAPP." }),
    version: z.string().trim().max(32, "version is at most 32 characters."),
    granted: z.boolean({ error: "granted must be true or false." }),
  })
  .strict();

/** The consent list (also embedded in POST/PUT /userProfile). */
export const consentItemsSchema = z
  .array(item)
  .min(1, "Send at least one consent.")
  .max(CONSENT_TYPES.length, "Send each consent type once.")
  .superRefine((consents, ctx) => {
    const seen = new Set<string>();
    consents.forEach((c, i) => {
      if (seen.has(c.type)) ctx.addIssue({ code: "custom", message: `${c.type} is sent more than once.`, path: [i, "type"] });
      seen.add(c.type);
      if (VERSIONED.includes(c.type) && !c.granted) ctx.addIssue({ code: "custom", message: `${c.type} can only be accepted (granted must be true).`, path: [i, "granted"] });
      if (VERSIONED.includes(c.type) && !c.version) ctx.addIssue({ code: "custom", message: `${c.type} needs a version.`, path: [i, "version"] });
      if (c.type === "WHATSAPP" && c.version !== "") ctx.addIssue({ code: "custom", message: 'WHATSAPP has no version — send "".', path: [i, "version"] });
    });
  });

export const clientAcceptedAtSchema = z
  .number({ error: "clientAcceptedAt must be epoch milliseconds." })
  .int()
  .refine((v) => v >= MIN_CLIENT_TIME && v <= Date.now() + MAX_CLIENT_SKEW_MS, { message: "clientAcceptedAt is not a plausible time." });
export const sourceSchema = z.enum(["ANDROID", "IOS", "WEB"], { error: "source must be ANDROID, IOS or WEB." });

export const consentRequestSchema = z
  .object({
    consents: consentItemsSchema,
    clientAcceptedAt: clientAcceptedAtSchema.optional(),
    role: z.enum(["TENANT", "LANDLORD"], { error: "role must be TENANT or LANDLORD." }).optional(),
    source: sourceSchema,
    appVersion: z.string().trim().max(32, "appVersion is at most 32 characters.").optional(),
  })
  .strict();
export type ConsentRequest = z.infer<typeof consentRequestSchema>;

export interface LatestConsent {
  version: string;
  granted: boolean;
  acceptedAt: Date;
}
/** Idempotency: only consents that differ from the latest stored row for that type are inserted. */
export function consentsToInsert(consents: ConsentRequest["consents"], latest: Partial<Record<ConsentTypeKey, LatestConsent>>): ConsentRequest["consents"] {
  return consents.filter((c) => {
    const last = latest[c.type];
    return !last || last.version !== c.version || last.granted !== c.granted;
  });
}

export interface ConsentStatus {
  terms: { accepted: boolean; acceptedVersion: string | null; acceptedAt: string | null };
  privacy: { accepted: boolean; acceptedVersion: string | null; acceptedAt: string | null };
  whatsapp: { granted: boolean; updatedAt: string | null };
}

/** Consent status (in /userProfile responses) — has the user accepted the Terms / Privacy (any version) and their WhatsApp choice. */
export function consentStatus(latest: Partial<Record<ConsentTypeKey, LatestConsent>>): ConsentStatus {
  const accepted = (type: "TERMS" | "PRIVACY") => {
    const last = latest[type];
    const ok = last?.granted ? last : null;
    return { accepted: !!ok, acceptedVersion: ok?.version ?? null, acceptedAt: ok?.acceptedAt.toISOString() ?? null };
  };
  const wa = latest.WHATSAPP;
  return {
    terms: accepted("TERMS"),
    privacy: accepted("PRIVACY"),
    whatsapp: { granted: wa?.granted ?? false, updatedAt: wa?.acceptedAt.toISOString() ?? null },
  };
}

/** Terms AND Privacy accepted (any version). */
export const termsAccepted = (st: ConsentStatus) => st.terms.accepted && st.privacy.accepted;

/** True when the list grants both TERMS and PRIVACY. */
export const grantsLegal = (consents: ConsentRequest["consents"] | undefined) =>
  !!consents && consents.some((c) => c.type === "TERMS" && c.granted) && consents.some((c) => c.type === "PRIVACY" && c.granted);
