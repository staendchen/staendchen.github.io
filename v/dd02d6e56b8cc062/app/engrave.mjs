import { engraveScale, systemShifts } from './layout.mjs';
import { splitSections, mergeTimemaps } from './sections.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const ELEMENTS = new Set(['svg', 'g', 'defs', 'symbol', 'use', 'path', 'polyline', 'polygon', 'rect', 'line', 'ellipse', 'circle', 'text', 'tspan', 'title', 'desc']);
const ATTRIBUTES = new Set([
  'viewBox', 'version', 'overflow', 'id', 'transform', 'd', 'class', 'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'text-anchor', 'dominant-baseline', 'cx', 'cy', 'rx', 'ry', 'r', 'points', 'fill', 'fill-opacity', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'preserveAspectRatio', 'dx', 'dy',
]);
const REFERENCE = /^#[A-Za-z0-9_.-]{1,200}$/;
const UNSAFE_VALUE = /url\s*\(|javascript:|expression\s*\(|\\/i;
const PREFIX = 'vrv-';
let toolkit = null;
let loading = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('verovio not loaded'));
    document.head.append(script);
  });
}

export function loadVerovio() {
  loading ||= (async () => {
    await loadScript(new URL('./verovio-toolkit-wasm.js', import.meta.url).href);
    const module = globalThis.verovio?.module;
    if (!module) throw new Error('verovio missing');
    if (!module.calledRun) await new Promise(resolve => { module.onRuntimeInitialized = resolve; });
    toolkit = new globalThis.verovio.toolkit();
    return toolkit;
  })().catch(error => {
    loading = null;
    throw error;
  });
  return loading;
}

function keepAttribute(attribute) {
  if (attribute.namespaceURI === XLINK_NS || (!attribute.namespaceURI && attribute.localName === 'href')) {
    return attribute.localName === 'href' && REFERENCE.test(attribute.value);
  }
  if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') return true;
  return !attribute.namespaceURI && ATTRIBUTES.has(attribute.localName) && attribute.value.length <= 100000 && !UNSAFE_VALUE.test(attribute.value);
}

function clean(element) {
  for (const attribute of [...element.attributes]) {
    if (!keepAttribute(attribute)) {
      element.removeAttributeNode(attribute);
      continue;
    }
    if (attribute.localName === 'id') attribute.value = PREFIX + attribute.value;
    if (attribute.localName === 'href') attribute.value = `#${PREFIX}${attribute.value.slice(1)}`;
  }
  for (const child of [...element.children]) {
    if (child.namespaceURI !== SVG_NS || !ELEMENTS.has(child.localName)) child.remove();
    else clean(child);
  }
}

export function safeSvg(markup) {
  const parsed = new DOMParser().parseFromString(markup.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ''), 'image/svg+xml');
  const svg = parsed.documentElement;
  if (!svg || svg.namespaceURI !== SVG_NS || svg.localName !== 'svg' || parsed.querySelector('parsererror')) return null;
  clean(svg);
  return document.importNode(svg, true);
}

export async function engrave(container, xml, { width, format, scale: forced, zoom = 1 }) {
  const tk = await loadVerovio();
  const scale = forced ?? engraveScale(width, format);
  tk.setOptions({
    scale,
    pageWidth: Math.round(width * 100 / scale / Math.max(1, zoom)),
    pageHeight: 60000,
    adjustPageHeight: true,
    breaks: 'auto',
    header: 'none',
    footer: 'none',
    svgViewBox: true,
    pageMarginLeft: 20,
    pageMarginRight: 20,
    pageMarginTop: 20,
    pageMarginBottom: 20,
    spacingSystem: 0,
    spacingStaff: 0,
    defaultTopMargin: 0,
    defaultBottomMargin: 0,
    spacingLinear: 0.2,
    spacingNonLinear: 0.55,
    expandNever: true,
  });
  let sections;
  try {
    sections = splitSections(xml);
  } catch {
    sections = [xml];
  }
  const nodes = [];
  const starts = new Set();
  const maps = [];
  for (const section of sections) {
    if (!tk.loadData(section)) throw new Error('verovio cannot read the part');
    if (nodes.length) starts.add(nodes.length);
    for (let i = 1; i <= tk.getPageCount(); i++) {
      const svg = safeSvg(tk.renderToSVG(i));
      if (svg) nodes.push(svg);
    }
    try {
      maps.push(tk.renderToTimemap({ includeMeasures: true, includeRests: true }));
    } catch {
      maps.push(null);
    }
  }
  if (!nodes.length) throw new Error('verovio rendered nothing');
  const timemap = maps.length === 1 ? maps[0] : mergeTimemaps(maps);
  container.replaceChildren(...nodes.map((svg, i) => {
    const page = document.createElement('div');
    page.className = starts.has(i) ? 'page section' : 'page';
    page.append(svg);
    return page;
  }));
  const measured = nodes.map(measure);
  measured.timemap = timemap;
  return measured;
}

