import { BEATS, BEAT_WORDS, validTempo } from '../lib/tempo.mjs';

const MAX_MEASURES = 100000;
const MAX_EVENTS = 100000;
const MAX_ONSETS = 1000;
const MAX_QUARTERS = 1000;
const EPSILON = 1e-4;

export class TimingError extends Error {
  name = 'TimingError';
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quarter = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_QUARTERS;
const fail = what => {
  throw new TimingError(what);
};

export function checkTiming(value) {
  if (!isObject(value)) fail('timing is not an object');
  const keys = Object.keys(value).join();
  const v2 = keys === 'version,measures,lengths,onsets,events' && value.version === 2;
  if (!v2 && !(keys === 'version,measures,events' && value.version === 1)) fail('timing has the wrong fields');
  const { measures, events } = value;
  if (!Number.isSafeInteger(measures) || measures < 1 || measures > MAX_MEASURES) fail('timing has an invalid measure count');
  let lengths = null;
  let onsets = null;
  if (v2) {
    if (!Array.isArray(value.lengths) || value.lengths.length !== measures || value.lengths.some(q => !quarter(q) || q <= 0)) fail('timing lengths are invalid');
    if (!Array.isArray(value.onsets) || value.onsets.length !== measures) fail('timing onsets are invalid');
    value.onsets.forEach((list, m) => {
      if (!Array.isArray(list) || list.length > MAX_ONSETS || list.some((q, i) => !quarter(q) || q >= value.lengths[m] || (i && q <= list[i - 1]))) fail('timing onsets are invalid');
    });
    lengths = [...value.lengths];
    onsets = value.onsets.map(list => [...list]);
  }
  if (!Array.isArray(events) || !events.length || events.length > MAX_EVENTS) fail('timing has no or too many events');
  let last = -1;
  const out = events.map(event => {
    if (!Array.isArray(event) || event.length < 2 || (!v2 && event.length !== 2)) fail('timing event is invalid');
    const [ms, measure, ...times] = event;
    if (!Number.isSafeInteger(ms) || !Number.isSafeInteger(measure) || measure < 0 || measure >= measures) fail('timing event is invalid');
    if (last < 0 ? ms !== 0 : ms <= last) fail('timing is not increasing');
    if (times.length && times.length !== onsets[measure].length) fail('timing event is invalid');
    let previous = ms - 1;
    for (const t of times) {
      if (!Number.isSafeInteger(t) || t <= previous) fail('timing segment times are invalid');
      previous = t;
    }
    last = times.length ? times.at(-1) : ms;
    return { ms, measure, times };
  });
  for (let i = 1; i < out.length; i++) {
    const before = out[i - 1];
    if ((before.times.length ? before.times.at(-1) : before.ms) >= out[i].ms) fail('timing is not increasing');
  }
  return { measures, lengths, onsets, events: out };
}

export function readTimemap(timemap, measureIds) {
  if (!Array.isArray(timemap)) fail('timemap is not a list');
  const index = new Map(measureIds.map((id, i) => [id, i]));
  const starts = new Array(measureIds.length).fill(null);
  const notes = new Map();
  let current = -1;
  for (const entry of timemap) {
    if (!isObject(entry) || !quarter(entry.qstamp)) continue;
    if (typeof entry.measureOn === 'string' && index.has(entry.measureOn)) {
      current = index.get(entry.measureOn);
      if (starts[current] === null) starts[current] = entry.qstamp;
    }
    if (current < 0) continue;
    for (const id of Array.isArray(entry.on) ? entry.on : []) {
      if (typeof id === 'string' && !notes.has(id)) notes.set(id, { measure: current, start: entry.qstamp, end: Infinity });
    }
    for (const id of Array.isArray(entry.off) ? entry.off : []) {
      const note = notes.get(id);
      if (note && note.end === Infinity && entry.qstamp >= note.start) note.end = entry.qstamp;
    }
  }
  const lengths = starts.map((start, m) => {
    if (start === null) return null;
    const next = starts.slice(m + 1).find(s => s !== null);
    if (next !== undefined) return next - start > 0 ? next - start : null;
    const ends = [...notes.values()].filter(n => n.measure === m && Number.isFinite(n.end)).map(n => n.end);
    return ends.length ? Math.max(...ends) - start || null : null;
  });
  const byMeasure = measureIds.map(() => []);
  for (const [id, note] of notes) {
    const start = starts[note.measure];
    byMeasure[note.measure].push({ id, on: note.start - start, off: (Number.isFinite(note.end) ? note.end : note.start + 1) - start });
  }
  return { lengths, notes: byMeasure };
}

export function eventAt(events, ms) {
  let lo = 0;
  let hi = events.length - 1;
  if (!events.length || ms < events[0].ms) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (events[mid].ms <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function measureLength(timing, verovio, measure) {
  return timing.lengths?.[measure] ?? verovio[measure] ?? null;
}

export function quarterRate(timing, verovio) {
  const rates = [];
  timing.events.forEach((event, k) => {
    const next = timing.events[k + 1];
    const length = measureLength(timing, verovio, event.measure);
    if (next && length) rates.push((next.ms - event.ms) / length);
  });
  if (!rates.length) return 500;
  rates.sort((a, b) => a - b);
  return rates[rates.length >> 1];
}

export function anchors(timing, verovio, k, rate = quarterRate(timing, verovio)) {
  const event = timing.events[k];
  if (!event) return null;
  const length = measureLength(timing, verovio, event.measure);
  const next = timing.events[k + 1];
  const end = next ? next.ms : event.ms + Math.round((length ?? 4) * rate);
  if (!length) return { measure: event.measure, length: null, points: [[0, event.ms], [1, end]] };
  const points = [];
  if (event.times.length) {
    const onsets = timing.onsets[event.measure];
    if (onsets[0] > 0) points.push([0, event.ms]);
    onsets.forEach((q, i) => points.push([q, event.times[i]]));
  } else points.push([0, event.ms]);
  points.push([length, Math.max(end, points.at(-1)[1] + 1)]);
  return { measure: event.measure, length, points };
}

export function quarterAt(points, ms) {
  if (ms <= points[0][1]) return points[0][0];
  for (let i = 1; i < points.length; i++) {
    const [q1, t1] = points[i];
    if (ms < t1) {
      const [q0, t0] = points[i - 1];
      return q0 + (q1 - q0) * (ms - t0) / (t1 - t0);
    }
  }
  return points.at(-1)[0];
}

export function timeAt(points, q) {
  if (q <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [q1, t1] = points[i];
    if (q <= q1) {
      const [q0, t0] = points[i - 1];
      return q1 === q0 ? t0 : t0 + (t1 - t0) * (q - q0) / (q1 - q0);
    }
  }
  return points.at(-1)[1];
}

export function sounding(notes, measure, q) {
  const list = notes[measure] || [];
  const on = list.filter(n => n.on <= q + EPSILON && n.off > q + EPSILON).map(n => n.id);
  return on;
}

export function position(timing, verovio, ms) {
  const k = eventAt(timing.events, ms);
  if (k < 0) return null;
  const a = anchors(timing, verovio, k);
  if (ms >= a.points.at(-1)[1] && k === timing.events.length - 1) return { event: k, measure: a.measure, q: null };
  return { event: k, measure: a.measure, q: a.length ? quarterAt(a.points, ms) : null };
}

export function seekTime(timing, verovio, measure, q, nowMs) {
  const current = eventAt(timing.events, nowMs);
  const plays = timing.events.map((e, k) => (e.measure === measure ? k : -1)).filter(k => k >= 0);
  if (!plays.length) return null;
  const k = plays.find(p => p >= current) ?? plays[0];
  const a = anchors(timing, verovio, k);
  return Math.round(a.length ? timeAt(a.points, Math.min(q, a.length)) : a.points[0][1]);
}

export function baseTempo(timing, verovio) {
  return Math.max(20, Math.min(400, Math.round(60000 / quarterRate(timing, verovio))));
}

export function tempoRange(base) {
  return { min: Math.max(10, Math.round(base * 0.5)), max: Math.round(base * 1.2) };
}

const NOTE_GLYPHS = { whole: '\uECA2', half: '\uECA3', quarter: '\uECA5', eighth: '\uECA7' };
const DOT_GLYPH = '\uECB7';

export function displayTempo(tempo, quarterBase) {
  if (validTempo(tempo)) return { beat: tempo.beat, base: tempo.bpm };
  const base = Number.isFinite(quarterBase) && quarterBase > 0 ? Math.round(quarterBase) : 120;
  return { beat: 'quarter', base };
}

export function beatSign(beat) {
  const key = Object.hasOwn(BEATS, beat) ? beat : 'quarter';
  const dotted = key.startsWith('dotted-');
  const plain = dotted ? key.slice(7) : key;
  return { glyphs: `${NOTE_GLYPHS[plain]}${dotted ? DOT_GLYPH : ''}`, words: BEAT_WORDS[key] };
}
