import {
  MusicXmlError, attribute, child, children, descendants, element, insertAfter, keepChildren, parse, remove, root, serialize, setAttribute, setText, text, textNode,
} from './musicxml.mjs';

export { MusicXmlError };

export const NOTATIONS = ['C', 'B', 'Es', 'F', 'C Bass'];
export const NUMBERS = ['1.', '2.', '3.', '4.', 'Bass', 'Melodie'];

const RANK = { '1.': 1, '2.': 2, '3.': 3, '4.': 4, Bass: 5, Melodie: 1 };
const CLEFS = {
  G: { sign: 'G', line: 2, octave: 0, middle: 71 },
  G8vb: { sign: 'G', line: 2, octave: -1, middle: 59 },
  F: { sign: 'F', line: 4, octave: 0, middle: 50 },
};
const OPTIONS = {
  C: [{ clef: 'G', diatonic: 0, chromatic: 0 }],
  B: [{ clef: 'G', diatonic: -1, chromatic: -2 }, { clef: 'G', diatonic: -8, chromatic: -14 }],
  Es: [{ clef: 'G', diatonic: -5, chromatic: -9 }, { clef: 'G', diatonic: -12, chromatic: -21 }],
  F: [{ clef: 'G', diatonic: -4, chromatic: -7 }, { clef: 'G', diatonic: -11, chromatic: -19 }],
  'C Bass': [{ clef: 'F', diatonic: 0, chromatic: 0 }],
};
const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const ACCIDENTALS = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const PLAIN_ACCIDENTALS = new Set(['flat-flat', 'flat', 'natural', 'sharp', 'double-sharp', 'sharp-sharp', 'natural-sharp', 'natural-flat']);
const ATTRIBUTE_ORDER = ['footnote', 'level', 'divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part', 'directive', 'measure-style'];
const BEFORE_ACCIDENTAL = new Set(['grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot']);
const MAX_PARTS = 64;
const MICRO_ACCIDENTALS = { '-1.5': 'three-quarters-flat', '-0.5': 'quarter-flat', 0.5: 'quarter-sharp', 1.5: 'three-quarters-sharp' };
const NAME = /^(1\.|2\.|3\.|4\.|Bass|Melodie) (C|B|Es|F|C Bass)$/;

const mod = (a, n) => ((a % n) + n) % n;

export function parsePartName(name) {
  const match = typeof name === 'string' ? NAME.exec(name.trim()) : null;
  return match ? { number: match[1], notation: match[2] } : null;
}

function integer(node, fallback = 0) {
  const value = text(node);
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (!/^[+-]?\d{1,6}$/.test(trimmed)) throw new MusicXmlError(`not an integer: ${trimmed.slice(0, 20)}`);
  return Number(trimmed);
}

function decimal(node) {
  const value = text(node);
  if (value === undefined) return 0;
  const trimmed = value.trim();
  if (!/^[+-]?\d{1,2}(\.\d{1,4})?$/.test(trimmed)) throw new MusicXmlError(`not a number: ${trimmed.slice(0, 20)}`);
  return Number(trimmed);
}

function readTranspose(node) {
  const octave = integer(child(node, 'octave-change'));
  return { diatonic: integer(child(node, 'diatonic')) + 7 * octave, chromatic: integer(child(node, 'chromatic')) + 12 * octave };
}

function readPitch(pitch) {
  const step = STEPS.indexOf(text(child(pitch, 'step'))?.trim());
  if (step === -1) throw new MusicXmlError('invalid step');
  const octave = integer(child(pitch, 'octave'), NaN);
  if (!(octave >= 0 && octave <= 9)) throw new MusicXmlError('invalid octave');
  const alter = decimal(child(pitch, 'alter'));
  const whole = Math.round(alter);
  return { step, octave, alter: whole, micro: alter - whole };
}

const midiOf = (p) => 12 * (p.octave + 1) + SEMITONES[p.step] + p.alter;

function shiftPitch(p, diatonic, chromatic) {
  const number = p.octave * 7 + p.step + diatonic;
  const step = mod(number, 7);
  const octave = Math.floor(number / 7);
  const midi = midiOf(p) + chromatic;
  return { step, octave, alter: midi - (12 * (octave + 1) + SEMITONES[step]), micro: p.micro };
}

function respell(p) {
  let current = p;
  while (current.alter > 2) current = shiftPitch(current, 1, 0);
  while (current.alter < -2) current = shiftPitch(current, -1, 0);
  return current;
}

