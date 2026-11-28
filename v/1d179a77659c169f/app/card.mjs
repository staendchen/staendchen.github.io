import { qrMatrix } from './qr.mjs';
import { loadVerovio, safeSvg } from './engrave.mjs';

export const CARD = { width: 1200, height: 630, scale: 2 };
export const CARD_EYEBROW = 'Pauls Ständchenmappe';
export const CARD_COLORS = {
  background: '#2f3632',
  spine: '#56605a',
  tab: '#c9d8bf',
  eyebrow: '#c3d4b8',
  title: '#f4efe4',
  music: '#6c766f',
  qrBox: '#ffffff',
  qrInk: '#000000',
};
export const SERIF = "Georgia, 'Times New Roman', serif";
export const SANS = "system-ui, -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const LEFT = 104;
const TITLE_WIDTH = 600;
const TITLE_TOP = 140;
const TITLE_BOTTOM = 392;
const LEADING = 1.06;
const SIZES = [96, 84, 72, 62, 54];
const STAFF = { left: 104, top: 440, height: 92 };
const QR = { x: 931, y: 384, size: 204, pad: 16, radius: 10 };
const MEASURES = 8;
const MINIMUM = 3;
const MUSIC_GAP = 14;
const DROP = ['g.label', 'g.labelAbbr', 'g.tempo', 'g.dir', 'g.dynam', 'g.harm', 'g.verse', 'g.fing', 'g.reh', 'g.pgHead', 'g.pgFoot', '.placeholder', 'text'];

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function wrap(words, width, fits) {
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && fits(`${last} ${word}`, width)) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

export function titleLayout(title, measure) {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { size: SIZES[0], lines: [], baselines: [] };
  for (const [index, size] of SIZES.entries()) {
    const fits = (text, width) => measure(text, size) <= width;
    const lines = wrap(words, TITLE_WIDTH, fits);
    const step = Math.round(size * LEADING);
    const first = TITLE_TOP + size;
    const bottom = first + step * (lines.length - 1) + size * 0.25;
    const last = index === SIZES.length - 1;
    if ((lines.every(line => fits(line, TITLE_WIDTH)) && bottom <= TITLE_BOTTOM) || last) {
      const widest = Math.max(...lines.map(line => measure(line, size)));
      const fitted = widest > TITLE_WIDTH ? Math.floor(size * TITLE_WIDTH / widest) : size;
      const fittedStep = Math.round(fitted * LEADING);
      const kept = lines.slice(0, Math.max(1, Math.floor((TITLE_BOTTOM - TITLE_TOP - fitted * 1.25) / fittedStep) + 1));
      return { size: fitted, lines: kept, baselines: kept.map((_, i) => TITLE_TOP + fitted + fittedStep * i) };
    }
  }
  return { size: SIZES[0], lines: [], baselines: [] };
}

export function qrPath(text, { x, y, size }) {
  const matrix = qrMatrix(text);
  const cell = size / matrix.size;
  let d = '';
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.dark[row * matrix.size + col]) continue;
      d += `M${(x + col * cell).toFixed(2)} ${(y + row * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return d;
}

export function cardSvg({ title, link, music = null, measure, colors = CARD_COLORS, eyebrow = CARD_EYEBROW }) {
  const { width, height } = CARD;
  const layout = titleLayout(title, measure);
  const titleText = layout.lines.map((line, i) => `<text x="${LEFT}" y="${layout.baselines[i]}">${escape(line)}</text>`).join('');
  const inner = QR.size - 2 * QR.pad;
  const ceiling = layout.lines.length ? layout.baselines.at(-1) + layout.size * 0.3 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="${colors.background}"/>`
    + `<path d="M44 0V${height}M58 0V${height}" stroke="${colors.spine}" stroke-width="2"/>`
    + `<path d="M1033 0h66v22a10 10 0 0 1-10 10h-46a10 10 0 0 1-10-10z" fill="${colors.tab}"/>`
    + `<text x="${LEFT}" y="104" font-family="${escape(SANS)}" font-size="30" fill="${colors.eyebrow}">${escape(eyebrow)}</text>`
    + `<g font-family="${escape(SERIF)}" font-size="${layout.size}" fill="${colors.title}">${titleText}</g>`
    + (music?.svg ? `<clipPath id="card-music"><rect x="0" y="${ceiling.toFixed(2)}" width="${music.end.toFixed(2)}" height="${(height - ceiling).toFixed(2)}"/></clipPath>`
      + `<g clip-path="url(#card-music)" color="${colors.music}" fill="${colors.music}" stroke="${colors.music}">${music.svg}</g>` : '')
    + `<rect x="${QR.x}" y="${QR.y}" width="${QR.size}" height="${QR.size}" rx="${QR.radius}" fill="${colors.qrBox}"/>`
    + `<path d="${qrPath(link, { x: QR.x + QR.pad, y: QR.y + QR.pad, size: inner })}" fill="${colors.qrInk}" shape-rendering="crispEdges"/>`
    + '</svg>';
}

