/**
 * Removes metadata (EXIF location / camera, XMP, IPTC, comments, text chunks) from JPEG and PNG
 * without re-encoding the pixels. Pure — unit tested. Throws on a malformed file.
 */
export function stripImageMetadata(buf: Buffer, mime: string): Buffer {
  if (mime === "image/jpeg") return stripJpeg(buf);
  if (mime === "image/png") return stripPng(buf);
  throw new Error("Unsupported image type");
}

function stripJpeg(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("Not a JPEG");
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("Bad JPEG marker");
    const marker = buf[i + 1];
    if (marker === 0xd9) {
      out.push(buf.subarray(i, i + 2));
      break;
    }
    if (marker === 0xda) {
      // Start of scan: the rest is image data (+ EOI) — keep as is.
      out.push(buf.subarray(i));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    const seg = buf.subarray(i, i + 2 + len);
    // Drop APP1 (EXIF / XMP), APP3–APP15 (IPTC, vendor data) and COM. Keep APP0 (JFIF) and APP2 (ICC colour).
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2) || marker === 0xfe;
    if (!drop) out.push(seg);
    i += 2 + len;
  }
  return Buffer.concat(out);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(buf: Buffer): Buffer {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("Not a PNG");
  const out: Buffer[] = [PNG_SIG];
  let i = 8;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + len;
    if (end > buf.length) throw new Error("Bad PNG chunk");
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}