function writePitch(pitch, p) {
  setText(child(pitch, 'step'), STEPS[p.step]);
  setText(child(pitch, 'octave'), String(p.octave));
  const value = p.alter + p.micro;
  const alter = child(pitch, 'alter');
  if (value === 0) {
    if (alter) remove(pitch, alter);
  } else if (alter) {
    setText(alter, String(value));
  } else {
    insertAfter(pitch, element('alter', [textNode(String(value))]), child(pitch, 'step'));
  }
}

function keyAlter(fifths, step) {
  if (fifths > 0 && SHARP_ORDER.indexOf(step) < fifths) return 1;
  if (fifths < 0 && FLAT_ORDER.indexOf(step) < -fifths) return -1;
  return 0;
}

function isCautionary(accidental) {
  return ['parentheses', 'cautionary', 'bracket', 'editorial'].some((name) => attribute(accidental, name) === 'yes');
}

function setAccidental(note, alter) {
  const name = ACCIDENTALS[alter];
  let accidental = child(note, 'accidental');
  if (!accidental) {
    let after;
    for (const node of children(note)) if (BEFORE_ACCIDENTAL.has(node.name)) after = node;
    accidental = element('accidental');
    insertAfter(note, accidental, after);
  }
  setText(accidental, name);
}

function noteOnsets(measure) {
  const notes = [];
  let position = 0;
  let last = 0;
  for (const node of children(measure)) {
    if (node.name === 'note') {
      const chord = child(node, 'chord');
      const onset = chord ? last : position;
      notes.push({ note: node, onset, order: notes.length });
      if (!chord) {
        last = onset;
        if (!child(node, 'grace')) position += integer(child(node, 'duration'));
      }
    } else if (node.name === 'backup') {
      position -= integer(child(node, 'duration'));
    } else if (node.name === 'forward') {
      position += integer(child(node, 'duration'));
    }
  }
  return notes.sort((a, b) => a.onset - b.onset || a.order - b.order);
}

function spellMeasure(measure, fifths) {
  const state = new Map();
  for (const { note } of noteOnsets(measure)) {
    const pitch = child(note, 'pitch');
    if (!pitch) continue;
    const p = readPitch(pitch);
    const slot = `${p.step}:${p.octave}`;
    const expected = state.has(slot) ? state.get(slot) : keyAlter(fifths ?? 0, p.step);
    const accidental = child(note, 'accidental');
    const plain = !accidental || PLAIN_ACCIDENTALS.has(text(accidental).trim());
    if (children(note, 'tie').some((tie) => attribute(tie, 'type') === 'stop')) {
      if (accidental && plain && !isCautionary(accidental)) remove(note, accidental);
      continue;
    }
    state.set(slot, p.alter);
    if (p.micro || !plain) continue;
    if (p.alter !== expected || (accidental && isCautionary(accidental))) setAccidental(note, p.alter);
    else if (accidental) remove(note, accidental);
  }
}

function insertAttribute(attributes, node) {
  const rank = ATTRIBUTE_ORDER.indexOf(node.name);
  let after;
  for (const current of children(attributes)) if (ATTRIBUTE_ORDER.indexOf(current.name) <= rank) after = current;
  if (after) insertAfter(attributes, node, after);
  else attributes.children.unshift(node);
}

function firstAttributes(part) {
  const measure = child(part, 'measure');
  if (!measure) throw new MusicXmlError('part has no measures');
  let attributes = child(measure, 'attributes');
  if (!attributes) {
    attributes = element('attributes');
    let after;
    for (const node of children(measure)) {
      if (node.name !== 'print') break;
      after = node;
    }
    insertAfter(measure, attributes, after);
  }
  return attributes;
}

function clefNode(name) {
  const clef = CLEFS[name];
  const nodes = [element('sign', [textNode(clef.sign)]), element('line', [textNode(String(clef.line))])];
  if (clef.octave) nodes.push(element('clef-octave-change', [textNode(String(clef.octave))]));
  return nodes;
}

function applyClef(part, name) {
  let first = true;
  for (const measure of children(part, 'measure')) {
    for (const attributes of children(measure, 'attributes')) {
      for (const clef of children(attributes, 'clef')) {
        if (first) clef.children = clefNode(name);
        else remove(attributes, clef);
        first = false;
      }
      if (!children(attributes).length) remove(measure, attributes);
    }
  }
  if (first) insertAttribute(firstAttributes(part), element('clef', clefNode(name)));
}

