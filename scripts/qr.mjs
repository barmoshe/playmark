// A QR code for the terminal, so a phone can open the sink's URL by scanning it.
// Byte mode, error correction L, versions 1-6 (up to 134 bytes), one fixed mask: enough for a URL.
const BLOCKS = [null, [1, 19, 7], [1, 34, 10], [1, 55, 15], [1, 80, 20], [1, 108, 26], [2, 68, 18]]; // [blocks, data, ec] per block

const EXP = [], LOG = [];
for (let i = 0, x = 1; i < 255; i++, x = x & 128 ? (x << 1) ^ 0x11d : x << 1) { EXP[i] = x; LOG[x] = i; }
const mul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);

// Reed-Solomon remainder of `data` for `n` error correction bytes.
function rs(data, n) {
  let g = [1];
  for (let i = 0; i < n; i++) g = [...g, 0].map((c, j) => c ^ (j ? mul(g[j - 1], EXP[i]) : 0));
  const r = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ r.shift();
    r.push(0);
    for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f);
  }
  return r;
}

/** The QR code of `text` as rows of booleans (true = dark), without the quiet zone. */
export function qrMatrix(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  const v = BLOCKS.findIndex((b) => b && b[0] * b[1] * 8 >= 12 + bytes.length * 8);
  if (v === -1) throw new Error("too long for a small QR code");
  const [blocks, perBlock, ecLen] = BLOCKS[v];
  const capacity = blocks * perBlock;
  let bits = "0100" + bytes.length.toString(2).padStart(8, "0") + bytes.map((b) => b.toString(2).padStart(8, "0")).join("");
  bits += "0".repeat(Math.min(4, capacity * 8 - bits.length));
  bits += "0".repeat((8 - (bits.length % 8)) % 8);
  const data = bits.match(/.{8}/g).map((b) => parseInt(b, 2));
  for (let i = 0; data.length < capacity; i++) data.push(i % 2 ? 0x11 : 0xec);
  const split = Array.from({ length: blocks }, (_, i) => data.slice(i * perBlock, (i + 1) * perBlock));
  const ecs = split.map((b) => rs(b, ecLen));
  const words = [];
  for (let i = 0; i < perBlock; i++) for (const b of split) words.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) words.push(e[i]);

  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const square = (cx, cy, r, dark) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, dark(Math.max(Math.abs(dx), Math.abs(dy))));
    }
  };
  for (const [x, y] of [[3, 3], [size - 4, 3], [3, size - 4]]) square(x, y, 4, (d) => d !== 2 && d !== 4);
  if (v > 1) square(size - 7, size - 7, 2, (d) => d !== 1);
  // Format: level L (01), mask 0, with its BCH code. Drawn once to reserve the cells, again for real.
  const format = (on) => {
    let rem = 0b01000;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((0b01000 << 10) | rem) ^ 0x5412;
    const bit = (i) => on && ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  format(false);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let k = 0; k < size; k++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - k : k;
      if (fixed[y][x]) continue;
      const dark = i < words.length * 8 && ((words[i >> 3] >>> (7 - (i & 7))) & 1) === 1;
      m[y][x] = dark !== ((x + y) % 2 === 0); // mask 0
      i++;
    }
  }
  format(true);
  return m;
}

/** The code as terminal text: two rows per line, black on white whatever the terminal's colors. */
export function qrText(text) {
  const m = qrMatrix(text), q = 4, n = m.length + 2 * q;
  const dark = (x, y) => x >= q && y >= q && x < n - q && y < n - q && m[y - q][x - q];
  const lines = [];
  for (let y = 0; y < n; y += 2) {
    let line = "  ";
    for (let x = 0; x < n; x++) line += `\x1b[${dark(x, y) ? 30 : 97};${dark(x, y + 1) && y + 1 < n ? 40 : 107}m▀`;
    lines.push(line + "\x1b[0m");
  }
  return lines.join("\n");
}
