import { describe, expect, it } from "vitest";
import { buildPdf, pdfText } from "../src/lib/simplePdf";

describe("receipt PDF writer", () => {
  it("escapes PDF syntax and replaces characters Helvetica can't draw", () => {
    expect(pdfText("Ravi (B) \\ x")).toBe("Ravi \\(B\\) \\\\ x");
    expect(pdfText("₹500")).toBe("Rs.500");
    expect(pdfText("José")).toBe("Jose");
  });

  it("produces a well-formed one-page PDF", () => {
    const pdf = buildPdf([{ kind: "text", text: "Rent Receipt", bold: true }, { kind: "rule" }, { kind: "row", label: "Amount", value: "Rs. 18,000.00" }], { title: "t" });
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    expect(s).toContain("(Rs. 18,000.00) Tj");
  });
});
