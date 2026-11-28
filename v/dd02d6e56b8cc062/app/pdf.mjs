export const A4 = { width: 595.28, height: 841.89 };
const IDENTITY = [1, 0, 0, 1, 0, 0];
const KAPPA = 0.5522847498;
const FONTS = { regular: 'Times-Roman', italic: 'Times-Italic', bold: 'Times-Bold', boldItalic: 'Times-BoldItalic', sans: 'Helvetica', sansBold: 'Helvetica-Bold' };
const FONT_KEYS = { regular: 'F1', italic: 'F2', bold: 'F3', boldItalic: 'F4', sans: 'F5', sansBold: 'F6' };
const WIN_ANSI = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f, 0x266d: 0x62, 0x266f: 0x23 };
const MAX_GLYPH_PATH = 20000;

export const num = value => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

export const fine = value => {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) return '0';
  const text = value.toFixed(9).replace(/\.?0+$/, '');
  return text === '-0' || text === '' ? '0' : text;
};

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const numbers = text => (String(text ?? '').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []).map(Number);

export function parseTransform(text) {
  let m = IDENTITY;
  for (const [, kind, args] of String(text ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = numbers(args);
    let t = IDENTITY;
    if (kind === 'matrix' && a.length === 6) t = a;
    else if (kind === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (kind === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (kind === 'rotate') {
      const r = (a[0] || 0) * Math.PI / 180;
      const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      t = a.length === 3 ? multiply(multiply([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]) : rot;
    } else if (kind === 'skewX') t = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
    else if (kind === 'skewY') t = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

export function pathOps(d) {
  const tokens = String(d ?? '').match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  let i = 0;
  let command = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastControl = null;
  let lastQuad = null;
  const next = () => Number(tokens[i++]);
  const has = n => i + n <= tokens.length && tokens.slice(i, i + n).every(t => !/^[A-Za-z]$/.test(t));
  const curve = (x1, y1, x2, y2, x3, y3) => {
    out.push(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x3)} ${num(y3)} c`);
    x = x3;
    y = y3;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) command = tokens[i++];
    else if (!command) return out.join('\n');
    const rel = command === command.toLowerCase();
    const C = command.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    let control = null;
    let quad = null;
    if (C === 'Z') {
      out.push('h');
      x = startX;
      y = startY;
      command = null;
    } else if (C === 'M') {
      if (!has(2)) break;
      x = ox + next();
      y = oy + next();
      startX = x;
      startY = y;
      out.push(`${num(x)} ${num(y)} m`);
      command = rel ? 'l' : 'L';
    } else if (C === 'L') {
      if (!has(2)) break;
      x = ox + next();
      y = oy + next();
      out.push(`${num(x)} ${num(y)} l`);
    } else if (C === 'H') {
      if (!has(1)) break;
      x = ox + next();
      out.push(`${num(x)} ${num(y)} l`);
    } else if (C === 'V') {
      if (!has(1)) break;
      y = oy + next();
      out.push(`${num(x)} ${num(y)} l`);
    } else if (C === 'C') {
      if (!has(6)) break;
      const p = [ox + next(), oy + next(), ox + next(), oy + next(), ox + next(), oy + next()];
      control = [p[2], p[3]];
      curve(...p);
    } else if (C === 'S') {
      if (!has(4)) break;
      const r = lastControl ? [2 * x - lastControl[0], 2 * y - lastControl[1]] : [x, y];
      const p = [ox + next(), oy + next(), ox + next(), oy + next()];
      control = [p[0], p[1]];
      curve(r[0], r[1], ...p);
    } else if (C === 'Q' || C === 'T') {
      if (!has(C === 'Q' ? 4 : 2)) break;
      const q = C === 'Q' ? [ox + next(), oy + next()] : lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
      const ex = ox + next();
      const ey = oy + next();
      quad = q;
      curve(x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y), ex + 2 / 3 * (q[0] - ex), ey + 2 / 3 * (q[1] - ey), ex, ey);
    } else if (C === 'A') {
      if (!has(7)) break;
      i += 5;
      x = ox + next();
      y = oy + next();
      out.push(`${num(x)} ${num(y)} l`);
    } else break;
    lastControl = control;
    lastQuad = quad;
  }
  return out.join('\n');
}

export function winAnsi(char) {
  const code = char.codePointAt(0);
  if (code >= 0x20 && code < 0x7f) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WIN_ANSI[code] ?? 0x3f;
}

export function pdfString(text) {
  let out = '(';
  for (const char of text) {
    const code = winAnsi(char);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${String.fromCharCode(code)}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return `${out})`;
}

function utf16Hex(text) {
  let hex = '<FEFF';
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `${hex}>`;
}

export const isMusicChar = char => {
  const code = char.codePointAt(0);
  return code >= 0xe000 && code <= 0xf8ff;
};

export function checkGlyphs(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.unitsPerEm) || value.unitsPerEm < 16 || value.unitsPerEm > 16384) throw new Error('glyphs are invalid');
  if (!value.glyphs || typeof value.glyphs !== 'object') throw new Error('glyphs are invalid');
  const glyphs = new Map();
  for (const [code, entry] of Object.entries(value.glyphs)) {
    if (!/^[0-9A-F]{4,5}$/.test(code) || !Array.isArray(entry) || entry.length !== 2) continue;
    const [advance, d] = entry;
    if (!Number.isFinite(advance) || typeof d !== 'string' || d.length > MAX_GLYPH_PATH || !/^[MmZzLlHhVvCcSsQqTt0-9eE.,+\- ]*$/.test(d)) continue;
    glyphs.set(parseInt(code, 16), { advance, d });
  }
  return { unitsPerEm: value.unitsPerEm, glyphs };
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const encoder = new TextEncoder();
const latin1 = text => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

export class PdfWriter {
  constructor({ title = '', glyphs = null } = {}) {
    this.title = title;
    this.glyphs = glyphs;
    this.pages = [];
    this.front = [];
    this.outline = [];
    this.forms = new Map();
  }

  form(key, content) {
    if (!this.forms.has(key)) this.forms.set(key, { name: `G${this.forms.size + 1}`, content });
    return this.forms.get(key).name;
  }

  glyphForm(code) {
    const glyph = this.glyphs?.glyphs.get(code);
    if (!glyph) return null;
    return { name: this.form(`L${code}`, `${pathOps(glyph.d)}\nf`), advance: glyph.advance, unitsPerEm: this.glyphs.unitsPerEm };
  }

  addPage(content, { width = A4.width, height = A4.height, front = false, links = [] } = {}) {
    const data = deflate(latin1(content));
    data.catch(() => {});
    const page = { data, width, height, links, extra: [] };
    if (front) {
      this.front.push(page);
      return -this.front.length;
    }
    this.pages.push(page);
    return this.pages.length - 1;
  }

  appendTo(index, content) {
    this.pages[index]?.extra.push(content);
  }

  bookmark(title, index, top) {
    this.outline.push({ title: String(title), index, top });
  }

  async build() {
    const objects = [];
    const add = value => {
      objects.push(value);
      return objects.length;
    };
    const catalog = add(null);
    const pagesId = add(null);
    const ordered = [...this.front, ...this.pages];
    const pageIds = ordered.map(() => add(null));
    const target = index => pageIds[this.front.length + index];
    const fontIds = Object.entries(FONTS).map(([style, base]) => [FONT_KEYS[style], add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)]);
    const formIds = [];
    for (const { name, content } of this.forms.values()) {
      const data = await deflate(latin1(content));
      formIds.push([name, add({ dict: `<< /Type /XObject /Subtype /Form /BBox [-20000 -20000 20000 20000] /Filter /FlateDecode /Length ${data.length} >>`, data })]);
    }
    const resources = add(`<< /Font << ${fontIds.map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >> /XObject << ${formIds.map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >> >>`);
    for (const [i, page] of ordered.entries()) {
      const streams = [await page.data];
      for (const extra of page.extra) streams.push(await deflate(latin1(extra)));
      const contents = streams.map(data => add({ dict: `<< /Filter /FlateDecode /Length ${data.length} >>`, data }));
      const links = page.links.filter(link => pageIds[this.front.length + link.index] && link.rect.length === 4)
        .map(link => add(`<< /Type /Annot /Subtype /Link /Rect [${link.rect.map(num).join(' ')}] /Border [0 0 0] /Dest [${target(link.index)} 0 R /XYZ null null null] >>`));
      objects[pageIds[i] - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources ${resources} 0 R /Contents [${contents.map(id => `${id} 0 R`).join(' ')}]${links.length ? ` /Annots [${links.map(id => `${id} 0 R`).join(' ')}]` : ''} >>`;
    }
    let outlines = null;
    const marks = this.outline.filter(mark => target(mark.index));
    if (marks.length) {
      outlines = add(null);
      const ids = marks.map(() => add(null));
      marks.forEach((mark, i) => {
        const links = `${i ? ` /Prev ${ids[i - 1]} 0 R` : ''}${i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : ''}`;
        objects[ids[i] - 1] = `<< /Title ${utf16Hex(mark.title)} /Parent ${outlines} 0 R${links} /Dest [${target(mark.index)} 0 R /XYZ null ${num(mark.top)} null] >>`;
      });
      objects[outlines - 1] = `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids.at(-1)} 0 R /Count ${ids.length} >>`;
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R${outlines ? ` /Outlines ${outlines} 0 R /PageMode /UseOutlines` : ''} >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const info = add(`<< /Title ${utf16Hex(this.title)} /Producer ${utf16Hex('Ständchen')} >>`);
    const chunks = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((object, i) => {
      offsets.push(offset);
      const parts = typeof object === 'string'
        ? [latin1(`${i + 1} 0 obj\n${object}\nendobj\n`)]
        : [latin1(`${i + 1} 0 obj\n${object.dict}\nstream\n`), object.data, latin1('\nendstream\nendobj\n')];
      for (const part of parts) {
        chunks.push(part);
        offset += part.length;
      }
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    chunks.push(encoder.encode(xref));
    return new Blob(chunks, { type: 'application/pdf' });
  }
}

export const cm = m => `${m.slice(0, 4).map(fine).join(' ')} ${num(m[4])} ${num(m[5])} cm`;

function color(value) {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(String(value).trim());
  if (!match) return null;
  if (match[4] !== undefined && Number(match[4]) === 0) return null;
  return [match[1], match[2], match[3]].map(v => num(Number(v) / 255)).join(' ');
}

function fontStyle(style) {
  const bold = Number(style.fontWeight) >= 600 || style.fontWeight === 'bold';
  const italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique';
  return FONT_KEYS[bold ? (italic ? 'boldItalic' : 'bold') : (italic ? 'italic' : 'regular')];
}

function length(value, whole) {
  const text = String(value ?? '').trim();
  if (!text) return whole;
  const n = Number.parseFloat(text);
  if (!Number.isFinite(n)) return whole;
  return text.endsWith('%') ? whole * n / 100 : n;
}

export function viewBoxMatrix(el, viewport) {
  const box = numbers(el.getAttribute('viewBox'));
  const x = Number.parseFloat(el.getAttribute('x')) || 0;
  const y = Number.parseFloat(el.getAttribute('y')) || 0;
  const w = length(el.getAttribute('width'), viewport[0]);
  const h = length(el.getAttribute('height'), viewport[1]);
  if (box.length !== 4 || !box[2] || !box[3]) return { matrix: [1, 0, 0, 1, x, y], viewport: [w, h] };
  const s = Math.min(w / box[2], h / box[3]);
  return { matrix: [s, 0, 0, s, x + (w - box[2] * s) / 2 - box[0] * s, y + (h - box[3] * s) / 2 - box[1] * s], viewport: [box[2], box[3]] };
}

function shapeOps(el) {
  const n = name => Number.parseFloat(el.getAttribute(name)) || 0;
  switch (el.localName) {
    case 'path':
      return pathOps(el.getAttribute('d'));
    case 'polygon':
    case 'polyline': {
      const p = numbers(el.getAttribute('points'));
      if (p.length < 4) return '';
      const ops = [`${num(p[0])} ${num(p[1])} m`];
      for (let i = 2; i + 1 < p.length; i += 2) ops.push(`${num(p[i])} ${num(p[i + 1])} l`);
      if (el.localName === 'polygon') ops.push('h');
      return ops.join('\n');
    }
    case 'rect':
      return `${num(n('x'))} ${num(n('y'))} ${num(n('width'))} ${num(n('height'))} re`;
    case 'line':
      return `${num(n('x1'))} ${num(n('y1'))} m\n${num(n('x2'))} ${num(n('y2'))} l`;
    case 'circle':
    case 'ellipse': {
      const cx = n('cx');
      const cy = n('cy');
      const rx = el.localName === 'circle' ? n('r') : n('rx');
      const ry = el.localName === 'circle' ? n('r') : n('ry');
      if (!rx || !ry) return '';
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      return [
        `${num(cx + rx)} ${num(cy)} m`,
        `${num(cx + rx)} ${num(cy + ky)} ${num(cx + kx)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c`,
        `${num(cx - kx)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ky)} ${num(cx - rx)} ${num(cy)} c`,
        `${num(cx - rx)} ${num(cy - ky)} ${num(cx - kx)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c`,
        `${num(cx + kx)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ky)} ${num(cx + rx)} ${num(cy)} c`,
        'h',
      ].join('\n');
    }
    default:
      return '';
  }
}

const CAPS = { butt: 0, round: 1, square: 2 };
const JOINS = { miter: 0, round: 1, bevel: 2 };

export function drawSvg(writer, svg, target) {
  const out = [];
  const styleOf = el => getComputedStyle(el);

  function paint(el, style, ops) {
    if (!ops) return;
    const fill = style.fill === 'none' ? null : color(style.fill);
    const strokeWidth = Number.parseFloat(style.strokeWidth);
    const stroke = style.stroke === 'none' || !(strokeWidth > 0) ? null : color(style.stroke);
    if (!fill && !stroke) return;
    const head = [];
    if (fill) head.push(`${fill} rg`);
    if (stroke) head.push(`${stroke} RG`, `${num(strokeWidth)} w`, `${CAPS[style.strokeLinecap] ?? 0} J`, `${JOINS[style.strokeLinejoin] ?? 0} j`);
    const evenodd = style.fillRule === 'evenodd';
    const op = fill && stroke ? (evenodd ? 'B*' : 'B') : fill ? (evenodd ? 'f*' : 'f') : 'S';
    out.push(head.join('\n'), ops, op);
  }

  function glyphRef(id) {
    const ref = svg.querySelector(`[id="${id.replace(/["\\]/g, '')}"]`);
    if (!ref) return null;
    const parts = [];
    const walkDef = (el, m) => {
      const local = multiply(m, parseTransform(el.getAttribute('transform')));
      if (el.localName === 'g' || el.localName === 'symbol') {
        for (const child of el.children) walkDef(child, local);
        return;
      }
      const ops = shapeOps(el);
      if (ops) parts.push(`q\n${cm(local)}\n${ops}\nf\nQ`);
    };
    walkDef(ref, IDENTITY);
    return parts.length ? writer.form(`U${id.replace(/^vrv-/, '').replace(/-.*$/, '')}:${parts.join('').length}`, parts.join('\n')) : null;
  }

  function text(el, m) {
    const local = multiply(m, parseTransform(el.getAttribute('transform')));
    const leaves = [...el.querySelectorAll('tspan')].filter(t => !t.querySelector('tspan'));
    if (!leaves.length && el.textContent.trim()) leaves.push(el);
    for (const leaf of leaves) {
      const style = styleOf(leaf);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const fill = style.fill === 'none' ? null : color(style.fill);
      if (!fill) continue;
      const size = Number.parseFloat(style.fontSize);
      if (!(size > 0)) continue;
      const count = typeof leaf.getNumberOfChars === 'function' ? leaf.getNumberOfChars() : 0;
      const chars = [...leaf.textContent.replace(/\s+/g, ' ').trim()];
      if (!count || !chars.length) continue;
      const music = style.fontFamily.split(',')[0].replace(/["']/g, '').trim() === 'Leipzig';
      const parts = [`q\n${cm(local)}\n${fill} rg`];
      let j = 0;
      for (let i = 0; i < count && j < chars.length; i++) {
        const char = chars[j];
        j += 1;
        if (char === ' ') continue;
        let at;
        try {
          at = leaf.getStartPositionOfChar(i);
        } catch {
          continue;
        }
        if (music || isMusicChar(char)) {
          const glyph = writer.glyphForm(char.codePointAt(0));
          if (!glyph) continue;
          const s = size / glyph.unitsPerEm;
          parts.push(`q\n${cm([s, 0, 0, -s, at.x, at.y])}\n/${glyph.name} Do\nQ`);
        } else {
          parts.push(`BT\n/${fontStyle(style)} ${num(size)} Tf\n1 0 0 -1 ${num(at.x)} ${num(at.y)} Tm\n${pdfString(char)} Tj\nET`);
        }
      }
      parts.push('Q');
      if (parts.length > 2) out.push(parts.join('\n'));
    }
  }

  function walk(el, m, viewport) {
    const style = styleOf(el);
    if (style.display === 'none') return;
    const name = el.localName;
    if (name === 'defs' || name === 'title' || name === 'desc' || name === 'symbol') return;
    if (name === 'svg') {
      const inner = el === svg ? { matrix: IDENTITY, viewport } : viewBoxMatrix(el, viewport);
      const local = multiply(m, inner.matrix);
      for (const child of el.children) walk(child, local, inner.viewport);
      return;
    }
    if (name === 'g') {
      const local = multiply(m, parseTransform(el.getAttribute('transform')));
      for (const child of el.children) walk(child, local, viewport);
      return;
    }
    if (style.visibility === 'hidden') return;
    if (name === 'text') {
      text(el, m);
      return;
    }
    if (name === 'use') {
      const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      if (!href.startsWith('#')) return;
      const form = glyphRef(href.slice(1));
      const fill = color(style.fill);
      if (!form || !fill) return;
      const x = Number.parseFloat(el.getAttribute('x')) || 0;
      const y = Number.parseFloat(el.getAttribute('y')) || 0;
      const local = multiply(multiply(m, parseTransform(el.getAttribute('transform'))), [1, 0, 0, 1, x, y]);
      out.push(`q\n${cm(local)}\n${fill} rg\n/${form} Do\nQ`);
      return;
    }
    const ops = shapeOps(el);
    if (!ops) return;
    out.push(`q\n${cm(multiply(m, parseTransform(el.getAttribute('transform'))))}`);
    paint(el, style, ops);
    out.push('Q');
  }

  const box = numbers(svg.getAttribute('viewBox'));
  if (box.length !== 4 || !box[2] || !box[3]) return { content: '', height: 0 };
  const crop = Array.isArray(target.crop) && target.crop.length === 2 && target.crop.every(Number.isFinite) ? target.crop : null;
  const scale = crop ? target.width / box[2] : Math.min(target.width / box[2], target.maxHeight / box[3]);
  const m = [scale, 0, 0, -scale, target.x - box[0] * scale, target.top + (crop ? crop[0] : box[1]) * scale];
  walk(svg, m, [box[2], box[3]]);
  return { content: out.join('\n'), height: (crop ? crop[1] - crop[0] : box[3]) * scale };
}

export function textLine(writer, value, { x, y, size, font = 'regular', align = 'left', width = 0 }) {
  const shown = String(value).replace(/[\u0000-\u001f]/g, '');
  const offset = align === 'right' ? -width : align === 'center' ? -width / 2 : 0;
  return `BT\n/${FONT_KEYS[font]} ${num(size)} Tf\n${num(x + offset)} ${num(y)} Td\n${pdfString(shown)} Tj\nET`;
}
