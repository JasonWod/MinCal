// Local-first persistence layer backed by IndexedDB.
// This is the source of truth for the app: events live here and work fully
// offline. Server sync (lib/api.ts) is an optional mirror on top of this.
//
// No external dependencies — raw IndexedDB wrapped in Promises, so the
// Windows cross-compile picks up zero new packages.

import type { EventItem } from "./types";

const DB_NAME = "mincal";
const DB_VERSION = 1;
const STORE = "events";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("start_time", "start_time");
        store.createIndex("owner_id", "owner_id");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** Read every locally stored event. */
export async function getAllLocalEvents(): Promise<EventItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, "readonly").getAll();
    req.onsuccess = () => resolve((req.result as EventItem[]) || []);
    req.onerror = () => reject(req.error || new Error("Failed to read events"));
  });
}

/** Insert or replace a single event (keyed by id). */
export async function putLocalEvent(event: EventItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(event);
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
    t.onerror = () => reject(t.error || new Error("Failed to write event"));
  });
}

/** Bulk insert/replace — used when importing a full server snapshot locally. */
export async function putAllLocalEvents(events: EventItem[]): Promise<void> {
  if (events.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    for (const e of events) store.put(e);
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
    t.onerror = () => reject(t.error || new Error("Failed to bulk-write events"));
  });
}

/** Delete a single event by id (no-op if absent). */
export async function deleteLocalEvent(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
    t.onerror = () => reject(t.error || new Error("Failed to delete event"));
  });
}

/** Wipe all local events (e.g. "clear offline data"). */
export async function clearLocalEvents(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error || new Error("Storage transaction aborted"));
    t.onerror = () => reject(t.error || new Error("Failed to clear events"));
  });
}
