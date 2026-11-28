import { validTempo } from '../lib/tempo.mjs';
import {
  decodeKey, editorKey, fileKeys, fileName, decryptFile, binderPassword, binderKey, binderLink, vaultKey, openVaultWithKey,
} from '../lib/crypto.mjs';

export const INBOX = { repo: 'staendchen/inbox', branch: 'main', folder: 'submissions' };
export const IDLE_MS = 30 * 60 * 1000;
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
export const SUBMISSION_ID = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;
export const MAX_SCORE = 16 * 1024 * 1024;
export const LIMITS = { library: 16 * 1024 * 1024, mscz: 64 * 1024 * 1024, vault: 64 * 1024, json: 256 * 1024 };
export const PALETTE = ['#c9a227', '#c0392b', '#2e8b57', '#7b4fa0', '#2f6db5', '#d35400', '#16a085', '#8e5b3a', '#d63384', '#5d6d7e'];
export const NOTATIONS = ['C', 'B', 'Es', 'F', 'C Bass'];
export const STATUS_LABELS = { draft: 'in Arbeit', checked: 'geprüft' };
const ID = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const HEX = /^[0-9a-f]{64}$/;
const NAME = /^x\/[A-Za-z0-9_-]{22}\.bin$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
const COLOR = /^#[0-9a-f]{6}$/;
const TOKEN = /^github_pat_[A-Za-z0-9_]{60,120}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class EditorError extends Error {
  name = 'EditorError';
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && value.length <= 80 && ID.test(value);
const validTime = value => typeof value === 'string' && TIME.test(value) && Number.isFinite(Date.parse(value));
export const cleanText = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && value.trim() === value && !UNSAFE.test(value);
const idList = (value, max = 5000) => Array.isArray(value) && value.length <= max && value.every(validId) && new Set(value).size === value.length;
const textList = (value, max) => Array.isArray(value) && value.length <= 200 && value.every(item => cleanText(item, max)) && new Set(value).size === value.length;

export function vaultContent(value) {
  if (!isObject(value) || typeof value.master !== 'string' || !KEY.test(value.master)) throw new EditorError('Der Tresor hat nicht die erwartete Form');
  const token = typeof value.inboxToken === 'string' && TOKEN.test(value.inboxToken) ? value.inboxToken : null;
  return { master: decodeKey(value.master), token };
}

export async function fetchVault(fetcher) {
  let response;
  try {
    response = await fetcher('vault.json', { cache: 'no-store' });
  } catch {
    throw new EditorError('Keine Verbindung. Bitte Internet prüfen.');
  }
  if (!response.ok) throw new EditorError('Der Tresor fehlt auf der Seite.');
  const text = await response.text();
  if (text.length > LIMITS.vault) throw new EditorError('Der Tresor ist zu groß.');
  try {
    return JSON.parse(text);
  } catch {
    throw new EditorError('Der Tresor ist beschädigt.');
  }
}

export async function unlock(vault, password) {
  const key = await vaultKey(vault, password);
  try {
    return { key, content: vaultContent(await openVaultWithKey(vault, key)) };
  } catch (error) {
    if (error?.message === 'wrong password') throw new EditorError('Passwort falsch');
    throw error;
  }
}

export async function reopen(vault, saved, now = Date.now()) {
  if (!isObject(saved) || !(saved.key instanceof CryptoKey) || saved.salt !== vault?.salt || saved.rounds !== vault?.rounds || !(saved.expires > now)) return null;
  try {
    return vaultContent(await openVaultWithKey(vault, saved.key));
  } catch {
    return null;
  }
}

export const remembered = (vault, key, now = Date.now()) => ({ key, salt: vault.salt, rounds: vault.rounds, expires: now + REMEMBER_MS });

export async function gunzip(data, max) {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new EditorError('Datei zu groß');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof EditorError) throw error;
    throw new EditorError('Datei beschädigt');
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function fetchSealed(fetcher, keys, kind, name, max) {
  if (!NAME.test(name)) throw new EditorError('Ungültiger Dateiname');
  let response;
  try {
    response = await fetcher(`${name}?fresh`, { cache: 'no-cache' });
  } catch {
    throw new EditorError('Keine Verbindung. Bitte Internet prüfen.');
  }
  if (response.status === 404) throw new EditorError('Die Datei gibt es (noch) nicht. Ist schon veröffentlicht worden?');
  if (!response.ok) throw new EditorError(`Die Seite antwortet mit ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.length > max + 1024) throw new EditorError('Datei zu groß');
  let plain;
  try {
    plain = await decryptFile(keys, kind, name, data);
  } catch {
    throw new EditorError('Die Datei lässt sich nicht entschlüsseln');
  }
  return gunzip(plain, max);
}

function parsePiece(value) {
  if (!isObject(value) || !validId(value.id) || !cleanText(value.title, 200) || !idList(value.collections, 100) || !textList(value.occasions, 60)
    || !Object.hasOwn(STATUS_LABELS, value.status) || !['score', 'melody'].includes(value.kind) || !Array.isArray(value.parts)
    || value.parts.length > 64 || !value.parts.every(part => cleanText(part, 40)) || typeof value.state !== 'string' || value.state.length > 20) {
    throw new EditorError('Ein Stück in der Bibliothek hat nicht die erwartete Form');
  }
  const piece = {
    id: value.id, title: value.title, collections: [...value.collections], occasions: [...value.occasions], status: value.status,
    kind: value.kind, parts: [...value.parts], state: value.state,
  };
  if (Object.hasOwn(value, 'octaves')) {
    const octaves = value.octaves;
    if (!isObject(octaves) || !Object.entries(octaves).every(([id, octave]) => validId(id) && Number.isSafeInteger(octave) && octave !== 0 && octave >= -2 && octave <= 2)) {
      throw new EditorError('Ein Stück in der Bibliothek hat ungültige Oktaven');
    }
    piece.octaves = { ...octaves };
  }
  if (Object.hasOwn(value, 'tempo')) {
    if (!validTempo(value.tempo)) throw new EditorError('Ein Stück in der Bibliothek hat ein ungültiges Tempo');
    piece.tempo = { beat: value.tempo.beat, bpm: value.tempo.bpm };
  }
  if (typeof value.source === 'string' && HEX.test(value.source)) piece.source = value.source;
  if (typeof value.mscz === 'string' && NAME.test(value.mscz)) piece.mscz = value.mscz;
  if (typeof value.key === 'string' && KEY.test(value.key) && typeof value.list === 'string' && NAME.test(value.list) && typeof value.mark === 'string' && /^[0-9a-f]{16}$/.test(value.mark)) {
    piece.key = value.key;
    piece.list = value.list;
    piece.mark = value.mark;
  }
  return piece;
}

export function parseLibrary(value) {
  if (!isObject(value) || value.version !== 1 || !validTime(value.published) || !Array.isArray(value.collections) || !Array.isArray(value.pieces) || !Array.isArray(value.binders)) {
    throw new EditorError('Die Bibliothek hat nicht die erwartete Form');
  }
  const collections = value.collections.map(c => {
    if (!isObject(c) || !validId(c.id) || !cleanText(c.name, 40) || typeof c.color !== 'string' || !COLOR.test(c.color)) throw new EditorError('Eine Sammlung hat nicht die erwartete Form');
    return { id: c.id, name: c.name, color: c.color };
  });
  const pieces = new Map();
  for (const item of value.pieces) {
    const piece = parsePiece(item);
    pieces.set(piece.id, piece);
  }
  const binders = new Map();
  for (const b of value.binders) {
    if (!isObject(b) || !validId(b.id) || !cleanText(b.name, 100) || !idList(b.pieces) || !Number.isSafeInteger(b.keyVersion) || b.keyVersion < 1 || !validTime(b.keyCreated)) {
      throw new EditorError('Eine Mappe hat nicht die erwartete Form');
    }
    binders.set(b.id, { id: b.id, name: b.name, pieces: [...b.pieces], keyVersion: b.keyVersion, keyCreated: b.keyCreated });
  }
  const instruments = (Array.isArray(value.instruments) ? value.instruments : [])
    .filter(item => isObject(item) && validId(item.id) && cleanText(item.name, 40))
    .map(item => ({ id: item.id, name: item.name }));
  return { published: value.published, collections, instruments, pieces, binders };
}

export async function editorAccess(master) {
  const keys = await fileKeys(await editorKey(master), 'editor');
  return { keys, library: await fileName(keys, 'library') };
}

export async function loadLibrary(fetcher, master) {
  const access = await editorAccess(master);
  const bytes = await fetchSealed(fetcher, access.keys, 'library', access.library, LIMITS.library);
  let value;
  try {
    value = JSON.parse(utf8.decode(bytes));
  } catch {
    throw new EditorError('Die Bibliothek ist kein JSON');
  }
  return parseLibrary(value);
}

export async function binderSecrets(master, binder, derive = binderKey) {
  const password = await binderPassword(master, binder.id, binder.keyVersion);
  const key = await derive(password);
  return { password, key, link: binderLink(key) };
}

const randomHex = (bytes, random) => Array.from(random(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
const defaultRandom = array => globalThis.crypto.getRandomValues(array);

export function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function newSubmissionId(date = new Date(), random = defaultRandom) {
  return `${stamp(date).replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${randomHex(3, random)}`;
}

export function slugFrom(text) {
  return String(text ?? '').normalize('NFC').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').slice(0, 50).replace(/_+$/, '');
}

export function uniqueId(name, taken, { random = defaultRandom, suffix = false } = {}) {
  const stem = slugFrom(name) || 'neu';
  const tail = () => {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    return Array.from(random(new Uint8Array(4)), b => alphabet[b % alphabet.length]).join('');
  };
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = suffix || attempt > 0 ? `${stem}_${tail()}` : stem;
    if (!taken.has(id)) return id;
  }
  throw new EditorError('Keine freie Kennung gefunden');
}

const clone = value => JSON.parse(JSON.stringify(value));

export function cloneState(state) {
  return {
    published: state.published,
    collections: clone(state.collections),
    instruments: clone(state.instruments ?? []),
    pieces: new Map([...state.pieces].map(([id, piece]) => [id, clone(piece)])),
    binders: new Map([...state.binders].map(([id, binder]) => [id, clone(binder)])),
  };
}

export function applyOps(base, ops) {
  const state = cloneState(base);
  for (const op of ops) {
    const collection = state.collections.find(c => c.id === op.id);
    switch (op.op) {
      case 'piece': {
        const piece = state.pieces.get(op.id);
        if (piece) {
          for (const key of ['title', 'status', 'collections', 'occasions']) if (Object.hasOwn(op, key)) piece[key] = clone(op[key]);
          for (const key of ['tempo', 'octaves']) {
            if (!Object.hasOwn(op, key)) continue;
            if (op[key] === null) delete piece[key];
            else piece[key] = clone(op[key]);
          }
        }
        break;
      }
      case 'collection-create':
        if (!collection) state.collections.push({ id: op.id, name: op.name, color: op.color });
        break;
      case 'collection':
        if (collection) for (const key of ['name', 'color']) if (Object.hasOwn(op, key)) collection[key] = op[key];
        break;
      case 'collection-octave':
        for (const piece of state.pieces.values()) {
          if (!piece.collections.includes(op.id)) continue;
          const octaves = { ...(piece.octaves ?? {}) };
          if (op.octave) octaves[op.instrument] = op.octave;
          else delete octaves[op.instrument];
          if (Object.keys(octaves).length) piece.octaves = octaves;
          else delete piece.octaves;
        }
        break;
      case 'collection-delete':
        state.collections = state.collections.filter(c => c.id !== op.id);
        break;
      case 'binder-create':
        if (!state.binders.has(op.id)) state.binders.set(op.id, { id: op.id, name: op.name, pieces: [...op.pieces], keyVersion: 1, keyCreated: null });
        break;
      case 'binder': {
        const binder = state.binders.get(op.id);
        if (binder) for (const key of ['name', 'pieces']) if (Object.hasOwn(op, key)) binder[key] = clone(op[key]);
        break;
      }
      case 'binder-renew': {
        const binder = state.binders.get(op.id);
        if (binder) {
          binder.keyVersion = op.keyVersion;
          binder.keyCreated = null;
        }
        break;
      }
      case 'binder-delete':
        state.binders.delete(op.id);
        break;
      default:
        break;
    }
  }
  return state;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class Draft {
  constructor(entries = []) {
    this.entries = [];
    for (const entry of entries) if (isObject(entry) && typeof entry.op === 'string' && validId(entry.id)) this.entries.push(clone(entry));
  }

  find(op, id) {
    return this.entries.find(entry => entry.op === op && entry.id === id);
  }

  drop(op, id) {
    this.entries = this.entries.filter(entry => !(entry.op === op && entry.id === id));
  }

  setPiece(base, id, key, value) {
    const original = base.pieces.get(id);
    if (!original) return;
    let entry = this.find('piece', id);
    if (!entry) {
      entry = { op: 'piece', id };
      this.entries.push(entry);
    }
    if (same(original[key] ?? null, value ?? null)) delete entry[key];
    else entry[key] = clone(value ?? null);
    if (Object.keys(entry).length === 2) this.drop('piece', id);
  }

  createCollection(base, name, color) {
    const taken = new Set([...base.collections.map(c => c.id), ...this.entries.map(e => e.id)]);
    const id = uniqueId(name, taken);
    this.entries.push({ op: 'collection-create', id, name, color });
    return id;
  }

  setCollection(base, id, key, value) {
    const created = this.find('collection-create', id);
    if (created) {
      created[key] = value;
      return;
    }
    const original = base.collections.find(c => c.id === id);
    if (!original) return;
    let entry = this.find('collection', id);
    if (!entry) {
      entry = { op: 'collection', id };
      this.entries.push(entry);
    }
    if (original[key] === value) delete entry[key];
    else entry[key] = value;
    if (Object.keys(entry).length === 2) this.drop('collection', id);
  }

  setCollectionOctave(id, instrument, octave) {
    this.entries = this.entries.filter(entry => !(entry.op === 'collection-octave' && entry.id === id && entry.instrument === instrument));
    this.entries.push({ op: 'collection-octave', id, instrument, octave });
  }

  deleteCollection(id) {
    const created = this.find('collection-create', id);
    this.drop('collection', id);
    this.drop('collection-create', id);
    if (!created) this.entries.push({ op: 'collection-delete', id });
  }

  createBinder(base, name, taken = new Set()) {
    const all = new Set([...base.binders.keys(), ...this.entries.map(e => e.id), ...taken]);
    const id = uniqueId(name, all, { suffix: true });
    this.entries.push({ op: 'binder-create', id, name, pieces: [] });
    return id;
  }

  setBinder(base, id, key, value) {
    const created = this.find('binder-create', id);
    if (created) {
      created[key] = clone(value);
      return;
    }
    const original = base.binders.get(id);
    if (!original) return;
    let entry = this.find('binder', id);
    if (!entry) {
      entry = { op: 'binder', id };
      this.entries.push(entry);
    }
    if (same(original[key], value)) delete entry[key];
    else entry[key] = clone(value);
    if (Object.keys(entry).length === 2) this.drop('binder', id);
  }

  renewBinder(base, id) {
    const original = base.binders.get(id);
    if (!original || this.find('binder-create', id) || this.find('binder-renew', id) || this.find('binder-delete', id)) return false;
    this.entries.push({ op: 'binder-renew', id, keyVersion: original.keyVersion + 1 });
    return true;
  }

  deleteBinder(id) {
    const created = this.find('binder-create', id);
    for (const op of ['binder', 'binder-renew', 'binder-create']) this.drop(op, id);
    if (!created) this.entries.push({ op: 'binder-delete', id });
  }

  ops() {
    const order = ['collection-create', 'collection', 'collection-octave', 'piece', 'binder-create', 'binder', 'binder-renew', 'binder-delete', 'collection-delete'];
    return order.flatMap(op => this.entries.filter(entry => entry.op === op)).map(clone);
  }

  get count() {
    return this.entries.length;
  }

  clear() {
    this.entries = [];
  }

  removeSent(ops) {
    const sent = new Set(ops.map(op => JSON.stringify(op)));
    this.entries = this.entries.filter(entry => !sent.has(JSON.stringify(entry)));
  }
}

export function problemsOf(state) {
  const problems = [];
  const names = new Set();
  for (const binder of state.binders.values()) {
    if (!cleanText(binder.name, 100)) problems.push('Jede Mappe braucht einen Namen (bis 100 Zeichen)');
    else if (names.has(binder.name)) problems.push(`Den Mappen-Namen „${binder.name}“ gibt es zweimal`);
    names.add(binder.name);
  }
  const collectionNames = new Set();
  for (const collection of state.collections) {
    if (!cleanText(collection.name, 40)) problems.push('Jede Sammlung braucht einen Namen (bis 40 Zeichen)');
    else if (collectionNames.has(collection.name)) problems.push(`Den Sammlungs-Namen „${collection.name}“ gibt es zweimal`);
    collectionNames.add(collection.name);
  }
  for (const piece of state.pieces.values()) if (!cleanText(piece.title, 200)) problems.push('Jedes Stück braucht einen Titel (bis 200 Zeichen)');
  return [...new Set(problems)];
}

export function changesSubmission(id, ops, date = new Date()) {
  if (!SUBMISSION_ID.test(id) || !Array.isArray(ops) || ops.length === 0) throw new EditorError('Nichts zu veröffentlichen');
  return { format: 1, id, kind: 'changes', created: stamp(date), changes: ops };
}

export function fileProblem(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return 'Bitte eine Datei wählen.';
  if (bytes.length > MAX_SCORE) return 'Die Datei ist zu groß (höchstens 16 MB).';
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return 'Das ist keine MuseScore-Datei (.mscz).';
  return null;
}

export const KINDS = {
  'new-melody': { button: 'Neues Stück aus einer Melodie', file: 'Melodie', isNew: true, text: 'Eine Melodie ist nur die Hauptstimme, mit genau einer Stimme wie „Melodie B“. Die App gibt sie jedem Musiker in seinem Notenbild, Posaunen und Tuben eine Oktave tiefer. Das Stück gilt als Melodie-Stück, bis eine fertige Partitur kommt.' },
  'new-score': { button: 'Neues Stück als fertige Partitur', file: 'Partitur', isNew: true, text: 'Eine Partitur mit Stimmen nach dem Schema Nummer plus Notenbild, etwa „1. B“ oder „3. C Bass“. Fehlende Notenbilder schreibt die App selbst um.' },
  melody: { button: 'Melodie hochladen', file: 'Melodie', isNew: false, text: 'Die geänderte Melodie ersetzt die bisherige. Musiker sehen das Stück danach als „geändert“.' },
  score: { button: 'Partitur hochladen', file: 'Partitur', isNew: false, text: 'Die Partitur wird genommen, wie sie ist. Kennung, Sammlungen und Mappen bleiben. Hatte das Stück nur eine Melodie, ist es danach ein Partitur-Stück. Musiker sehen es als „geändert“.' },
};

export function fileSubmission({ id, kind, title, collections, piece, date = new Date() }) {
  if (!SUBMISSION_ID.test(id) || !Object.hasOwn(KINDS, kind)) throw new EditorError('Ungültige Einsendung');
  const base = { format: 1, id, kind, created: stamp(date) };
  if (KINDS[kind].isNew) {
    if (!cleanText(title, 200)) throw new EditorError('Bitte einen Titel eingeben (ohne Leerzeichen am Rand).');
    if (!slugFrom(title)) throw new EditorError('Der Titel braucht mindestens einen Buchstaben oder eine Ziffer.');
    if (!idList(collections, 100)) throw new EditorError('Ungültige Sammlungen');
    return { ...base, title, collections: [...collections] };
  }
  if (!piece || !validId(piece.id)) throw new EditorError('Ungültiges Stück');
  if (!piece.source) throw new EditorError('Die Prüfsumme der aktuellen Fassung fehlt in der Bibliothek. Bitte warten, bis veröffentlicht ist.');
  return { ...base, piece: piece.id, base: piece.source };
}

export function titleFromFile(name) {
  return String(name ?? '').replace(/\.mscz$/i, '').replace(/^4 Posaune C - /, '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class GitHubError extends Error {
  name = 'GitHubError';
}

export function github(token, fetcher = globalThis.fetch.bind(globalThis)) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new EditorError('Im Tresor fehlt der Zugang zum Eingang. Bitte tools/vault-token.mjs ausführen.');
  return async (method, path, body) => {
    if (path.includes('..') || !/^\/(?:git\/(?:ref\/heads|refs\/heads|commits|trees|blobs)\/[A-Za-z0-9._/-]+(?:\?recursive=1)?|git\/(?:trees|blobs|commits))$/.test(path)) throw new EditorError('Ungültiger Pfad');
    let response;
    try {
      response = await fetcher(`https://api.github.com/repos/${INBOX.repo}${path}`, {
        method,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      });
    } catch {
      throw new GitHubError('Keine Verbindung zu GitHub. Bitte Internet prüfen und nochmal versuchen.');
    }
    if (response.ok) return response.status === 204 ? null : response.json();
    const error = new GitHubError(response.status === 401 ? 'Der Zugang zum Eingang ist ungültig. Token im Tresor erneuern.'
      : response.status === 403 || response.status === 404 ? 'Kein Zugriff auf den Eingang.'
        : `GitHub meldet einen Fehler (${response.status}). Bitte später nochmal versuchen.`);
    error.status = response.status;
    throw error;
  };
}

