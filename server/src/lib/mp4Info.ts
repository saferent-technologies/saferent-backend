import { open } from "node:fs/promises";

/**
 * Minimal MP4 / ISO-BMFF reader (no ffmpeg on the server): checks the file really is MP4 (ftyp box)
 * and reads the duration from moov/mvhd. Returns null when the file isn't a readable MP4.
 */
export async function mp4Info(file: string): Promise<{ durationSec: number; brand: string } | null> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(16);
    const read = async (pos: number, len: number) => {
      const b = Buffer.alloc(len);
      const { bytesRead } = await fh.read(b, 0, len, pos);
      return b.subarray(0, bytesRead);
    };
    await fh.read(head, 0, 16, 0);
    if (head.toString("latin1", 4, 8) !== "ftyp") return null;
    const brand = head.toString("latin1", 8, 12);

    // Walk the top-level boxes until moov.
    let pos = 0;
    for (let guard = 0; pos + 8 <= size && guard < 1000; guard++) {
      const h = await read(pos, 16);
      if (h.length < 8) return null;
      let boxSize = h.readUInt32BE(0);
      const type = h.toString("latin1", 4, 8);
      let headerLen = 8;
      if (boxSize === 1) {
        if (h.length < 16) return null;
        boxSize = Number(h.readBigUInt64BE(8));
        headerLen = 16;
      } else if (boxSize === 0) {
        boxSize = size - pos;
      }
      if (boxSize < headerLen) return null;
      if (type === "moov") {
        const len = Math.min(boxSize - headerLen, 8 * 1024 * 1024);
        const moov = await read(pos + headerLen, len);
        return findMvhd(moov, brand);
      }
      pos += boxSize;
    }
    return null;
  } finally {
    await fh.close();
  }
}

function findMvhd(moov: Buffer, brand: string): { durationSec: number; brand: string } | null {
  let p = 0;
  while (p + 8 <= moov.length) {
    const boxSize = moov.readUInt32BE(p);
    const type = moov.toString("latin1", p + 4, p + 8);
    if (type === "mvhd") {
      const version = moov[p + 8];
      const base = p + 12;
      let timescale: number;
      let duration: number;
      if (version === 1) {
        if (base + 32 > moov.length) return null;
        timescale = moov.readUInt32BE(base + 16);
        duration = Number(moov.readBigUInt64BE(base + 20));
      } else {
        if (base + 16 > moov.length) return null;
        timescale = moov.readUInt32BE(base + 8);
        duration = moov.readUInt32BE(base + 12);
      }
      if (!timescale) return null;
      return { durationSec: duration / timescale, brand };
    }
    if (boxSize < 8) return null;
    p += boxSize;
  }
  return null;
}
