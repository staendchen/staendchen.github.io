const BLOCKS = [
  null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const REMAINDER = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0];
const MAX_VERSION = 10;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i += 1) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
const multiply = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= multiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function remainder(data, degree) {
  const gen = generator(degree);
  const out = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ out.shift();
    out.push(0);
    for (let i = 0; i < degree; i += 1) out[i] ^= multiply(gen[i + 1], factor);
  }
  return out;
}

function capacity(version) {
  const [, b1, d1, b2, d2] = BLOCKS[version];
  return b1 * d1 + b2 * d2;
}

function encodeData(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(4, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const total = capacity(version) * 8;
  push(0, Math.min(4, total - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity(version); pad ^= 0xec ^ 0x11) data.push(pad);
  return data;
}

function interleave(data, version) {
  const [ec, b1, d1, b2, d2] = BLOCKS[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1 + b2; i += 1) {
    const length = i < b1 ? d1 : d2;
    const block = data.slice(offset, offset + length);
    offset += length;
    blocks.push({ data: block, ec: remainder(block, ec) });
  }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i += 1) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < ec; i += 1) for (const block of blocks) out.push(block.ec[i]);
  return out;
}

function formatBits(mask) {
  const data = mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  constructor(version) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = new Uint8Array(this.size * this.size);
    this.fixed = new Uint8Array(this.size * this.size);
  }

  set(x, y, dark) {
    this.dark[y * this.size + x] = dark ? 1 : 0;
    this.fixed[y * this.size + x] = 1;
  }

  get(x, y) {
    return this.dark[y * this.size + x] === 1;
  }

  drawPatterns() {
    const { size, version } = this;
    for (let i = 0; i < size; i += 1) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) this.set(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
    const align = ALIGN[version];
    for (let i = 0; i < align.length; i += 1) {
      for (let j = 0; j < align.length; j += 1) {
        if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) this.set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    this.drawFormat(0);
    if (version >= 7) {
      const bits = versionBits(version);
      for (let i = 0; i < 18; i += 1) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, bit);
        this.set(b, a, bit);
      }
    }
  }

  drawFormat(mask) {
    const { size } = this;
    const bits = formatBits(mask);
    const bit = i => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i += 1) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i += 1) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  }

  drawData(codewords) {
    const { size } = this;
    let i = 0;
    const total = codewords.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (this.fixed[y * size + x]) continue;
          if (i < total) this.dark[y * size + x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
          i += 1;
        }
      }
    }
  }

  applyMask(mask) {
    const { size } = this;
    const test = MASKS[mask];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (!this.fixed[y * size + x] && test(x, y)) this.dark[y * size + x] ^= 1;
    }
  }

  penalty() {
    const { size } = this;
    let score = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1; i <= size; i += 1) {
        if (i < size && get(i) === get(i - 1)) {
          run += 1;
          continue;
        }
        if (run >= 5) score += run - 2;
        run = 1;
      }
      for (let i = 0; i + 11 <= size; i += 1) {
        const s = Array.from({ length: 11 }, (_, k) => (get(i + k) ? 1 : 0)).join('');
        if (s === '10111010000' || s === '00001011101') score += 40;
      }
    };
    for (let y = 0; y < size; y += 1) line(x => this.get(x, y));
    for (let x = 0; x < size; x += 1) line(y => this.get(x, y));
    let dark = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (this.get(x, y)) dark += 1;
        if (x + 1 < size && y + 1 < size) {
          const c = this.get(x, y);
          if (c === this.get(x + 1, y) && c === this.get(x, y + 1) && c === this.get(x + 1, y + 1)) score += 3;
        }
      }
    }
    score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
    return score;
  }
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = 1;
  while (version <= MAX_VERSION && bytes.length + (version < 10 ? 2 : 3) > capacity(version)) version += 1;
  if (version > MAX_VERSION) throw new Error('text too long for a QR code');
  const codewords = interleave(encodeData(bytes, version), version);
  for (let i = 0; i < REMAINDER[version]; i += 8) codewords.push(0);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = new Grid(version);
    grid.drawPatterns();
    grid.drawData(codewords);
    grid.applyMask(mask);
    grid.drawFormat(mask);
    const score = grid.penalty();
    if (!best || score < best.score) best = { grid, score };
  }
  const { size, dark } = best.grid;
  return { size, dark: Uint8Array.from(dark) };
}

export function qrSvg(text, { margin = 2 } = {}) {
  const { size, dark } = qrMatrix(text);
  const full = size + margin * 2;
  let path = '';
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) if (dark[y * size + x]) path += `M${x + margin} ${y + margin}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
