import { A4, PdfWriter, drawSvg, textLine, num, fine } from './pdf.mjs';
import { renderPages, measure as measureSvg } from './engrave.mjs';
import { systemShifts } from './layout.mjs';
import { beatSign } from './follow.mjs';

export const A5_LANDSCAPE = { width: 595.28, height: 419.53 };
export const FORMATS = {
  part: { page: A5_LANDSCAPE, side: 34, top: 16, bottom: 22, header: 28, gap: 22, tight: true, spacing: 4, shrink: [1.12, 1.25], staff: 16 },
  score: { page: A4, side: 34, top: 26, bottom: 30, header: 32, gap: 0, pack: false, spacing: 12, shrink: [], staff: 18 },
};
const TOC = { heading: 18, size: 10.5, column: 28 };

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function musicFonts() {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.load) return;
  await Promise.all([fonts.load('20px "Leipzig"', '\uE260'), fonts.load('20px "Leipzig PUA"', '\uE260')]).catch(() => {});
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function composerOf(xml) {
  const match = /<creator\b[^>]*\btype="composer"[^>]*>([^<]{1,200})<\/creator>/.exec(typeof xml === 'string' ? xml : '');
  if (!match) return '';
  return match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]).replace(/\s+/g, ' ').trim();
}

export function pageUnit(width, parts = 1, shrink = 1, staff = 18) {
  return 72 * width / staff * Math.min(1.8, 1 + Math.max(0, parts - 3) * 0.12) * shrink;
}

export function tocLayout(count, format) {
  const { page, side, top, bottom } = format;
  const width = page.width - 2 * side;
  const row = page.height < 500 ? 14.5 : 15;
  const first = page.height - top - 48;
  const rows = Math.max(1, Math.floor((first - bottom) / row) + 1);
  const columnWidth = (width - TOC.column) / 2;
  const perPage = rows * 2;
  return { pages: Math.max(1, Math.ceil(count / perPage)), rows, perPage, row, first, columnWidth, width };
}

