import { describe, expect, it } from "vitest";
import { idFileProblem, idTypesFor } from "../src/lib/idTypes";

describe("owner verification ID types", () => {
  it("reflects the configuration", () => {
    expect(idTypesFor({ aadhaarOffline: false, eAadhaarPdf: false, manualReview: true })).toEqual(["PAN", "PASSPORT"]);
    expect(idTypesFor({ aadhaarOffline: true, eAadhaarPdf: false, manualReview: true })).toEqual(["AADHAAR_XML", "PAN", "PASSPORT"]);
    expect(idTypesFor({ aadhaarOffline: true, eAadhaarPdf: true, manualReview: false })).toEqual(["AADHAAR_XML", "EAADHAAR_PDF"]);
    expect(idTypesFor({ aadhaarOffline: false, eAadhaarPdf: false, manualReview: false })).toEqual([]);
  });

  it("is one pipeline: configured AND switched on by Super Admin", () => {
    expect(idTypesFor({ aadhaarOffline: true, eAadhaarPdf: false, manualReview: true, disabled: ["PAN"] })).toEqual(["AADHAAR_XML", "PASSPORT"]);
    // Switching on a type the server can't check doesn't offer it.
    expect(idTypesFor({ aadhaarOffline: false, eAadhaarPdf: false, manualReview: true, disabled: [] })).toEqual(["PAN", "PASSPORT"]);
  });

  it("checks magic bytes, not names", () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1]);
    const pdf = Buffer.from("%PDF-1.7");
    expect(idFileProblem("AADHAAR_XML", zip)).toBeNull();
    expect(idFileProblem("AADHAAR_XML", pdf)).toBe("Choose the Aadhaar ZIP file.");
    expect(idFileProblem("AADHAAR_XML", undefined)).toBe("Choose the Aadhaar ZIP file.");
    expect(idFileProblem("EAADHAAR_PDF", pdf)).toBeNull();
    expect(idFileProblem("EAADHAAR_PDF", zip)).toBe("Choose the e-Aadhaar PDF.");
    expect(idFileProblem("PAN", undefined)).toBeNull();
  });
});
