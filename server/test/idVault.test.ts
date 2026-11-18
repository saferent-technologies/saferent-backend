import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "../src/lib/imageScrub";

const seg = (m: number, payload: Buffer) => {
  const b = Buffer.alloc(4);
  b[0] = 0xff;
  b[1] = m;
  b.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([b, payload]);
};

describe("ID vault image scrubbing", () => {
  it("removes EXIF and comments from a JPEG but keeps the image", () => {
    const jpg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe0, Buffer.from("JFIF\0")),
      seg(0xe1, Buffer.from("Exif\0\0GPS-SECRET")),
      seg(0xfe, Buffer.from("comment")),
      Buffer.from([0xff, 0xda, 0, 4, 1, 2]),
      Buffer.from("pixels"),
      Buffer.from([0xff, 0xd9]),
    ]);
    const out = stripImageMetadata(jpg, "image/jpeg");
    expect(out.includes("GPS-SECRET")).toBe(false);
    expect(out.includes("comment")).toBe(false);
    expect(out.includes("JFIF")).toBe(true);
    expect(out.includes("pixels")).toBe(true);
  });

  it("removes text chunks from a PNG", () => {
    const chunk = (t: string, d: Buffer) => {
      const l = Buffer.alloc(4);
      l.writeUInt32BE(d.length);
      return Buffer.concat([l, Buffer.from(t), d, Buffer.alloc(4)]);
    };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", Buffer.alloc(13)), chunk("tEXt", Buffer.from("Author\0secret")), chunk("IDAT", Buffer.from("data")), chunk("IEND", Buffer.alloc(0))]);
    const out = stripImageMetadata(png, "image/png");
    expect(out.includes("secret")).toBe(false);
    expect(out.includes("data")).toBe(true);
  });

  it("rejects a file that isn't really a JPEG", () => {
    expect(() => stripImageMetadata(Buffer.from("not an image"), "image/jpeg")).toThrow();
  });
});

import { deflateSync } from "node:zlib";
import { pdfProblem } from "../src/lib/pdfCheck";

describe("ID vault PDF check", () => {
  const mk = (body: string) => Buffer.from(`%PDF-1.7\n${body}\ntrailer<</Root 1 0 R>>\n%%EOF\n`, "latin1");
  it("accepts a plain PDF", () => expect(pdfProblem(mk("1 0 obj<</Type/Catalog>>endobj"))).toBeNull());
  it("rejects scripts, also hex-escaped", () => {
    expect(pdfProblem(mk("1 0 obj<</OpenAction<</S/JavaScript/JS(x)>>>>endobj"))).toMatch(/scripts/);
    expect(pdfProblem(mk("1 0 obj<</S/J#61vaScript>>endobj"))).toMatch(/scripts/);
  });
  it("rejects password-protected PDFs", () => expect(pdfProblem(mk("trailer<</Encrypt 5 0 R>>"))).toMatch(/Password/));
  it("finds embedded files inside compressed streams", () => {
    const hidden = deflateSync(Buffer.from("<</Type/Filespec/EF<</F 9 0 R>>/EmbeddedFile>>"));
    const pdf = Buffer.concat([Buffer.from(`%PDF-1.7\n3 0 obj<</Type/ObjStm/Filter/FlateDecode/Length ${hidden.length}>>stream\n`, "latin1"), hidden, Buffer.from("\nendstream endobj\n%%EOF\n", "latin1")]);
    expect(pdfProblem(pdf)).toMatch(/attached/);
  });
  it("rejects non-PDF bytes", () => expect(pdfProblem(Buffer.from("hello"))).toMatch(/isn't a PDF/));
});
