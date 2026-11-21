/*
 * Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1–10
 * (up to 213 bytes), automatic mask choice. No dependencies. Output: module matrix or SVG.
 * Verified against an independent decoder (OpenCV) in development.
 */

// [total codewords, EC codewords per block, [[blocks, data codewords per block], ...]] for level M.
const VERSIONS: Array<[number, number, Array<[number, number]>]> = [
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
  [346, 26, [[4, 43], [1, 44]]],
];
const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j] ^= r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((c, i) => (r[i] ^= gfMul(c, factor)));
  }
  return r;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 0;
  for (; v < VERSIONS.length; v++) {
    const dataCw = VERSIONS[v]![2].reduce((a, [n, d]) => a + n * d, 0);
    const ccBits = v + 1 >= 10 ? 16 : 8;
    if (4 + ccBits + bytes.length * 8 <= dataCw * 8) break;
  }
  if (v === VERSIONS.length) throw new Error("Text too long for a QR code.");
  const version = v + 1;
  const [, ecLen, groups] = VERSIONS[v]!;
  const dataCw = groups.reduce((a, [n, d]) => a + n * d, 0);

  // Data bits: mode 0100, length, bytes, terminator, padding.
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, dataCw * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xec ^ 0x11) data.push(pad);

  // Blocks + error correction, interleaved.
  const blocks: number[][] = [];
  let k = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i++) blocks.push(data.slice(k, (k += d)));
  const div = rsDivisor(ecLen);
  const eccs = blocks.map((b) => rsRemainder(b, div));
  const all: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) all.push(b[i]!);
  for (let i = 0; i < ecLen; i++) for (const e of eccs) all.push(e[i]!);

  const size = version * 4 + 17;
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    m[y]![x] = dark;
    fn[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = ALIGN[v]!;
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  const format = (mask: number) => {
    const d = (0 << 3) | mask; // level M = 00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6));
    set(8, 8, bit(b, 7));
    set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  format(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, bit(b, i));
      set(c, a, bit(b, i));
    }
  }

  // Codewords, zig-zag from the bottom right.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y]![x] && i < all.length * 8) {
          m[y]![x] = bit(all[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
  }

  const MASKS: Array<(y: number, x: number) => boolean> = [
    (y, x) => (x + y) % 2 === 0,
    (y) => y % 2 === 0,
    (_y, x) => x % 3 === 0,
    (y, x) => (x + y) % 3 === 0,
    (y, x) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (y, x) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (y, x) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (y, x) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const apply = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && MASKS[mask]!(y, x)) m[y]![x] = !m[y]![x];
  };
  const penalty = () => {
    let p = 0;
    for (let a = 0; a < 2; a++)
      for (let r = 0; r < size; r++) {
        let run = 1;
        for (let c = 1; c <= size; c++) {
          const cur = c < size ? (a ? m[c]![r] : m[r]![c]) : undefined;
          const prev = a ? m[c - 1]![r] : m[r]![c - 1];
          if (cur === prev) run++;
          else {
            if (run >= 5) p += run - 2;
            run = 1;
          }
        }
      }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) p += 3;
    const pat = [true, false, true, true, true, false, true];
    for (let y = 0; y < size; y++)
      for (let x = 0; x + 7 <= size; x++) {
        if (pat.every((b, k2) => m[y]![x + k2] === b)) p += 40;
        if (pat.every((b, k2) => m[x + k2]![y] === b)) p += 40;
      }
    const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    apply(mask);
    format(mask);
    const p = penalty();
    if (p < bestP) {
      bestP = p;
      best = mask;
    }
    apply(mask);
  }
  apply(best);
  format(best);
  return m;
}

/** SVG of the QR code with a 4-module quiet zone (black on white). */
export function qrSvg(text: string, pixels = 512, caption?: string): string {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => (dark ? (d += `M${x + 4} ${y + 4}h1v1h-1z`) : null)));
  const capH = caption ? 4 : 0;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n + capH}" width="${pixels}" height="${Math.round((pixels * (n + capH)) / n)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/>${caption ? `<text x="${n / 2}" y="${n + 2.2}" font-family="sans-serif" font-size="2" text-anchor="middle" fill="#000">${esc(caption)}</text>` : ""}</svg>`;
}