function fit(measure, text, size, font, max) {
  if (measure(text, size, font) <= max) return text;
  let cut = text;
  while (cut.length > 1 && measure(`${cut}…`, size, font) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function tocPages(writer, entries, { name, label, format, measure, offset }) {
  const layout = tocLayout(entries.length, format);
  const { page, side, top } = format;
  for (let p = 0; p < layout.pages; p++) {
    const parts = ['0 0 0 rg'];
    const links = [];
    const heading = p ? `${name}  ${label} (${p + 1})` : `${name}  ${label}`;
    parts.push(textLine(writer, fit(measure, heading, TOC.heading, 'sans', layout.width), { x: side, y: page.height - top - TOC.heading, size: TOC.heading, font: 'sans' }));
    entries.slice(p * layout.perPage, (p + 1) * layout.perPage).forEach((entry, i) => {
      const column = Math.floor(i / layout.rows);
      const x = side + column * (layout.columnWidth + TOC.column);
      const y = layout.first - (i % layout.rows) * layout.row;
      const number = String(entry.number);
      const pageText = String(entry.page + offset + 1);
      parts.push(textLine(writer, number, { x: x + 16, y, size: TOC.size, font: 'sans', align: 'right', width: measure(number, TOC.size, 'sans') }));
      const room = layout.columnWidth - 24 - measure(pageText, TOC.size, 'sans') - 8;
      parts.push(textLine(writer, fit(measure, entry.title, TOC.size, 'sans', room), { x: x + 24, y, size: TOC.size, font: 'sans' }));
      parts.push(`0.4 g\n${textLine(writer, pageText, { x: x + layout.columnWidth, y, size: TOC.size, font: 'sans', align: 'right', width: measure(pageText, TOC.size, 'sans') })}\n0 g`);
      links.push({ rect: [x, y - 3, x + layout.columnWidth, y + layout.row - 3], index: entry.page });
    });
    writer.addPage(parts.join('\n'), { width: page.width, height: page.height, front: true, links });
  }
  return layout.pages;
}

function finish(writer, entries, { name, label, format, measure, contents }) {
  const { page, bottom } = format;
  const offset = contents ? tocPages(writer, entries, { name, label, format, measure, offset: tocLayout(entries.length, format).pages }) : 0;
  writer.pages.forEach((_, i) => {
    const text = String(offset + i + 1);
    writer.appendTo(i, `0 0 0 rg\n${textLine(writer, text, { x: page.width / 2, y: bottom / 2 - 2, size: 8.5, align: 'center', width: measure(text, 8.5, 'regular') })}`);
  });
}

function tempoMark(writer, tempo, { x, y }) {
  if (!tempo) return '';
  const sign = beatSign(tempo.beat);
  const parts = [];
  let at = x;
  for (const char of sign.glyphs) {
    const glyph = writer.glyphForm(char.codePointAt(0));
    if (!glyph) return textLine(writer, `${sign.words} = ${tempo.bpm}`, { x, y, size: 9, font: 'bold' });
    const size = 14;
    const s = size / glyph.unitsPerEm;
    parts.push(`q\n${fine(s)} 0 0 ${fine(s)} ${num(at)} ${num(y)} cm\n/${glyph.name} Do\nQ`);
    at += glyph.advance * s + 1;
  }
  parts.push(textLine(writer, ` = ${tempo.bpm}`, { x: at, y, size: 9.5, font: 'bold' }));
  return parts.join('\n');
}

function pieceHeader(writer, { number, title, label, composer, tempo, more, showLabel }, { x, top, width, measure }) {
  const shownTitle = fit(measure, more ? `${title} (${more})` : title, 17, 'regular', width - 160);
  const numberText = String(number);
  const parts = [
    showLabel ? textLine(writer, fit(measure, label, 9, 'regular', 120), { x, y: top - 11, size: 9 }) : '',
    textLine(writer, shownTitle, { x: x + width / 2, y: top - 14, size: 17, align: 'center', width: measure(shownTitle, 17, 'regular') }),
    textLine(writer, numberText, { x: x + width, y: top - 13, size: 15, align: 'right', width: measure(numberText, 15, 'regular') }),
  ];
  if (composer) {
    const shown = fit(measure, composer, 8.5, 'regular', 200);
    parts.push(textLine(writer, shown, { x: x + width, y: top - 23, size: 8.5, align: 'right', width: measure(shown, 8.5, 'regular') }));
  }
  if (tempo && !more) parts.push(tempoMark(writer, tempo, { x: x + 2, y: top - 23 }));
  return parts.join('\n');
}

export async function binderPdf({ kind = 'part', name, label, pieces, first = 1, contents = true, piecePart, glyphs, textWidth, work, reason = () => 'lässt sich nicht setzen', progress = () => {}, cancelled = () => false }) {
  const format = FORMATS[kind] ?? FORMATS.part;
  const { page, side, top, bottom, header, gap } = format;
  const measure = (text, size, font) => textWidth(text, size, font);
  const writer = new PdfWriter({ title: `${name} ${label}`, glyphs });
  await musicFonts();
  if (format.tight) {
    const book = await tightBook({ format, label, pieces, first, piecePart, writer, measure, work, reason, progress, cancelled });
    if (!book || cancelled()) return null;
    if (!writer.pages.length) return { blob: null, pages: 0, failed: book.failed };
    finish(writer, book.entries, { name, label, format, measure, contents });
    return { blob: await writer.build(), pages: writer.front.length + writer.pages.length, failed: book.failed };
  }
  const width = page.width - 2 * side;
  const capacity = page.height - top - bottom;
  const failed = [];
  const entries = [];
  let current = -1;
  let used = 0;
  let pending = null;
  const flush = () => {
    if (pending) writer.addPage(pending.join('\n'), { width: page.width, height: page.height });
    pending = null;
  };
  for (const [index, piece] of pieces.entries()) {
    if (cancelled()) return null;
    progress(index, piece);
    await tick();
    try {
      const part = await piecePart(index);
      const music = capacity - header;
      let svgs = null;
      for (const shrink of [1, ...format.shrink]) {
        const unit = pageUnit(width, part.parts, shrink, format.staff);
        const rendered = await renderPages(part.xml, { pageWidth: unit, pageHeight: unit * music / width, adjust: true, spacingSystem: format.spacing });
        if (!svgs || rendered.length < svgs.length) svgs = rendered;
        if (svgs.length === 1 || svgs.length > 2) break;
      }
      work.replaceChildren(...svgs);
      const blocks = svgs.map((svg, i) => {
        const box = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
        const height = box.length === 4 && box[2] > 0 ? Math.min(music, box[3] * width / box[2]) : music;
        return { svg, size: header + height, first: i === 0 };
      });
      const placed = [];
      for (const block of blocks) {
        if (current < 0 || !format.pack || !block.first || used + gap + block.size > capacity) {
          flush();
          current += 1;
          used = 0;
          pending = ['0 0 0 rg'];
        } else used += gap;
        placed.push({ block, page: current, top: page.height - top - used, opens: used === 0 });
        used += block.size;
      }
      placed.forEach(({ block, page: at, top: blockTop, opens }, i) => {
        const head = pieceHeader(writer, { number: first + index, title: piece.title, label: part.label, composer: part.composer, tempo: part.tempo, more: i ? i + 1 : 0, showLabel: opens }, { x: side, top: blockTop, width, measure });
        const drawn = drawSvg(writer, block.svg, { x: side, top: blockTop - header, width, maxHeight: music });
        pending.push(head, drawn.content);
        if (!i) {
          entries.push({ number: first + index, title: piece.title, page: at });
          writer.bookmark(`${first + index}  ${piece.title}`, at, blockTop);
        }
        if (i < placed.length - 1) {
          flush();
          pending = ['0 0 0 rg'];
        }
      });
    } catch (error) {
      failed.push({ number: first + index, title: piece.title, reason: reason(error) });
    } finally {
      work.replaceChildren();
    }
  }
  flush();
  if (cancelled()) return null;
  if (!writer.pages.length) return { blob: null, pages: 0, failed };
  finish(writer, entries, { name, label, format, measure, contents });
  return { blob: await writer.build(), pages: writer.front.length + writer.pages.length, failed };
}

export function planSong(systems, { title, used, capacity, gap }) {
  const n = systems.length;
  const span = (a, b, titled) => (titled ? title : 0) + systems[b].bottom - systems[a].top;
  const chunks = [];
  let newPage = used <= 0;
  let free = newPage ? capacity : capacity - used - gap;
  const whole = span(0, n - 1, true);
  if (!newPage && whole > free && whole <= capacity) {
    newPage = true;
    free = capacity;
  }
  let start = 0;
  while (start < n) {
    const titled = start === 0;
    let end = start - 1;
    while (end + 1 < n && span(start, end + 1, titled) <= free) end += 1;
    if (end < n - 1 && end - start < 1) {
      if (!newPage) {
        newPage = true;
        free = capacity;
        continue;
      }
      end = Math.max(end, start);
    }
    if (end === n - 2 && end - start >= 2) end -= 1;
    chunks.push({ from: start, to: end, newPage, titled, height: span(start, end, titled) });
    start = end + 1;
    newPage = true;
    free = capacity;
  }
  return chunks;
}

async function tightSong(xml, parts, shrink, { format, width, work }) {
  const unit = pageUnit(width, parts, shrink, format.staff);
  const [svg] = await renderPages(xml, { pageWidth: unit, pageHeight: 60000, adjust: true, spacingSystem: 12 });
  work.replaceChildren(svg);
  const measured = measureSvg(svg);
  if (!measured.groups.length || measured.box.length !== 4 || !measured.box[2]) throw new Error('no systems');
  const { shifts } = systemShifts(measured.systems, measured.spatium, format.spacing);
  measured.groups.forEach((g, i) => (shifts[i] ? g.setAttribute('transform', `translate(0 ${shifts[i]})`) : g.removeAttribute('transform')));
  const perInner = width / measured.box[2];
  const outer = measured.outerBox.length === 4 && measured.outerBox[2] ? measured.outerBox[2] / measured.box[2] : 1;
  const extents = measured.systems.map((system, i) => ({
    top: Math.min(system.staffTop, ...system.top.filter(Number.isFinite)) + shifts[i],
    bottom: system.inkBottom + shifts[i],
  }));
  return {
    svg,
    groups: measured.groups,
    systems: extents.map(e => ({ top: e.top * perInner, bottom: e.bottom * perInner })),
    crop: (from, to) => [extents[from].top * outer, extents[to].bottom * outer],
  };
}

async function tightBook({ format, label, pieces, first, piecePart, writer, measure, work, reason, progress, cancelled }) {
  const { page, side, top, bottom, header, gap } = format;
  const width = page.width - 2 * side;
  const capacity = page.height - top - bottom;
  const failed = [];
  const entries = [];
  let current = -1;
  let used = 0;
  let pending = null;
  const flush = () => {
    if (pending) writer.addPage(pending.join('\n'), { width: page.width, height: page.height });
    pending = null;
  };
  const open = () => {
    flush();
    current += 1;
    used = 0;
    pending = ['0 0 0 rg', textLine(writer, fit(measure, label, 9, 'regular', 120), { x: side, y: page.height - top - 11, size: 9 })];
  };
  for (const [index, piece] of pieces.entries()) {
    if (cancelled()) return null;
    progress(index, piece);
    await tick();
    try {
      const part = await piecePart(index);
      const options = { format, width, work };
      let song = await tightSong(part.xml, part.parts, 1, options);
      const tall = s => header + s.systems.at(-1).bottom - s.systems[0].top > capacity;
      if (tall(song)) {
        for (const shrink of format.shrink) {
          const smaller = await tightSong(part.xml, part.parts, shrink, options);
          if (!tall(smaller)) {
            song = smaller;
            break;
          }
        }
        if (tall(song)) song = await tightSong(part.xml, part.parts, 1, options);
      }
      const chunks = planSong(song.systems, { title: header, used: current < 0 ? 0 : used, capacity, gap });
      for (const chunk of chunks) {
        if (chunk.newPage || current < 0) open();
        else used += gap;
        const blockTop = page.height - top - used;
        let musicTop = blockTop;
        if (chunk.titled) {
          pending.push(pieceHeader(writer, { number: first + index, title: piece.title, label, composer: part.composer, tempo: part.tempo, more: 0, showLabel: false }, { x: side, top: blockTop, width, measure }));
          musicTop = blockTop - header;
          entries.push({ number: first + index, title: piece.title, page: current });
          writer.bookmark(`${first + index}  ${piece.title}`, current, blockTop);
        }
        song.groups.forEach((g, i) => {
          g.style.display = i >= chunk.from && i <= chunk.to ? '' : 'none';
        });
        pending.push(drawSvg(writer, song.svg, { x: side, top: musicTop, width, maxHeight: capacity, crop: song.crop(chunk.from, chunk.to) }).content);
        used += chunk.height;
      }
    } catch (error) {
      failed.push({ number: first + index, title: piece.title, reason: reason(error) });
    } finally {
      work.replaceChildren();
    }
  }
  flush();
  return { entries, failed };
}