function clearRestPositions(part) {
  for (const rest of descendants(part, 'rest')) keepChildren(rest, (node) => node.name !== 'display-step' && node.name !== 'display-octave');
}

function applyTranspose(part, option) {
  for (const attributes of descendants(part, 'attributes')) {
    for (const node of children(attributes, 'transpose')) remove(attributes, node);
  }
  if (!option.chromatic) return;
  const octave = Math.trunc(option.chromatic / 12);
  const nodes = [
    element('diatonic', [textNode(String(option.diatonic - 7 * octave))]),
    element('chromatic', [textNode(String(option.chromatic - 12 * octave))]),
  ];
  if (octave) nodes.push(element('octave-change', [textNode(String(octave))]));
  insertAttribute(firstAttributes(part), element('transpose', nodes));
}

function ensureKey(part) {
  if (descendants(part, 'key').length) return;
  insertAttribute(firstAttributes(part), element('key', [element('fifths', [textNode('0')])]));
}

function shiftHarmony(harmony, prefix, diatonic, chromatic) {
  const holder = child(harmony, prefix);
  const step = holder && child(holder, `${prefix}-step`);
  if (!step) return;
  const index = STEPS.indexOf(text(step).trim());
  if (index === -1) return;
  const alterNode = child(holder, `${prefix}-alter`);
  const p = respell(shiftPitch({ step: index, octave: 4, alter: Math.round(decimal(alterNode)), micro: 0 }, diatonic, chromatic));
  setText(step, STEPS[p.step]);
  if (p.alter === 0) {
    if (alterNode) remove(holder, alterNode);
  } else if (alterNode) {
    setText(alterNode, String(p.alter));
  } else {
    insertAfter(holder, element(`${prefix}-alter`, [textNode(String(p.alter))]), step);
  }
}

function fold(midi, range) {
  let value = midi;
  if (!range) return value;
  while (range.low !== null && value < range.low) value += 12;
  while (range.high !== null && value > range.high && (range.low === null || value - 12 >= range.low)) value -= 12;
  return value;
}

const FREE_STEMS = new Set(['up', 'down']);

function releaseStems(part) {
  for (const measure of children(part, 'measure')) {
    const notes = children(measure, 'note');
    const voices = new Map();
    for (const note of notes) {
      if (!child(note, 'pitch') && !child(note, 'unpitched')) continue;
      const staff = text(child(note, 'staff'))?.trim() || '1';
      const voice = text(child(note, 'voice'))?.trim() || '1';
      if (!voices.has(staff)) voices.set(staff, new Set());
      voices.get(staff).add(voice);
    }
    for (const note of notes) {
      const staff = text(child(note, 'staff'))?.trim() || '1';
      if ((voices.get(staff)?.size ?? 0) > 1) continue;
      const stem = child(note, 'stem');
      if (stem && FREE_STEMS.has(text(stem).trim())) remove(note, stem);
    }
  }
}

