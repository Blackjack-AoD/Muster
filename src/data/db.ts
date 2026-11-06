// Tiny IndexedDB wrapper: data files, repo sync state, saved rosters and saved units live on the phone.
import type { Roster, Sel } from './engine';

export interface FileHeader {
  kind: 'gameSystem' | 'catalogue';
  id: string;
  name: string;
  revision: number;
  gameSystemId?: string;
  library: boolean;
}
export interface FileMeta {
  path: string;
  sha: string;
  size: number;
  header: FileHeader | null;
}
export interface RepoState {
  repo: string; // owner/name
  branch?: string;
  commit?: string;
  syncedAt?: number;
  files: FileMeta[];
  error?: string;
}

/** A named unit build kept for one army file, so any list for that army can add it. */
export interface SavedUnit {
  id: string;
  /** a unique unit's name; '' for a preconfigured unit, which has none */
  name: string;
  /** absent for a unique unit, which a list holds at most once; a list holds a preconfigured unit any number of times */
  kind?: 'preconfigured';
  repo: string;
  gameSystemId: string;
  catalogueId: string;
  key: string;
  categoryId: string;
  build: Sel;
  created: number;
  updated: number;
}

const DB_NAME = 'muster';
const VERSION = 2;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('repos')) db.createObjectStore('repos', { keyPath: 'repo' });
      if (!db.objectStoreNames.contains('rosters')) db.createObjectStore('rosters', { keyPath: 'uid' });
      if (!db.objectStoreNames.contains('savedUnits')) db.createObjectStore('savedUnits', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        let result: T;
        if (r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

const fileKey = (repo: string, path: string) => `${repo}|${path}`;

export const db = {
  getFile: (repo: string, path: string) =>
    tx<string | undefined>('files', 'readonly', (s) => s.get(fileKey(repo, path))),
  putFile: (repo: string, path: string, text: string) =>
    tx('files', 'readwrite', (s) => {
      s.put(text, fileKey(repo, path));
    }),
  delFile: (repo: string, path: string) =>
    tx('files', 'readwrite', (s) => {
      s.delete(fileKey(repo, path));
    }),
  repos: () => tx<RepoState[]>('repos', 'readonly', (s) => s.getAll()),
  putRepo: (r: RepoState) =>
    tx('repos', 'readwrite', (s) => {
      s.put(r);
    }),
  delRepo: async (repo: string) => {
    const all = await db.repos();
    const r = all.find((x) => x.repo === repo);
    if (r) for (const f of r.files) await db.delFile(repo, f.path);
    await tx('repos', 'readwrite', (s) => {
      s.delete(repo);
    });
  },
  rosters: () => tx<Roster[]>('rosters', 'readonly', (s) => s.getAll()),
  putRoster: (r: Roster) =>
    tx('rosters', 'readwrite', (s) => {
      s.put(JSON.parse(JSON.stringify(r)));
    }),
  delRoster: (uid: string) =>
    tx('rosters', 'readwrite', (s) => {
      s.delete(uid);
    }),
  savedUnits: () => tx<SavedUnit[]>('savedUnits', 'readonly', (s) => s.getAll()),
  putSavedUnit: (u: SavedUnit) =>
    tx('savedUnits', 'readwrite', (s) => {
      s.put(JSON.parse(JSON.stringify(u)));
    }),
  delSavedUnit: (id: string) =>
    tx('savedUnits', 'readwrite', (s) => {
      s.delete(id);
    }),
};

/** Ask the browser not to clear our storage when space runs low. */
export async function persistStorage() {
  if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
}

export async function storageUse(): Promise<{ used: number; quota: number; persisted: boolean }> {
  const e = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { used: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}
