import { parse, serialize, root, children, child, text, attribute } from '../lib/musicxml.mjs';

const ORDER = ['footnote', 'level', 'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part', 'directive', 'measure-style'];
const CARRY = new Set(['divisions', 'key', 'time', 'staves', 'clef', 'staff-details', 'transpose']);
const MAX_SECTIONS = 20;

function rightBarline(measure) {
  for (const barline of children(measure, 'barline')) {
    if ((attribute(barline, 'location') ?? 'right') !== 'right') continue;
    return {
      style: text(child(barline, 'bar-style'))?.trim() ?? null,
      backward: children(barline, 'repeat').some(repeat => attribute(repeat, 'direction') === 'backward'),
    };
  }
  return { style: null, backward: false };
}

const changesKey = measure => children(measure, 'attributes').some(node => child(node, 'key'));

export function sectionStarts(measures) {
  const starts = [];
  for (let i = 1; i < measures.length && starts.length < MAX_SECTIONS - 1; i++) {
    const { style, backward } = rightBarline(measures[i - 1]);
    const key = changesKey(measures[i]);
    if ((style === 'light-heavy' && (!backward || key)) || (style === 'light-light' && key)) starts.push(i);
  }
  return starts;
}

const slot = node => `${node.name}|${attribute(node, 'number') ?? ''}`;

function carried(measures) {
  const state = new Map();
  for (const measure of measures) {
    for (const attributes of children(measure, 'attributes')) {
      for (const node of children(attributes)) if (CARRY.has(node.name)) state.set(slot(node), node);
    }
  }
  return state;
}

function applyState(measure, state) {
  let attributes = children(measure, 'attributes')[0];
  if (!attributes) {
    attributes = { type: 'element', name: 'attributes', attributes: [], children: [] };
    const prints = children(measure, 'print');
    const at = prints.length ? measure.children.indexOf(prints[prints.length - 1]) + 1 : 0;
    measure.children.splice(at, 0, attributes);
  }
  const present = new Set(children(attributes).map(slot));
  const nodes = children(attributes);
  for (const [key, node] of state) if (!present.has(key)) nodes.push(structuredClone(node));
  const rank = name => {
    const i = ORDER.indexOf(name);
    return i < 0 ? ORDER.length : i;
  };
  attributes.children = nodes.map((node, i) => [node, i]).sort((a, b) => rank(a[0].name) - rank(b[0].name) || a[1] - b[1]).map(([node]) => node);
}

export function splitSections(xml) {
  const document = parse(xml);
  const parts = children(root(document), 'part');
  if (!parts.length) return [xml];
  const first = children(parts[0], 'measure');
  if (parts.some(part => children(part, 'measure').length !== first.length)) return [xml];
  const starts = sectionStarts(first);
  if (!starts.length) return [xml];
  const bounds = [0, ...starts, first.length];
  const sections = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const copy = structuredClone(document);
    for (const part of children(root(copy), 'part')) {
      const measures = children(part, 'measure');
      const keep = new Set(measures.slice(bounds[s], bounds[s + 1]));
      if (s > 0) applyState(measures[bounds[s]], carried(measures.slice(0, bounds[s])));
      part.children = part.children.filter(node => node.type !== 'element' || node.name !== 'measure' || keep.has(node));
    }
    sections.push(serialize(copy));
  }
  return sections;
}

export function mergeTimemaps(maps) {
  const merged = [];
  let quarters = 0;
  let millis = 0;
  for (const map of maps) {
    if (!Array.isArray(map)) return null;
    let endQ = 0;
    let endT = 0;
    for (const entry of map) {
      if (entry === null || typeof entry !== 'object') continue;
      const q = Number.isFinite(entry.qstamp) ? entry.qstamp : 0;
      const t = Number.isFinite(entry.tstamp) ? entry.tstamp : 0;
      endQ = Math.max(endQ, q);
      endT = Math.max(endT, t);
      merged.push({ ...entry, qstamp: q + quarters, tstamp: t + millis });
    }
    quarters += endQ;
    millis += endT;
  }
  return merged;
}