function transformPart(part, { offset, followSource, range }) {
  let from = { diatonic: 0, chromatic: 0 };
  let fifths = null;
  let wrap = 0;
  let moved = 0;
  const interval = () => ({ diatonic: offset.diatonic + from.diatonic, chromatic: offset.chromatic + from.chromatic });
  const shiftOf = ({ diatonic, chromatic }) => 7 * chromatic - 12 * diatonic;
  for (const measure of children(part, 'measure')) {
    let respace = false;
    let chord = [];
    for (const node of children(measure)) {
      if (node.name === 'attributes') {
        const transpose = child(node, 'transpose');
        if (transpose && followSource) from = readTranspose(transpose);
        for (const key of children(node, 'key')) {
          const fifthsNode = child(key, 'fifths');
          if (!fifthsNode) continue;
          const shift = shiftOf(interval());
          let value = integer(fifthsNode) + shift;
          wrap = 0;
          if (shift && value > 6) [value, wrap] = [value - 12, 1];
          else if (shift && value < -6) [value, wrap] = [value + 12, -1];
          const cancel = child(key, 'cancel');
          if (cancel && shift) {
            if (fifths === null) remove(key, cancel);
            else setText(cancel, String(fifths));
          }
          setText(fifthsNode, String(value));
          fifths = value;
        }
      } else if (node.name === 'note') {
        if (!child(node, 'chord')) chord = [];
        const pitch = child(node, 'pitch');
        if (!pitch) continue;
        const { diatonic, chromatic } = interval();
        const before = readPitch(pitch);
        let after = shiftPitch(before, diatonic + wrap, chromatic);
        const spelled = respell(after);
        if (spelled !== after) respace = true;
        after = spelled;
        const target = fold(midiOf(after), range);
        const folded = target !== midiOf(after);
        if (folded) {
          const octaves = (target - midiOf(after)) / 12;
          after = shiftPitch(after, 7 * octaves, 12 * octaves);
          respace = true;
        }
        while (after.octave < 0) after = shiftPitch(after, 7, 12);
        while (after.octave > 9) after = shiftPitch(after, -7, -12);
        const slot = `${after.step}:${after.octave}:${after.alter + after.micro}`;
        const twin = chord.find((entry) => entry.slot === slot);
        if (twin && (folded || twin.folded)) {
          remove(measure, node);
          continue;
        }
        chord.push({ slot, folded });
        if (folded) moved++;
        writePitch(pitch, after);
        const accidental = child(node, 'accidental');
        const current = accidental && text(accidental).trim();
        if (accidental && after.alter !== before.alter) {
          if (!after.micro && PLAIN_ACCIDENTALS.has(current)) setText(accidental, ACCIDENTALS[after.alter]);
          else if (Object.values(MICRO_ACCIDENTALS).includes(current) && MICRO_ACCIDENTALS[after.alter + after.micro]) {
            setText(accidental, MICRO_ACCIDENTALS[after.alter + after.micro]);
          }
        }
      } else if (node.name === 'harmony') {
        const current = interval();
        if (!shiftOf(current)) continue;
        shiftHarmony(node, 'root', current.diatonic + wrap, current.chromatic);
        shiftHarmony(node, 'bass', current.diatonic + wrap, current.chromatic);
      }
    }
    if (respace) spellMeasure(measure, fifths);
  }
  return moved;
}

function soundingPitches(part) {
  const sounding = [];
  let transpose = { diatonic: 0, chromatic: 0 };
  for (const measure of children(part, 'measure')) {
    for (const node of children(measure)) {
      if (node.name === 'attributes') {
        const found = child(node, 'transpose');
        if (found) transpose = readTranspose(found);
      } else if (node.name === 'note') {
        const pitch = child(node, 'pitch');
        if (pitch) sounding.push(midiOf(readPitch(pitch)) + transpose.chromatic);
      }
    }
  }
  return sounding;
}

function hideLabel(scorePart, name) {
  for (const tag of ['part-name-display', 'part-abbreviation', 'part-abbreviation-display']) {
    for (const node of children(scorePart, tag)) remove(scorePart, node);
  }
  let partName = child(scorePart, 'part-name');
  if (!partName) {
    partName = element('part-name', [textNode(name)]);
    scorePart.children.unshift(partName);
  }
  setAttribute(partName, 'print-object', 'no');
}

function hideTempo(score) {
  for (const part of children(score, 'part')) {
    const measure = child(part, 'measure');
    if (!measure) continue;
    for (const direction of children(measure, 'direction')) {
      const types = children(direction, 'direction-type');
      const tempo = types.filter((type) => child(type, 'metronome'));
      if (!tempo.length) continue;
      if (tempo.length < types.length) {
        for (const type of tempo) remove(direction, type);
        continue;
      }
      const sound = child(direction, 'sound');
      if (sound) measure.children.splice(measure.children.indexOf(direction), 1, sound);
      else remove(measure, direction);
    }
  }
}

function load(xml) {
  const document = parse(xml);
  const score = root(document);
  if (score.name !== 'score-partwise') throw new MusicXmlError('expected score-partwise');
  const partList = child(score, 'part-list');
  if (!partList) throw new MusicXmlError('missing part-list');
  const bodies = new Map();
  const bodyList = children(score, 'part');
  if (bodyList.length > MAX_PARTS) throw new MusicXmlError('too many parts');
  for (const part of bodyList) {
    const id = attribute(part, 'id');
    if (!id || bodies.has(id)) throw new MusicXmlError('missing or duplicate part id');
    bodies.set(id, part);
  }
  const parts = [];
  const claimed = new Set();
  for (const scorePart of children(partList, 'score-part')) {
    const id = attribute(scorePart, 'id');
    const body = bodies.get(id);
    if (!body || claimed.has(id)) throw new MusicXmlError('score-part without matching part');
    claimed.add(id);
    const name = text(child(scorePart, 'part-name'))?.trim() ?? '';
    const parsed = parsePartName(name);
    parts.push({ id, name, number: parsed?.number ?? null, notation: parsed?.notation ?? null, scorePart, body });
  }
  if (parts.length !== bodies.size) throw new MusicXmlError('part without score-part');
  return { document, score, partList, parts };
}

