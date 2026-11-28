import { toBase64Url, binderPassword, binderKey } from '../lib/crypto.mjs';
import { loadBinder, newRecord, binderAccess } from './client.mjs';
import { fetchVault, unlock, reopen, remembered, loadLibrary, binderSecrets } from './editor-core.mjs';

export const ADMIN_KEY = 'adminBinders';
export const ALL_NAME = 'Alle';
const LOGIN_DB = 'staendchen-editor';
const LOCK = 'staendchen-admin';
const ID = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const NAME = /^x\/[A-Za-z0-9_-]{22}\.bin$/;
const MAX_BINDERS = 1000;
let memory = null;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function loginStore(mode, run) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOGIN_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('login');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('login', mode);
      const result = run(tx.objectStore('login'));
      tx.oncomplete = () => {
        db.close();
        resolve(result?.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

export const browserLogin = {
  load: () => (globalThis.indexedDB ? loginStore('readonly', s => s.get('login')).catch(() => null) : Promise.resolve(null)),
  save: value => (globalThis.indexedDB ? loginStore('readwrite', s => s.put(value, 'login')).catch(() => {}) : Promise.resolve()),
  forget: () => (globalThis.indexedDB ? loginStore('readwrite', s => s.clear()).catch(() => {}) : Promise.resolve()),
};

function exclusive(run) {
  const locks = globalThis.navigator?.locks;
  return locks?.request ? locks.request(LOCK, run) : run();
}

function needFetcher(fetcher) {
  if (typeof fetcher !== 'function') throw new TypeError('fetcher required');
  return fetcher;
}

export function readAdminMap(value) {
  const map = Object.create(null);
  if (!isObject(value)) return map;
  for (const [id, entry] of Object.entries(value).slice(0, MAX_BINDERS)) {
    if (!ID.test(id) || id.length > 80 || !isObject(entry)) continue;
    if (!Number.isSafeInteger(entry.keyVersion) || entry.keyVersion < 1 || typeof entry.record !== 'string' || !NAME.test(entry.record)) continue;
    map[id] = { keyVersion: entry.keyVersion, record: entry.record, own: entry.own === true };
  }
  return map;
}

const plain = map => Object.fromEntries(Object.entries(map));

export async function syncAdminBinders({ store, binders, keyFor, fetcher, now = Date.now() }) {
  needFetcher(fetcher);
  const map = readAdminMap(await store.get(ADMIN_KEY).catch(() => null));
  const records = new Set((await store.binders()).map(record => record?.id).filter(id => typeof id === 'string'));
  const current = new Set(binders.map(binder => binder.id));
  const next = Object.create(null);
  const persist = () => store.set(ADMIN_KEY, plain({ ...map, ...next }));
  const result = { added: 0, removed: 0, waiting: 0 };
  for (const binder of binders.slice(0, MAX_BINDERS)) {
    const entry = Object.hasOwn(map, binder.id) ? map[binder.id] : undefined;
    if (entry && entry.keyVersion === binder.keyVersion && records.has(entry.record)) {
      next[binder.id] = entry;
      continue;
    }
    let key;
    let loaded;
    try {
      key = await keyFor(binder);
      loaded = await loadBinder(fetcher, key);
    } catch {
      if (entry) next[binder.id] = entry;
      result.waiting += 1;
      continue;
    }
    if (records.has(loaded.id)) {
      next[binder.id] = { keyVersion: binder.keyVersion, record: loaded.id, own: entry?.record === loaded.id && entry.own };
    } else {
      next[binder.id] = { keyVersion: binder.keyVersion, record: loaded.id, own: true };
      await persist();
      await store.putBinder(newRecord(loaded.id, toBase64Url(key), loaded.list, now));
      records.add(loaded.id);
      result.added += 1;
    }
    if (entry?.own && entry.record !== loaded.id && records.has(entry.record)) {
      await store.deleteBinder(entry.record);
      records.delete(entry.record);
      result.removed += 1;
    }
  }
  for (const [id, entry] of Object.entries(map)) {
    if (current.has(id) || !entry.own || !records.has(entry.record)) continue;
    await store.deleteBinder(entry.record);
    records.delete(entry.record);
    result.removed += 1;
  }
  await store.set(ADMIN_KEY, plain(next));
  return result;
}

async function removeOwn(store) {
  const map = readAdminMap(await store.get(ADMIN_KEY).catch(() => null));
  if (!Object.keys(map).length) return;
  for (const entry of Object.values(map)) if (entry.own) await store.deleteBinder(entry.record).catch(() => {});
  await store.set(ADMIN_KEY, {}).catch(() => {});
}

async function session(fetcher, login) {
  needFetcher(fetcher);
  const saved = await login.load();
  if (!saved && !memory) return { offline: false, content: null };
  let vault;
  try {
    vault = await fetchVault(fetcher);
  } catch {
    return { offline: true, content: null };
  }
  if (memory && memory.salt === vault.salt) return { offline: false, content: memory.content };
  if (!saved) return { offline: false, content: null };
  const content = await reopen(vault, saved);
  if (!content) await login.forget();
  return { offline: false, content };
}

export async function tryAdminLogin(password, { fetcher, remember = true, login = browserLogin } = {}) {
  needFetcher(fetcher);
  if (typeof password !== 'string' || !password.trim()) return false;
  try {
    const vault = await fetchVault(fetcher);
    const { key, content } = await unlock(vault, password);
    if (remember) {
      await login.save(remembered(vault, key));
      memory = null;
    } else {
      memory = { salt: vault.salt, content };
    }
    return true;
  } catch {
    return false;
  }
}

export async function isAdmin({ fetcher, login = browserLogin } = {}) {
  return Boolean((await session(fetcher, login)).content);
}

export function allPiecesList(library) {
  const pieces = [...library.pieces.values()].filter(piece => piece.key && piece.list && piece.mark)
    .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id))
    .map(piece => ({ id: piece.id, title: piece.title, mark: piece.mark, key: piece.key, list: piece.list, ...(piece.octaves ? { octaves: { ...piece.octaves } } : {}) }));
  return { version: 1, name: ALL_NAME, created: library.published, published: library.published, pieces };
}

