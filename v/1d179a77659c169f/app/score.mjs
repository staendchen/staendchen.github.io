import { parse, root, child, children, text } from '../lib/musicxml.mjs';
import { parsePartName } from '../lib/rewrite.mjs';

export const PRESETS = [['all', 'Alle'], ['brass', 'Blech'], ['melody', 'Melodie und Bass']];
const RANK = { '1.': 1, '2.': 2, '3.': 3, '4.': 4, Bass: 5, Melodie: 0 };

export function scoreParts(xml) {
  const score = root(parse(xml));
  const list = child(score, 'part-list');
  if (!list) return [];
  return children(list, 'score-part').map(part => {
    const name = text(child(part, 'part-name'))?.trim() ?? '';
    const parsed = parsePartName(name);
    const sounds = children(part, 'score-instrument').map(i => text(child(i, 'instrument-sound'))?.trim() ?? '');
    return { name, number: parsed?.number ?? null, notation: parsed?.notation ?? null, brass: sounds.some(sound => sound.startsWith('brass.')) };
  }).filter(part => part.name);
}

function bassOf(parts) {
  const bass = parts.filter(p => p.number === 'Bass');
  if (bass.length) return bass;
  const ranked = parts.filter(p => p.number && p.number !== 'Melodie');
  const low = ranked.filter(p => p.notation === 'C Bass');
  const pool = low.length ? low : ranked;
  if (!pool.length) return parts.slice(-1);
  const deepest = Math.max(...pool.map(p => RANK[p.number]));
  return pool.filter(p => RANK[p.number] === deepest).slice(-1);
}

export function presetParts(parts, preset) {
  if (preset === 'brass') {
    const brass = parts.filter(p => p.brass).map(p => p.name);
    return brass.length ? brass : null;
  }
  if (preset === 'melody') {
    const melody = parts.find(p => p.number === 'Melodie') ?? parts.find(p => p.number === '1.') ?? parts[0];
    if (!melody) return null;
    const names = [melody.name, ...bassOf(parts).map(p => p.name)];
    return parts.map(p => p.name).filter(name => names.includes(name));
  }
  return parts.map(p => p.name);
}

export function chosenParts(parts, preset, custom) {
  if (Array.isArray(custom)) {
    const names = parts.map(p => p.name).filter(name => custom.includes(name));
    if (names.length) return names;
  }
  return presetParts(parts, preset) ?? parts.map(p => p.name);
}

export function matchingPreset(parts, names) {
  for (const [preset] of PRESETS) {
    const wanted = presetParts(parts, preset);
    if (wanted && wanted.length === names.length && wanted.every(name => names.includes(name))) return preset;
  }
  return null;
}