export async function renderPages(xml, { pageWidth, pageHeight, adjust = false, spacingSystem = 12 }) {
  const tk = await loadVerovio();
  tk.setOptions({
    scale: 100,
    pageWidth: Math.round(pageWidth),
    pageHeight: Math.round(pageHeight),
    adjustPageHeight: adjust,
    breaks: 'auto',
    header: 'none',
    footer: 'none',
    svgViewBox: true,
    pageMarginLeft: 0,
    pageMarginRight: 0,
    pageMarginTop: 0,
    pageMarginBottom: 0,
    spacingSystem,
    spacingStaff: 12,
    spacingLinear: 0.25,
    spacingNonLinear: 0.6,
    expandNever: true,
  });
  if (!tk.loadData(xml)) throw new Error('verovio cannot read the piece');
  const pages = [];
  for (let i = 1; i <= tk.getPageCount(); i++) {
    const svg = safeSvg(tk.renderToSVG(i));
    if (svg) pages.push(svg);
  }
  if (!pages.length) throw new Error('verovio rendered nothing');
  return pages;
}

function staffStep(system) {
  const ys = [...system.querySelectorAll('g.staff > path')]
    .map(p => Number(((p.getAttribute('d') || '').match(/^M\s*[-\d.]+[ ,]([-\d.]+)/) || [])[1]))
    .filter(y => Number.isFinite(y));
  return ys.length > 1 ? Math.abs(ys[1] - ys[0]) : 0;
}

function skyline(g, origin, k, sp, buckets) {
  const top = new Array(buckets).fill(Infinity);
  const bottom = new Array(buckets).fill(-Infinity);
  let staffTop = Infinity;
  let staffBottom = -Infinity;
  let inkBottom = -Infinity;
  for (const e of g.querySelectorAll('use, path, polyline, polygon, rect, text, ellipse, circle, line')) {
    if (e.closest('.placeholder')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const x0 = (r.left - origin.left) * k;
    const x1 = (r.right - origin.left) * k;
    const y0 = (r.top - origin.top) * k;
    const y1 = (r.bottom - origin.top) * k;
    if (e.parentNode.matches('g.staff') && e.localName === 'path' && r.height * k < sp / 2) {
      staffTop = Math.min(staffTop, y0);
      staffBottom = Math.max(staffBottom, y1);
    }
    inkBottom = Math.max(inkBottom, y1);
    for (let b = Math.max(0, Math.floor(x0 / sp)); b <= Math.min(buckets - 1, Math.floor(x1 / sp)); b++) {
      top[b] = Math.min(top[b], y0);
      bottom[b] = Math.max(bottom[b], y1);
    }
  }
  if (staffTop === Infinity) {
    staffTop = Math.min(...top.filter(Number.isFinite), 0);
    staffBottom = Math.max(...bottom.filter(Number.isFinite), staffTop);
  }
  return { top, bottom, staffTop, staffBottom, inkBottom: Math.max(inkBottom, staffBottom) };
}

export function measure(outer) {
  const inner = outer.querySelector('svg') || outer;
  const groups = [...outer.querySelectorAll('g.system')];
  const box = (inner.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const outerBox = (outer.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const origin = outer.getBoundingClientRect();
  const innerHeight = inner !== outer && inner.getAttribute('height') ? Number.parseFloat(inner.getAttribute('height')) : null;
  if (!groups.length || box.length !== 4 || !origin.width) return { outer, inner, groups: [], box, outerBox, innerHeight, systems: [], spatium: 0 };
  const k = box[2] / origin.width;
  const spatium = staffStep(groups[0]) || box[2] / 100;
  const buckets = Math.ceil(box[2] / spatium) + 1;
  const systems = groups.map(g => skyline(g, origin, k, spatium, buckets));
  return { outer, inner, groups, box, outerBox, innerHeight, systems, spatium };
}

export function space(measured, spacing) {
  for (const m of measured) {
    if (!m.groups.length) continue;
    const { shifts, height } = systemShifts(m.systems, m.spatium, spacing);
    m.groups.forEach((g, i) => (shifts[i] ? g.setAttribute('transform', `translate(0 ${shifts[i]})`) : g.removeAttribute('transform')));
    const [x, y, w, h] = m.box;
    m.inner.setAttribute('viewBox', `${x} ${y} ${w} ${height}`);
    if (m.outer !== m.inner && m.outerBox.length === 4) {
      const [ox, oy, ow, oh] = m.outerBox;
      m.outer.setAttribute('viewBox', `${ox} ${oy} ${ow} ${oh * height / h}`);
      m.outer.style.aspectRatio = `${ow} / ${oh * height / h}`;
    }
    if (Number.isFinite(m.innerHeight)) m.inner.setAttribute('height', String(m.innerHeight * height / h));
    m.outer.removeAttribute('height');
    m.outer.removeAttribute('width');
  }
}