function validateInstrument(instrument) {
  const notations = instrument?.notations;
  if (!Array.isArray(notations) || !notations.length || notations.some((n) => !NOTATIONS.includes(n))) {
    throw new TypeError('instrument needs a list of notations');
  }
  return notations;
}

function validateNumber(number) {
  if (!NUMBERS.includes(number)) throw new TypeError(`unknown number ${String(number).slice(0, 20)}`);
  return number;
}

function validateNotation(notation) {
  if (!NOTATIONS.includes(notation)) throw new TypeError(`unknown notation ${String(notation).slice(0, 20)}`);
  return notation;
}

const STEP_OF = [0, 1, 1, 2, 2, 3, 3];

export function semitoneInterval(semitones) {
  if (!Number.isInteger(semitones) || semitones < -6 || semitones > 6) throw new TypeError('semitones must be an integer from -6 to 6');
  const diatonic = STEP_OF[Math.abs(semitones)] * Math.sign(semitones);
  return { diatonic, chromatic: semitones };
}

function validateOptions({ octave = 0, range = null, semitones = 0 } = {}) {
  if (!Number.isInteger(octave) || octave < -2 || octave > 2) throw new TypeError('octave must be an integer from -2 to 2');
  semitoneInterval(semitones);
  if (range === null || range === undefined) return { octave, range: null, semitones };
  const low = range.low ?? null;
  const high = range.high ?? null;
  for (const value of [low, high]) {
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 127)) throw new TypeError('range limits must be MIDI numbers');
  }
  if (low !== null && high !== null && high - low < 11) throw new TypeError('range must span at least an octave');
  return { octave, range: low === null && high === null ? null : { low, high }, semitones };
}

