import { decodeKey, fileKeys, fileName, decryptFile } from '../lib/crypto.mjs';

export const LIMITS = { binder: 1024 * 1024, piece: 1024 * 1024, musicxml: 16 * 1024 * 1024, timing: 4 * 1024 * 1024, audio: 48 * 1024 * 1024 };
export const NUMBERS = ['1.', '2.', '3.', '4.', 'Bass'];
const OVERHEAD = 1024;
const NAME = /^x\/[A-Za-z0-9_-]{22}\.bin$/;
const ID = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const MARK = /^[0-9a-f]{16}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const NOTATIONS = ['C', 'B', 'Es', 'F', 'C Bass'];
const ALL_NUMBERS = ['1.', '2.', '3.', '4.', 'Bass', 'Melodie'];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_PIECES = 2000;
const MAX_PARTS = 64;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class LockedError extends Error {
  name = 'LockedError';
}

export class OfflineError extends Error {
  name = 'OfflineError';
}

export class FormatError extends Error {
  name = 'FormatError';
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function validTime(value) {
  return typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

export async function gunzip(data, max) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new FormatError('file too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FormatError) throw error;
    throw new FormatError('invalid gzip');
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

export async function fetchSealed(fetcher, name, max, { fresh = false } = {}) {
  if (!NAME.test(name)) throw new FormatError('invalid file name');
  let response;
  try {
    response = await fetcher(fresh ? `${name}?fresh` : name, fresh ? { cache: 'no-cache' } : {});
  } catch {
    throw new OfflineError('network');
  }
  if (response.status === 404) throw new LockedError('not found');
  if (!response.ok) throw new OfflineError(`status ${response.status}`);
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > max + OVERHEAD) throw new FormatError('file too large');
  let data;
  try {
    data = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new OfflineError('network');
  }
  if (data.length > max + OVERHEAD) throw new FormatError('file too large');
  return data;
}

export async function openSealed(keys, kind, name, data, max) {
  let plain;
  try {
    plain = await decryptFile(keys, kind, name, data);
  } catch {
    throw new FormatError('cannot decrypt');
  }
  return gunzip(plain, max);
}

function readJson(bytes) {
  try {
    return JSON.parse(utf8.decode(bytes));
  } catch {
    throw new FormatError('not JSON');
  }
}

export function parseBinder(bytes) {
  return checkBinder(readJson(bytes));
}

function checkOctaves(value) {
  if (!isObject(value) || Object.keys(value).length === 0 || Object.keys(value).length > 50) throw new FormatError('binder piece has invalid octaves');
  const octaves = {};
  for (const [instrument, octave] of Object.entries(value)) {
    if (instrument.length > 80 || !ID.test(instrument) || !Number.isSafeInteger(octave) || octave === 0 || octave < -2 || octave > 2) throw new FormatError('binder piece has invalid octaves');
    octaves[instrument] = octave;
  }
  return octaves;
}

export function checkBinder(value) {
  if (!exactKeys(value, ['version', 'name', 'created', 'published', 'pieces']) || value.version !== 1) throw new FormatError('binder list has the wrong fields');
  if (!text(value.name, 200) || !validTime(value.created) || !validTime(value.published)) throw new FormatError('binder list is invalid');
  if (!Array.isArray(value.pieces) || value.pieces.length > MAX_PIECES) throw new FormatError('binder list is invalid');
  const seen = new Set();
  const pieces = value.pieces.map(piece => {
    const withOctaves = isObject(piece) && Object.hasOwn(piece, 'octaves');
    if (!exactKeys(piece, withOctaves ? ['id', 'title', 'mark', 'key', 'list', 'octaves'] : ['id', 'title', 'mark', 'key', 'list'])) throw new FormatError('binder piece has the wrong fields');
    const { id, title, mark, key, list } = piece;
    const octaves = withOctaves ? checkOctaves(piece.octaves) : null;
    if (typeof id !== 'string' || id.length > 80 || !ID.test(id) || seen.has(id)) throw new FormatError('binder piece has an invalid id');
    if (!text(title, 300) || typeof mark !== 'string' || !MARK.test(mark) || typeof key !== 'string' || !KEY.test(key) || typeof list !== 'string' || !NAME.test(list)) {
      throw new FormatError('binder piece is invalid');
    }
    seen.add(id);
    return { id, title, mark, key, list, ...(octaves ? { octaves } : {}) };
  });
  return { version: 1, name: value.name, created: value.created, published: value.published, pieces };
}

export function parsePieceList(bytes) {
  const value = readJson(bytes);
  if (!exactKeys(value, ['version', 'measures', 'parts', 'files']) || value.version !== 1) throw new FormatError('piece list has the wrong fields');
  if (!Number.isSafeInteger(value.measures) || value.measures < 1 || value.measures > 100000) throw new FormatError('piece list is invalid');
  if (!Array.isArray(value.parts) || !value.parts.length || value.parts.length > MAX_PARTS) throw new FormatError('piece list is invalid');
  const parts = value.parts.map((part, i) => {
    if (!exactKeys(part, ['id', 'name']) || part.id !== `P${i + 1}` || !text(part.name, 100)) throw new FormatError('piece list part is invalid');
    return { id: part.id, name: part.name };
  });
  const kinds = ['musicxml', 'timing', 'audio'];
  if (!exactKeys(value.files, kinds) || kinds.some(kind => typeof value.files[kind] !== 'string' || !NAME.test(value.files[kind]))) {
    throw new FormatError('piece list files are invalid');
  }
  return { version: 1, measures: value.measures, parts, files: Object.fromEntries(kinds.map(kind => [kind, value.files[kind]])) };
}

export async function binderAccess(key) {
  const keys = await fileKeys(key, 'binder');
  return { keys, name: await fileName(keys, 'binder') };
}

export async function loadBinder(fetcher, key) {
  const { keys, name } = await binderAccess(key);
  const data = await fetchSealed(fetcher, name, LIMITS.binder, { fresh: true });
  return { id: name, list: parseBinder(await openSealed(keys, 'binder', name, data, LIMITS.binder)) };
}

export function newRecord(id, key, list, now = Date.now()) {
  return { id, key, list, seen: Object.fromEntries(list.pieces.map(piece => [piece.id, piece.mark])), added: now, locked: false };
}

export const FUTURE_TOLERANCE = 24 * 3600 * 1000;

export function mergeBinder(record, list, now = Date.now()) {
  const known = Date.parse(record.list.published);
  if (Date.parse(list.published) < known && known <= now + FUTURE_TOLERANCE) return { record: { ...record, locked: false }, rejected: true };
  const ids = new Set(list.pieces.map(piece => piece.id));
  const seen = Object.fromEntries(Object.entries(record.seen).filter(([id]) => ids.has(id)));
  return { record: { ...record, list, seen, locked: false }, rejected: false };
}

export function checkRecord(value) {
  if (!isObject(value) || typeof value.id !== 'string' || !NAME.test(value.id) || typeof value.key !== 'string' || !KEY.test(value.key)) return null;
  let list;
  try {
    list = checkBinder(value.list);
  } catch {
    return null;
  }
  const seen = {};
  if (isObject(value.seen)) {
    for (const [id, mark] of Object.entries(value.seen)) if (ID.test(id) && typeof mark === 'string' && MARK.test(mark)) seen[id] = mark;
  }
  return { id: value.id, key: value.key, list, seen, added: Number.isFinite(value.added) ? value.added : 0, locked: value.locked === true };
}

export function pieceMark(record, piece) {
  if (!Object.hasOwn(record.seen, piece.id)) return 'neu';
  return record.seen[piece.id] === piece.mark ? null : 'geändert';
}

export function markSeen(record, piece) {
  return { ...record, seen: { ...record.seen, [piece.id]: piece.mark } };
}

export function countMarks(record) {
  const counts = { neu: 0, geändert: 0 };
  for (const piece of record.list.pieces) {
    const mark = pieceMark(record, piece);
    if (mark) counts[mark]++;
  }
  return counts;
}

export async function pieceAccess(entry) {
  let key;
  try {
    key = decodeKey(entry.key);
  } catch {
    throw new FormatError('invalid piece key');
  }
  const keys = await fileKeys(key, 'piece');
  if (await fileName(keys, 'piece') !== entry.list) throw new FormatError('piece list name does not match its key');
  return keys;
}

export async function loadPieceList(fetcher, entry) {
  const keys = await pieceAccess(entry);
  const data = await fetchSealed(fetcher, entry.list, LIMITS.piece);
  return { keys, list: parsePieceList(await openSealed(keys, 'piece', entry.list, data, LIMITS.piece)) };
}

export async function loadPiece(fetcher, entry) {
  const { keys, list } = await loadPieceList(fetcher, entry);
  const name = list.files.musicxml;
  const data = await fetchSealed(fetcher, name, LIMITS.musicxml);
  const plain = await openSealed(keys, 'musicxml', name, data, LIMITS.musicxml);
  if (await fileName(keys, 'musicxml', await sha256Hex(plain)) !== name) throw new FormatError('MusicXML does not match its name');
  let xml;
  try {
    xml = utf8.decode(plain);
  } catch {
    throw new FormatError('MusicXML is not UTF-8');
  }
  return { list, xml };
}

async function loadFile(fetcher, keys, kind, name) {
  const data = await fetchSealed(fetcher, name, LIMITS[kind]);
  const plain = await openSealed(keys, kind, name, data, LIMITS[kind]);
  if (await fileName(keys, kind, await sha256Hex(plain)) !== name) throw new FormatError(`${kind} does not match its name`);
  return plain;
}

export async function loadTiming(fetcher, entry, list) {
  const keys = await pieceAccess(entry);
  return readJson(await loadFile(fetcher, keys, 'timing', list.files.timing));
}

export async function loadAudio(fetcher, entry, list) {
  const keys = await pieceAccess(entry);
  return loadFile(fetcher, keys, 'audio', list.files.audio);
}

export function keepFiles(records, lists) {
  const files = new Set();
  for (const record of records) {
    for (const piece of record.list.pieces) {
      const list = lists.get(piece.list);
      if (!list) return null;
      files.add(piece.list);
      files.add(list.files.musicxml);
      files.add(list.files.timing);
      files.add(list.files.audio);
    }
  }
  return [...files].sort();
}

export function uniquePieces(records) {
  const pieces = new Map();
  for (const record of records) for (const piece of record.list.pieces) if (!pieces.has(piece.list)) pieces.set(piece.list, piece);
  return [...pieces.values()];
}

export function missingFiles(list, kinds, have) {
  return kinds.map(kind => ({ kind, name: list.files[kind] })).filter(file => !have.has(file.name));
}

export function recordsChanged(before, after) {
  const summary = records => JSON.stringify(records.map(r => [r.id, r.locked, r.list]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  return summary(before) !== summary(after);
}

const piecesText = count => (count === 1 ? '1 Stück' : `${count} Stücke`);

export function updateMessage({ offline = false, version = false, loaded = 0, failed = false, changed = false, pending = false } = {}) {
  if (offline && !version) return 'Keine Verbindung, gespeicherter Stand bleibt';
  const parts = [];
  if (version) parts.push('Neue Version geladen');
  if (loaded) parts.push(`${piecesText(loaded)} neu geladen`);
  if (pending) parts.push(parts.length ? 'der Rest lädt noch' : 'Neues lädt noch');
  else if (failed) parts.push(parts.length ? 'der Rest lädt mit Netz' : 'Nicht alles erreichbar, gespeicherter Stand bleibt');
  if (!parts.length) parts.push(changed ? 'Mappen aktualisiert' : 'Alles aktuell');
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

export function parseInstruments(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new FormatError('instruments are invalid');
  const ids = new Set();
  return value.map(item => {
    if (!isObject(item) || typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id) || !text(item.name, 60)) throw new FormatError('instrument is invalid');
    if (!Array.isArray(item.notations) || !item.notations.length || item.notations.some(n => !NOTATIONS.includes(n))) throw new FormatError('instrument is invalid');
    if (!Array.isArray(item.numbers) || !item.numbers.length || item.numbers.some(n => !ALL_NUMBERS.includes(n))) throw new FormatError('instrument is invalid');
    ids.add(item.id);
    return { id: item.id, name: item.name, notations: [...item.notations], numbers: [...item.numbers] };
  });
}

export function instrumentsFor(instruments, number) {
  return instruments.filter(item => item.numbers.includes(number));
}

export function validChoice(instruments, choice) {
  if (!isObject(choice) || !NUMBERS.includes(choice.number)) return null;
  const instrument = instruments.find(item => item.id === choice.instrument);
  if (!instrument || !instrument.numbers.includes(choice.number)) return null;
  return { number: choice.number, instrument };
}

export function numberLabel(number) {
  return number === 'Bass' ? 'Bass' : `${number} Stimme`;
}

const RAISED = new Set(['flute', 'accordion']);
const NOTE_NAMES = ['c', 'cis', 'd', 'es', 'e', 'f', 'fis', 'g', 'as', 'a', 'b', 'h'];

export function autoOctave(instrumentId, source, original) {
  return !original && RAISED.has(instrumentId) && typeof source === 'string' && source.endsWith(' C Bass') ? 1 : 0;
}

export function validOctave(value) {
  return Number.isInteger(value) && value >= -2 && value <= 2 ? value : null;
}

export function validRange(value) {
  if (!isObject(value)) return null;
  const { low, high } = value;
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 21 || high > 108 || high - low < 11) return null;
  return { low, high };
}

export function defaultRange(bass) {
  return bass ? { low: 36, high: 62 } : { low: 55, high: 81 };
}

export function stepRange(range, end, direction) {
  const next = { ...range, [end]: range[end] + direction };
  return validRange(next) ?? range;
}

export function octaveLabel(octave) {
  if (!octave) return 'normal';
  const amount = Math.abs(octave) === 1 ? '1 Oktave' : `${Math.abs(octave)} Oktaven`;
  return `${amount} ${octave > 0 ? 'höher' : 'tiefer'}`;
}

export function noteLabel(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  if (octave <= 2) return name[0].toUpperCase() + name.slice(1) + ','.repeat(Math.max(0, 2 - octave));
  return name + "'".repeat(octave - 3);
}

export function validSemitones(value) {
  return Number.isInteger(value) && value >= -6 && value <= 6 ? value : null;
}

export function boundedMap(value, check, max = 500) {
  const map = {};
  if (!isObject(value)) return map;
  for (const [key, entry] of Object.entries(value).slice(0, max)) if (key.length <= 100 && check(entry)) map[key] = entry;
  return map;
}
