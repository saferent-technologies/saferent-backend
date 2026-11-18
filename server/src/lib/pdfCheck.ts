import { inflateSync } from "node:zlib";

/**
 * Safety check for an uploaded PDF (pure — unit tested). Rejects password / encrypted PDFs and PDFs that
 * can run or carry things: JavaScript, launch actions, embedded / attached files, rich media, XFA forms.
 * Looks at the raw file AND inside every Flate-compressed stream (object streams can hide these names),
 * and decodes #xx escapes in names (/J#61vaScript). Returns a problem or null.
 */
export function pdfProblem(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return "This isn't a PDF file.";
  if (!buf.subarray(Math.max(0, buf.length - 2048)).toString("latin1").includes("%%EOF")) return "This PDF looks incomplete. Please export it again.";

  const texts: string[] = [buf.toString("latin1")];
  // Inflate compressed streams (bounded) and scan them too.
  const raw = texts[0];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let budget = 50 * 1024 * 1024; // total inflated bytes we're willing to look at
  let count = 0;
  while ((m = re.exec(raw)) && count < 2000) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    count++;
    const dictStart = raw.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : "";
    if (/\/FlateDecode/.test(dict)) {
      try {
        const out = inflateSync(buf.subarray(start, end), { maxOutputLength: Math.min(budget, 20 * 1024 * 1024) });
        budget -= out.length;
        texts.push(out.toString("latin1"));
      } catch {
        /* not inflatable (images etc.) — ignore */
      }
      if (budget <= 0) return "This PDF is too complex to check. Please export it as a simple PDF or upload photos.";
    }
    re.lastIndex = end;
  }

  const names = texts.map((t) => t.replace(/#([0-9A-Fa-f]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16)))).join("\n");
  if (/\/Encrypt\b/.test(names)) return "Password-protected PDFs can't be uploaded. Remove the password and try again.";
  if (/\/(JavaScript|JS)\b/.test(names)) return "This PDF contains scripts and can't be uploaded. Please export it again or upload photos.";
  if (/\/Launch\b/.test(names)) return "This PDF tries to open other programs and can't be uploaded.";
  if (/\/(EmbeddedFiles?|FileAttachment)\b/.test(names)) return "This PDF has files attached inside it and can't be uploaded.";
  if (/\/(RichMedia|XFA)\b/.test(names)) return "This PDF has interactive content and can't be uploaded. Please export it as a plain PDF.";
  return null;
}