export async function adminStart({ store, fetcher, login = browserLogin, derive } = {}) {
  return exclusive(async () => {
    const { offline, content } = await session(fetcher, login);
    if (!content) {
      if (!offline && store) await removeOwn(store);
      return null;
    }
    try {
      const library = await loadLibrary(fetcher, content.master);
      const keyFor = async binder => (await binderSecrets(content.master, binder, derive)).key;
      const synced = store ? await syncAdminBinders({ store, binders: [...library.binders.values()], keyFor, fetcher }) : null;
      return { synced, all: allPiecesList(library), failed: false };
    } catch {
      return { synced: null, all: null, failed: true };
    }
  });
}

export async function adminLogout({ store, login = browserLogin } = {}) {
  return exclusive(async () => {
    memory = null;
    await login.forget();
    if (store) await removeOwn(store);
  });
}

export function adminExclusive(run) {
  return exclusive(run);
}

export async function syncAll({ store, fetcher, login = browserLogin, derive } = {}) {
  return (await adminStart({ store, fetcher, login, derive }))?.synced ?? null;
}

export async function allPieces({ fetcher, login = browserLogin } = {}) {
  return (await adminStart({ fetcher, login }))?.all ?? null;
}

export async function adminPassword(recordId, { store, fetcher, login = browserLogin, derive = binderKey } = {}) {
  if (!store || typeof recordId !== 'string' || !NAME.test(recordId)) return null;
  const { content } = await session(fetcher, login);
  if (!content) return null;
  const map = readAdminMap(await store.get(ADMIN_KEY).catch(() => null));
  const found = Object.entries(map).find(([, entry]) => entry.record === recordId);
  if (!found) return null;
  const password = await binderPassword(content.master, found[0], found[1].keyVersion);
  const { name } = await binderAccess(await derive(password));
  return name === recordId ? password : null;
}