function pickNumber(parts, wanted) {
  const present = [...new Set(parts.map((p) => p.number))];
  const numbered = present.filter((n) => n !== 'Melodie');
  if (!numbered.length) return present.includes('Melodie') ? 'Melodie' : null;
  if (numbered.includes(wanted)) return wanted;
  const regular = numbered.filter((n) => n !== 'Bass');
  if (wanted !== 'Bass' && regular.length) numbered.splice(0, numbered.length, ...regular);
  const distance = (n) => Math.abs(RANK[n] - RANK[wanted]);
  return numbered.sort((a, b) => distance(a) - distance(b) || RANK[b] - RANK[a])[0];
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

function bestOption(notation, sounding, options = OPTIONS[notation]) {
  if (!sounding.length) return { option: options[0], distance: 0 };
  const average = mean(sounding);
  let best = null;
  for (const option of options) {
    const distance = Math.abs(average - option.chromatic - CLEFS[option.clef].middle);
    if (!best || distance < best.distance) best = { option, distance };
  }
  return best;
}

function plan(parts, number, notation) {
  const candidates = parts.filter((p) => p.number === number);
  const original = candidates.find((p) => p.notation === notation);
  if (original) return { source: original, original: true, down: 0 };
  const down = number === 'Melodie' && notation === 'C Bass' ? -12 : 0;
  const sources = NOTATIONS.map((n) => candidates.find((p) => p.notation === n)).filter(Boolean)
    .map((source) => ({ source, sounding: soundingPitches(source.body).map((m) => m + down) }));
  const filled = sources.filter((s) => s.sounding.length);
  let best = null;
  for (const { source, sounding } of filled.length ? filled : sources) {
    const { option, distance } = bestOption(notation, sounding);
    if (!best || distance < best.distance) best = { source, original: false, down, option, distance };
  }
  return best;
}

function choose(parts, instrument, wanted) {
  const notations = validateInstrument(instrument);
  const usable = parts.filter((p) => p.number);
  const number = pickNumber(usable, validateNumber(wanted));
  if (!number) throw new MusicXmlError('piece has no usable parts');
  const notation = notations.find((n) => usable.some((p) => p.number === number && p.notation === n)) ?? notations[0];
  return { number, notation };
}

export function readParts(xml) {
  return load(xml).parts.map(({ id, name, number, notation }) => ({ id, name, number, notation }));
}

export function choosePart(xml, instrument, number) {
  const { parts } = load(xml);
  const chosen = choose(parts, instrument, number);
  const { source, original } = plan(parts, chosen.number, chosen.notation);
  return { ...chosen, name: `${chosen.number} ${chosen.notation}`, source: source.name, original };
}

function build(loaded, number, notation, options) {
  const { document, score, partList, parts } = loaded;
  const { octave, range, semitones } = validateOptions(options);
  const found = plan(parts, number, notation);
  if (!found) throw new MusicXmlError(`piece has no part ${number}`);
  const { source, original, down } = found;
  const name = `${number} ${notation}`;
  if (!original && descendants(source.body, 'staves').some((node) => integer(node) > 1)) {
    throw new MusicXmlError('parts with several staves cannot be rewritten');
  }
  keepChildren(partList, (node) => node === source.scorePart);
  keepChildren(score, (node) => node.name !== 'part' || node === source.body);
  const step = semitoneInterval(semitones);
  const offset = { diatonic: 7 * octave + step.diatonic, chromatic: 12 * octave + step.chromatic };
  if (!original) {
    offset.diatonic += (down ? -7 : 0) - found.option.diatonic;
    offset.chromatic += down - found.option.chromatic;
    ensureKey(source.body);
  }
  if (original && semitones) ensureKey(source.body);
  const moved = transformPart(source.body, { offset, followSource: !original, range });
  if (!original || octave || semitones) releaseStems(source.body);
  if (!original) {
    applyClef(source.body, found.option.clef);
    clearRestPositions(source.body);
    applyTranspose(source.body, found.option);
    setText(child(source.scorePart, 'part-name'), name);
    for (const instrumentNode of children(source.scorePart, 'score-instrument')) {
      const instrumentName = child(instrumentNode, 'instrument-name');
      if (instrumentName) setText(instrumentName, name);
    }
  }
  hideLabel(source.scorePart, name);
  hideTempo(score);
  return {
    xml: serialize(document),
    name,
    number,
    notation,
    source: source.name,
    original,
    clef: original ? null : found.option.clef,
    moved,
  };
}

export function buildPart(xml, { number, notation, octave = 0, range = null, semitones = 0 } = {}) {
  validateNumber(number);
  validateNotation(notation);
  return build(load(xml), number, notation, { octave, range, semitones });
}

export function preparePart(xml, { instrument, number, octave = 0, range = null, semitones = 0 } = {}) {
  const loaded = load(xml);
  const chosen = choose(loaded.parts, instrument, number);
  return build(loaded, chosen.number, chosen.notation, { octave, range, semitones });
}

export function selectParts(xml, names, { octaves = {}, semitones = 0 } = {}) {
  const step = semitoneInterval(semitones);
  if (!Array.isArray(names)) throw new TypeError('names must be a list');
  if (octaves === null || typeof octaves !== 'object') throw new TypeError('octaves must be an object');
  const { document, score, partList, parts } = load(xml);
  const keep = new Set(parts.filter((p) => names.includes(p.name)).map((p) => p.id));
  if (!keep.size) throw new MusicXmlError('no part selected');
  const groups = [];
  for (const node of children(partList)) {
    if (node.name === 'score-part') {
      if (keep.has(attribute(node, 'id'))) for (const group of groups) group.count++;
      else remove(partList, node);
    } else if (node.name === 'part-group') {
      const groupNumber = attribute(node, 'number') ?? '1';
      if (attribute(node, 'type') === 'start') {
        groups.push({ number: groupNumber, start: node, count: 0 });
      } else if (attribute(node, 'type') === 'stop') {
        const index = groups.findLastIndex((g) => g.number === groupNumber);
        if (index === -1) continue;
        const [group] = groups.splice(index, 1);
        if (!group.count) {
          remove(partList, group.start);
          remove(partList, node);
        }
      }
    }
  }
  for (const group of groups) if (!group.count) remove(partList, group.start);
  for (const part of children(score, 'part')) if (!keep.has(attribute(part, 'id'))) remove(score, part);
  for (const p of parts) {
    const octave = Object.hasOwn(octaves, p.name) ? octaves[p.name] : 0;
    if (!keep.has(p.id) || (!octave && !semitones)) continue;
    if (!Number.isInteger(octave) || octave < -2 || octave > 2) throw new TypeError('octave must be an integer from -2 to 2');
    if (semitones) ensureKey(p.body);
    transformPart(p.body, { offset: { diatonic: 7 * octave + step.diatonic, chromatic: 12 * octave + step.chromatic }, followSource: false, range: null });
    releaseStems(p.body);
  }
  hideTempo(score);
  return serialize(document);
}
