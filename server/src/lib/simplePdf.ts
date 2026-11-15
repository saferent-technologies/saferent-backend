/**
 * Tiny dependency-free PDF writer for one-page documents (rent receipts).
 * Uses the built-in Helvetica fonts (WinAnsi), so text outside Latin-1 is replaced — callers should
 * write "Rs." rather than "₹". Pure: unit-testable and safe to call per request.
 */

export type PdfLine =
  | { kind: "text"; text: string; size?: number; bold?: boolean; x?: number; color?: [number, number, number] }
  | { kind: "row"; label: string; value: string; size?: number }
  | { kind: "rule" }
  | { kind: "gap"; height?: number };

const PAGE_W = 595; // A4 in points
const PAGE_H = 842;
const MARGIN = 56;

/** Keeps characters Helvetica/WinAnsi can draw; escapes PDF string syntax. */
export function pdfText(input: string): string {
  const latin = Array.from(input.normalize("NFKD"))
    .map((ch) => {
      if (ch === "₹") return "Rs.";
      if (/[̀-ͯ]/.test(ch)) return ""; // combining accents after NFKD
      const code = ch.codePointAt(0)!;
      if (ch === "\n" || ch === "\t") return " ";
      return code >= 0x20 && code <= 0x7e ? ch : code >= 0xa0 && code <= 0xff ? ch : "?";
    })
    .join("");
  return latin.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Rough Helvetica width so long values wrap instead of running off the page. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const perChar = size * 0.52;
  const max = Math.max(8, Math.floor(maxWidth / perChar));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines.flatMap((l) => (l.length > max ? l.match(new RegExp(`.{1,${max}}`, "g"))! : [l])) : [""];
}

export function buildPdf(lines: PdfLine[], meta: { title?: string } = {}): Buffer {
  const ops: string[] = [];
  let y = PAGE_H - MARGIN;
  const put = (text: string, x: number, size: number, bold: boolean, color: [number, number, number] = [0.1, 0.1, 0.12]) => {
    ops.push(`${color.join(" ")} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y.toFixed(1)} Td (${pdfText(text)}) Tj ET`);
  };
  for (const line of lines) {
    if (y < MARGIN) break; // one page only
    if (line.kind === "gap") y -= line.height ?? 10;
    else if (line.kind === "rule") {
      y -= 6;
      ops.push(`0.85 0.86 0.88 RG 0.8 w ${MARGIN} ${y} m ${PAGE_W - MARGIN} ${y} l S`);
      y -= 14;
    } else if (line.kind === "text") {
      const size = line.size ?? 11;
      for (const part of wrap(line.text, size, PAGE_W - MARGIN * 2)) {
        put(part, line.x ?? MARGIN, size, !!line.bold, line.color);
        y -= size * 1.45;
      }
    } else {
      const size = line.size ?? 11;
      const valueX = MARGIN + 150;
      const parts = wrap(line.value, size, PAGE_W - MARGIN - valueX);
      put(line.label, MARGIN, size, false, [0.42, 0.45, 0.5]);
      parts.forEach((part, i) => {
        if (i) y -= size * 1.4;
        put(part, valueX, size, true);
      });
      y -= size * 1.9;
    }
  }

  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    `<< /Title (${pdfText(meta.title ?? "SafeRent")}) /Producer (SafeRent) >>`,
  ];
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
