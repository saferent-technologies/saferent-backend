import { createCipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";

/*
 * Minimal, dependency-free ZIP reader for small password-protected archives (UIDAI Offline eKYC).
 * Supports: stored / deflated entries, traditional PKWARE encryption (ZipCrypto) and WinZip AES
 * (AE-1 / AE-2, 128 / 192 / 256-bit). Everything is in memory and size-capped.
 */

export class ZipError extends Error {
  constructor(
    public code: "NOT_ZIP" | "BAD_PASSWORD" | "UNSUPPORTED" | "TOO_LARGE" | "CORRUPT",
    message: string,
  ) {
    super(message);
  }
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── Traditional PKWARE (ZipCrypto) ── */
function zipCryptoDecrypt(data: Buffer, password: Buffer, check: number): Buffer {
  let k0 = 305419896;
  let k1 = 591751049;
  let k2 = 878082192;
  const crcByte = (c: number, b: number) => (CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
  const update = (b: number) => {
    k0 = crcByte(k0, b);
    k1 = (k1 + (k0 & 0xff)) >>> 0;
    k1 = (Math.imul(k1, 134775813) + 1) >>> 0;
    k2 = crcByte(k2, k1 >>> 24);
  };
  const decByte = () => {
    const t = (k2 | 2) & 0xffff;
    return (Math.imul(t, t ^ 1) >>> 8) & 0xff;
  };
  for (const b of password) update(b);
  if (data.length < 12) throw new ZipError("CORRUPT", "The file is damaged.");
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    const p = data[i] ^ decByte();
    update(p);
    out[i] = p;
  }
  // Last byte of the 12-byte header must match the high byte of the CRC (or of the time when bit 3 is set).
  if (out[11] !== check) throw new ZipError("BAD_PASSWORD", "Wrong share code.");
  return out.subarray(12);
}

/* ── WinZip AES ── */
function aesDecrypt(data: Buffer, password: Buffer, strength: number): Buffer {
  const keyLen = strength === 1 ? 16 : strength === 2 ? 24 : strength === 3 ? 32 : 0;
  if (!keyLen) throw new ZipError("UNSUPPORTED", "Unsupported encryption.");
  const saltLen = keyLen / 2;
  if (data.length < saltLen + 2 + 10) throw new ZipError("CORRUPT", "The file is damaged.");
  const salt = data.subarray(0, saltLen);
  const pwv = data.subarray(saltLen, saltLen + 2);
  const body = data.subarray(saltLen + 2, data.length - 10);
  const auth = data.subarray(data.length - 10);
  const derived = pbkdf2Sync(password, salt, 1000, keyLen * 2 + 2, "sha1");
  const encKey = derived.subarray(0, keyLen);
  const macKey = derived.subarray(keyLen, keyLen * 2);
  if (!timingSafeEqual(derived.subarray(keyLen * 2), pwv)) throw new ZipError("BAD_PASSWORD", "Wrong share code.");
  const mac = createHmac("sha1", macKey).update(body).digest().subarray(0, 10);
  if (!timingSafeEqual(mac, auth)) throw new ZipError("CORRUPT", "The file is damaged or was changed.");
  // AES-CTR with a little-endian block counter starting at 1 (WinZip spec), built block by block.
  const blocks = Math.ceil(body.length / 16);
  const counters = Buffer.alloc(blocks * 16);
  for (let i = 0; i < blocks; i++) {
    let n = i + 1;
    for (let j = 0; j < 8 && n > 0; j++) {
      counters[i * 16 + j] = n & 0xff;
      n = Math.floor(n / 256);
    }
  }
  const ecb = createCipheriv(`aes-${keyLen * 8}-ecb`, encKey, null);
  ecb.setAutoPadding(false);
  const stream = Buffer.concat([ecb.update(counters), ecb.final()]);
  const out = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ stream[i];
  return out;
}

/** Reads every file entry. `maxEntryBytes` caps each uncompressed entry. */
export function readZip(buf: Buffer, password: string | null, maxEntryBytes = 10 * 1024 * 1024): ZipEntry[] {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new ZipError("NOT_ZIP", "This isn't a ZIP file.");
  // End of central directory (allow a trailing comment up to 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("CORRUPT", "The ZIP file is damaged.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > 20) throw new ZipError("UNSUPPORTED", "Unexpected ZIP contents.");
  const pw = password !== null ? Buffer.from(password, "utf8") : null;
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("CORRUPT", "The ZIP file is damaged.");
    const flags = buf.readUInt16LE(p + 8);
    let method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (size > maxEntryBytes || compSize > buf.length) throw new ZipError("TOO_LARGE", "The file inside the ZIP is too large.");

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError("CORRUPT", "The ZIP file is damaged.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    let data: Buffer = buf.subarray(start, start + compSize);
    if (data.length !== compSize) throw new ZipError("CORRUPT", "The ZIP file is damaged.");

    let checkCrc = true;
    if (flags & 1) {
      if (!pw) throw new ZipError("BAD_PASSWORD", "This ZIP needs the share code.");
      if (method === 99) {
        // AES extra field 0x9901: version(2) 'AE'(2) strength(1) method(2)
        let q = 0;
        let strength = 0;
        while (q + 4 <= extra.length) {
          const id = extra.readUInt16LE(q);
          const len = extra.readUInt16LE(q + 2);
          if (id === 0x9901 && len >= 7) {
            const version = extra.readUInt16LE(q + 4);
            strength = extra[q + 8];
            method = extra.readUInt16LE(q + 9);
            if (version === 2) checkCrc = false; // AE-2 stores no CRC
          }
          q += 4 + len;
        }
        data = aesDecrypt(data, pw, strength);
      } else {
        if (flags & 0x40) throw new ZipError("UNSUPPORTED", "Unsupported ZIP encryption.");
        data = zipCryptoDecrypt(data, pw, flags & 8 ? (time >>> 8) & 0xff : crc >>> 24);
      }
    }
    let out: Buffer;
    if (method === 0) out = Buffer.from(data);
    else if (method === 8) {
      try {
        out = inflateRawSync(data, { maxOutputLength: maxEntryBytes });
      } catch {
        // A wrong ZipCrypto password passes the 1-byte check about 1 time in 256: the data won't inflate.
        throw new ZipError(flags & 1 ? "BAD_PASSWORD" : "CORRUPT", flags & 1 ? "Wrong share code." : "The ZIP file is damaged.");
      }
    } else throw new ZipError("UNSUPPORTED", "Unsupported ZIP compression.");
    if (checkCrc && crc32(out) !== crc) throw new ZipError(flags & 1 ? "BAD_PASSWORD" : "CORRUPT", flags & 1 ? "Wrong share code." : "The ZIP file is damaged.");
    entries.push({ name, data: out });
  }
  return entries;
}
