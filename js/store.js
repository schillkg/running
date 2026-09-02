const DB_NAME = "my-training";
const DB_VERSION = 1;
const STORE_NAME = "app-state";
const STATE_KEY = "state";
let databasePromise;
let writeQueue = Promise.resolve();

export class StaleStateError extends Error {
  constructor(message = "Training data changed in another tab.") {
    super(message);
    this.name = "StaleStateError";
  }
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("Private device storage is unavailable in this browser."));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open device storage."));
    request.onblocked = () => reject(new Error("Device storage is blocked by another open version of the app."));
  });
  return databasePromise;
}

function transaction(mode, operation) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    try {
      result = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error ?? new Error("Device storage failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Device storage was interrupted."));
  }));
}

export function loadState() {
  return transaction("readonly", (store) => store.get(STATE_KEY));
}

function compareAndPut(snapshot, expectedRevision) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let stale = false;
    const request = store.get(STATE_KEY);

    request.onsuccess = () => {
      const currentRevision = Number(request.result?.revision ?? 0);
      if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
        stale = true;
        tx.abort();
        return;
      }
      store.put(snapshot, STATE_KEY);
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(stale ? new StaleStateError() : tx.error ?? new Error("Device storage failed."));
    tx.onabort = () => reject(stale ? new StaleStateError() : tx.error ?? new Error("Device storage was interrupted."));
  }));
}

export function saveState(state, expectedRevision) {
  const snapshot = structuredClone(state);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => compareAndPut(snapshot, expectedRevision));
  return writeQueue;
}

export function clearState() {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => transaction("readwrite", (store) => store.delete(STATE_KEY)));
  return writeQueue;
}