export function firstMeasures(xml, count = MEASURES) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('musicxml not readable');
  for (const part of doc.querySelectorAll('part')) {
    [...part.querySelectorAll(':scope > measure')].slice(count).forEach(m => m.remove());
  }
  doc.querySelectorAll('credit, work, movement-title, identification').forEach(e => e.remove());
  return new XMLSerializer().serializeToString(doc);
}

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const HIGHEST = 58;
export const LOWEST = 41;

export function pitchRange(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let low = Infinity;
  let high = -Infinity;
  for (const pitch of doc.querySelectorAll('note > pitch')) {
    const step = STEPS[pitch.querySelector('step')?.textContent.trim()];
    const octave = Number(pitch.querySelector('octave')?.textContent);
    const alter = Number(pitch.querySelector('alter')?.textContent ?? 0) || 0;
    if (step === undefined || !Number.isInteger(octave)) continue;
    const midi = 12 * (octave + 1) + step + alter;
    low = Math.min(low, midi);
    high = Math.max(high, midi);
  }
  return { low, high };
}

export function fitShift(low, high, { lowest = LOWEST, highest = HIGHEST } = {}) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const up = Math.ceil((lowest - low) / 12);
  const down = Math.floor((highest - high) / 12);
  if (up > down) return null;
  return Math.min(down, Math.max(up, 0));
}

export function fitExcerpt(xml, { minimum = MINIMUM, maximum = MEASURES, ...limits } = {}) {
  for (let count = maximum; count >= minimum; count -= 1) {
    const { low, high } = pitchRange(firstMeasures(xml, count));
    const shift = fitShift(low, high, limits);
    if (shift !== null) return { measures: count, shift };
  }
  return null;
}

export async function cardMusic(xml, work, { measures = MEASURES } = {}) {
  const tk = await loadVerovio();
  tk.setOptions({
    scale: 40,
    breaks: 'none',
    header: 'none',
    footer: 'none',
    svgViewBox: true,
    adjustPageHeight: true,
    adjustPageWidth: true,
    pageHeight: 60000,
    pageMarginLeft: 0,
    pageMarginRight: 0,
    pageMarginTop: 0,
    pageMarginBottom: 0,
    spacingLinear: 0.2,
    spacingNonLinear: 0.5,
  });
  if (!tk.loadData(firstMeasures(xml, measures))) throw new Error('verovio cannot read the part');
  const svg = safeSvg(tk.renderToSVG(1));
  if (!svg) throw new Error('verovio rendered nothing');
  svg.querySelectorAll(DROP.join(',')).forEach(e => e.remove());
  const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box[2]) throw new Error('music has no size');
  svg.setAttribute('width', String(box[2]));
  svg.setAttribute('height', String(box[3]));
  work.replaceChildren(svg);
  const origin = svg.getBoundingClientRect();
  const lines = [...(svg.querySelector('g.staff')?.children ?? [])].filter(e => e.localName === 'path').slice(0, 5).map(e => e.getBoundingClientRect());
  work.replaceChildren();
  if (lines.length < 5 || !origin.width) throw new Error('music has no staff');
  const k = box[2] / origin.width;
  const left = (Math.min(...lines.map(r => r.left)) - origin.left) * k;
  const top = (Math.min(...lines.map(r => r.top + r.height / 2)) - origin.top) * k;
  const bottom = (Math.max(...lines.map(r => r.top + r.height / 2)) - origin.top) * k;
  if (!(bottom > top)) throw new Error('music has no staff');
  const s = STAFF.height / (bottom - top);
  svg.setAttribute('x', (STAFF.left - left * s).toFixed(2));
  svg.setAttribute('y', (STAFF.top - top * s).toFixed(2));
  svg.setAttribute('width', (box[2] * s).toFixed(2));
  svg.setAttribute('height', (box[3] * s).toFixed(2));
  svg.removeAttribute('color');
  return { svg: new XMLSerializer().serializeToString(svg), end: QR.x - MUSIC_GAP };
}

export function textMeasure(font = SERIF) {
  const context = document.createElement('canvas').getContext('2d');
  return (text, size) => {
    context.font = `${size}px ${font}`;
    return context.measureText(text).width;
  };
}

export async function cardPng(svg, { scale = CARD.scale } = {}) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = CARD.width * scale;
    canvas.height = CARD.height * scale;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('card not drawn');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
