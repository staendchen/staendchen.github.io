const DB_NAME = 'staendchen';
const BINDERS = 'binders';
const SETTINGS = 'settings';

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BINDERS)) db.createObjectStore(BINDERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function memoryStore() {
  const binders = new Map();
  const settings = new Map();
  const copy = value => structuredClone(value);
  return {
    persistent: false,
    binders: async () => [...binders.values()].map(copy).sort((a, b) => a.added - b.added),
    putBinder: async record => void binders.set(record.id, copy(record)),
    updateBinder: async record => {
      if (!binders.has(record.id)) return false;
      binders.set(record.id, copy(record));
      return true;
    },
    deleteBinder: async id => void binders.delete(id),
    get: async key => copy(settings.get(key)),
    set: async (key, value) => void settings.set(key, copy(value)),
  };
}

export async function openStore() {
  let db;
  try {
    db = await openDb();
  } catch {
    return memoryStore();
  }
  const run = async (store, mode, action) => {
    const tx = db.transaction(store, mode);
    const result = await request(action(tx.objectStore(store)));
    if (mode === 'readwrite') {
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }
    return result;
  };
  const update = record => new Promise((resolve, reject) => {
    const tx = db.transaction(BINDERS, 'readwrite');
    const store = tx.objectStore(BINDERS);
    let kept = false;
    const get = store.getKey(record.id);
    get.onsuccess = () => {
      if (get.result === undefined) return;
      kept = true;
      store.put(record);
    };
    tx.oncomplete = () => resolve(kept);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return {
    persistent: true,
    binders: async () => (await run(BINDERS, 'readonly', s => s.getAll())).sort((a, b) => a.added - b.added),
    putBinder: record => run(BINDERS, 'readwrite', s => s.put(record)),
    updateBinder: record => update(record),
    deleteBinder: id => run(BINDERS, 'readwrite', s => s.delete(id)),
    get: key => run(SETTINGS, 'readonly', s => s.get(key)),
    set: (key, value) => run(SETTINGS, 'readwrite', s => s.put(value, key)),
  };
}