export async function commitFiles(gh, files, message) {
  for (const file of files) {
    if (typeof file.path !== 'string' || !new RegExp(`^${INBOX.folder}/[0-9]{8}-[0-9]{6}-[0-9a-f]{6}/(?:submission\\.json|file\\.mscz|status\\.json)$`).test(file.path)) {
      throw new EditorError('Ungültiger Pfad im Eingang');
    }
  }
  const entries = [];
  for (const file of files) {
    if (file.remove) {
      entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = file.base64 !== undefined
      ? await gh('POST', '/git/blobs', { content: file.base64, encoding: 'base64' })
      : await gh('POST', '/git/blobs', { content: file.text, encoding: 'utf-8' });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (let attempt = 1; ; attempt += 1) {
    const ref = await gh('GET', `/git/ref/heads/${INBOX.branch}`);
    const head = await gh('GET', `/git/commits/${ref.object.sha}`);
    const tree = await gh('POST', '/git/trees', { base_tree: head.tree.sha, tree: entries });
    const created = await gh('POST', '/git/commits', { message, tree: tree.sha, parents: [head.sha] });
    try {
      await gh('PATCH', `/git/refs/heads/${INBOX.branch}`, { sha: created.sha, force: false });
      return created.sha;
    } catch (error) {
      if (error.status === 422 && attempt < 4) continue;
      throw error;
    }
  }
}

export async function submit(gh, submission, scoreBytes) {
  const folder = `${INBOX.folder}/${submission.id}`;
  const files = [{ path: `${folder}/submission.json`, text: `${JSON.stringify(submission, null, 2)}\n` }];
  if (scoreBytes) files.unshift({ path: `${folder}/file.mscz`, base64: toBase64(scoreBytes) });
  return commitFiles(gh, files, `Submission ${submission.id}`);
}

export function submittedFolders(tree, limit = 20) {
  const folders = new Map();
  const pattern = new RegExp(`^${INBOX.folder}/([0-9]{8}-[0-9]{6}-[0-9a-f]{6})/(submission\\.json|file\\.mscz|status\\.json)$`);
  for (const entry of Array.isArray(tree) ? tree : []) {
    const match = pattern.exec(entry?.path);
    if (!match || entry.type !== 'blob' || typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) continue;
    if (!folders.has(match[1])) folders.set(match[1], { id: match[1], files: {} });
    folders.get(match[1]).files[match[2]] = { path: entry.path, sha: entry.sha, size: entry.size };
  }
  return [...folders.values()].sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
}

export async function readBlobJson(gh, file) {
  if (!file || !(file.size <= LIMITS.json)) return null;
  const blob = await gh('GET', `/git/blobs/${file.sha}`);
  if (blob?.encoding !== 'base64' || typeof blob.content !== 'string') return null;
  try {
    const raw = atob(blob.content.replace(/\s/g, ''));
    return JSON.parse(utf8.decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

const STATES = { pending: 'Wird geprüft', accepted: 'Übernommen', rejected: 'Abgelehnt', error: 'Problem bei der Prüfung' };

export function describeSubmission(raw, status, state, now = Date.now()) {
  const s = isObject(raw) ? raw : {};
  const st = isObject(status) && Object.hasOwn(STATES, status.status) && status.status !== 'pending' ? status.status : 'pending';
  const created = validTime(s.created) ? Date.parse(s.created) : null;
  const pieceTitle = id => (validId(id) && state?.pieces.get(id)?.title) || id || '?';
  let what;
  if (s.kind === 'changes') {
    const n = Array.isArray(s.changes) ? s.changes.length : 0;
    what = `${n} ${n === 1 ? 'Änderung' : 'Änderungen'}`;
  } else if (s.kind === 'new-melody' || s.kind === 'new-score') {
    what = `${s.kind === 'new-melody' ? 'Neue Melodie' : 'Neue Partitur'}: ${typeof s.title === 'string' ? s.title.slice(0, 200) : '?'}`;
  } else if (s.kind === 'melody' || s.kind === 'score') {
    what = `${s.kind === 'melody' ? 'Geänderte Melodie' : 'Fertige Partitur'}: ${pieceTitle(s.piece)}`;
  } else {
    what = 'Einsendung';
  }
  const late = st === 'pending' && created !== null && now - created > 30 * 60 * 1000;
  const note = isObject(status) && typeof status.text === 'string' ? status.text.slice(0, 500) : late ? 'Das dauert ungewöhnlich lange. Im Matrix-Raum oder unter Actions nachsehen.' : '';
  const piece = st === 'accepted' && isObject(status) && validId(status.piece) ? status.piece : null;
  return { what, time: created, status: st, label: STATES[st], note, piece, finished: st !== 'pending', statusTime: isObject(status) && validTime(status.time) ? status.time : null };
}

export function keepSubmitted(entries, statuses, published, now = Date.now()) {
  return entries.filter(entry => {
    const status = statuses.get(entry.id);
    if (now - entry.time > 24 * 60 * 60 * 1000) return false;
    if (!status) return true;
    if (status.status === 'rejected' || status.status === 'error') return false;
    if (status.status === 'accepted') {
      if (Date.parse(published) >= entry.time - 2 * 60 * 1000) return false;
      return !(status.statusTime && now > Date.parse(status.statusTime) + 2 * 60 * 60 * 1000);
    }
    return true;
  });
}

export function qualityOf(piece) {
  return piece.kind === 'melody' ? 'Melodie' : 'Partitur';
}

export function partTable(parts) {
  const rows = new Map();
  for (const name of parts) {
    const match = /^(1\.|2\.|3\.|4\.|Bass|Melodie) (C|B|Es|F|C Bass)$/.exec(name);
    if (!match) continue;
    if (!rows.has(match[1])) rows.set(match[1], new Set());
    rows.get(match[1]).add(match[2]);
  }
  const order = ['1.', '2.', '3.', '4.', 'Bass', 'Melodie'];
  return order.filter(number => rows.has(number)).map(number => ({ number, notations: NOTATIONS.map(n => rows.get(number).has(n)) }));
}

export function formatDate(value, withTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  const options = withTime ? { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'numeric', year: 'numeric' };
  return date.toLocaleString('de-AT', options);
}

export function previewParts(parts) {
  const concert = parts.filter(name => /^(?:1\.|2\.|3\.|4\.|Bass|Melodie) (?:C|C Bass)$/.test(name));
  return concert.length ? concert : [...parts];
}
