/**
 * ID documents the server can verify right now (GET /kyc/me → idTypes; POST /kyc/identity refuses others).
 * ONE pipeline: a type is offered only when the server CAN check it (configuration) AND Super Admin has
 * it switched ON (kyc_id_type_settings). Pure helpers (unit tested in test/idTypes.test.ts).
 */
export const ID_TYPES = ["AADHAAR_XML", "EAADHAAR_PDF", "PAN", "PASSPORT"] as const;
export type IdType = (typeof ID_TYPES)[number];

export interface IdTypeConfig {
  /** Aadhaar Offline e-KYC (ZIP + share code) with a pinned UIDAI certificate. */
  aadhaarOffline: boolean;
  /** e-Aadhaar PDF checking (password-protected PDF + UIDAI PDF signature). Not built yet → false. */
  eAadhaarPdf: boolean;
  /** PAN / passport photos reviewed by staff. */
  manualReview: boolean;
  /** Types Super Admin switched off. */
  disabled?: readonly string[];
}

/** Can the server check this type at all (configuration only)? */
export function idTypeConfigured(t: IdType, c: IdTypeConfig): boolean {
  return t === "AADHAAR_XML" ? c.aadhaarOffline : t === "EAADHAAR_PDF" ? c.eAadhaarPdf : c.manualReview;
}

export function idTypesFor(c: IdTypeConfig): IdType[] {
  return ID_TYPES.filter((t) => idTypeConfigured(t, c) && !(c.disabled ?? []).includes(t));
}

/** Magic-byte check for the uploaded file of each type; returns the user-facing message, or null when fine. */
export function idFileProblem(type: IdType, head: Uint8Array | undefined): string | null {
  const b = head ?? new Uint8Array();
  if (type === "AADHAAR_XML") return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 ? null : "Choose the Aadhaar ZIP file.";
  if (type === "EAADHAAR_PDF") return b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 ? null : "Choose the e-Aadhaar PDF.";
  return null;
}
