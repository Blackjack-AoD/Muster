import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, persistStorage, storageUse } from './db';
import type { SavedUnit } from './db';
import type { Roster } from './engine';

const roster = (uid: string) => ({ uid, name: 'List', forces: [] }) as unknown as Roster;

afterEach(() => vi.unstubAllGlobals());

describe('files', () => {
  it('stores, replaces, and deletes, keeping repos apart', async () => {
    await db.putFile('a/b', 'x.cat', 'one');
    await db.putFile('a/c', 'x.cat', 'other');
    await db.putFile('a/b', 'x.cat', 'two');
    expect(await db.getFile('a/b', 'x.cat')).toBe('two');
    await db.delFile('a/b', 'x.cat');
    expect(await db.getFile('a/b', 'x.cat')).toBeUndefined();
    expect(await db.getFile('a/c', 'x.cat')).toBe('other');
  });
});

describe('repos', () => {
  it('deleting a repo deletes its files too', async () => {
    await db.putFile('del/a', 'x.cat', 'x');
    await db.putRepo({ repo: 'del/a', files: [{ path: 'x.cat', sha: '1', size: 1, header: null }] });
    await db.delRepo('del/a');
    expect((await db.repos()).some((r) => r.repo === 'del/a')).toBe(false);
    expect(await db.getFile('del/a', 'x.cat')).toBeUndefined();
  });
  it('deleting an unknown repo is harmless', async () => {
    await expect(db.delRepo('no/such')).resolves.toBeUndefined();
  });
});

describe('rosters', () => {
  it('stores a copy, replaces by uid, and deletes', async () => {
    const r = roster('r1');
    await db.putRoster(r);
    r.name = 'Changed after saving';
    expect((await db.rosters()).find((x) => x.uid === 'r1')?.name).toBe('List');
    await db.putRoster(r);
    expect((await db.rosters()).filter((x) => x.uid === 'r1')).toHaveLength(1);
    await db.delRoster('r1');
    expect((await db.rosters()).some((x) => x.uid === 'r1')).toBe(false);
  });
});

describe('savedUnits', () => {
  const saved = (id: string): SavedUnit => ({
    id,
    name: 'Squad Thrax',
    repo: 'a/b',
    gameSystemId: 'gs',
    catalogueId: 'cat',
    key: 'breachers',
    categoryId: 'troops',
    build: {
      uid: 's1',
      key: 'breachers',
      number: 1,
      categoryId: 'troops',
      children: [{ uid: 's2', key: 'breachers/sergeant', number: 1, children: [] }],
    },
    created: 1,
    updated: 2,
  });

  function openRaw(factory: IDBFactory, version?: number, upgrade?: (d: IDBDatabase) => void) {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open('muster', version);
      req.onupgradeneeded = () => upgrade?.(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it('opens a version 1 database at version 2 with its lists and an empty savedUnits store', async () => {
    const factory = new IDBFactory();
    const v1 = await openRaw(factory, 1, (d) => {
      d.createObjectStore('files');
      d.createObjectStore('repos', { keyPath: 'repo' });
      d.createObjectStore('rosters', { keyPath: 'uid' }).put(roster('old'));
    });
    v1.close();
    vi.stubGlobal('indexedDB', factory);
    vi.resetModules();
    const fresh = (await import('./db')).db;

    expect((await fresh.rosters()).map((r) => r.uid)).toEqual(['old']);
    expect(await fresh.savedUnits()).toEqual([]);
    const after = await openRaw(factory);
    expect(after.version).toBe(2);
    expect([...after.objectStoreNames].sort()).toEqual(['files', 'repos', 'rosters', 'savedUnits']);
    after.close();
  });

  it('reads back a saved unit as it was put', async () => {
    await db.putSavedUnit(saved('u1'));
    expect((await db.savedUnits()).find((x) => x.id === 'u1')).toEqual(saved('u1'));
  });

  it('deleting a saved unit removes only that one', async () => {
    await db.putSavedUnit(saved('keep'));
    await db.putSavedUnit(saved('gone'));
    await db.delSavedUnit('gone');
    const ids = (await db.savedUnits()).map((x) => x.id);
    expect(ids.filter((id) => id === 'keep' || id === 'gone')).toEqual(['keep']);
  });
});

describe('errors', () => {
  it('rejects when a write fails', async () => {
    await expect(db.putRoster({} as Roster)).rejects.toBeDefined();
  });
});

describe('storage', () => {
  const stub = (persisted: boolean) => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => persisted, persist, estimate: async () => ({ usage: 5, quota: 10 }) },
    });
    return persist;
  };
  it('asks for persistent storage once', async () => {
    const persist = stub(false);
    await persistStorage();
    expect(persist).toHaveBeenCalledOnce();
    const already = stub(true);
    await persistStorage();
    expect(already).not.toHaveBeenCalled();
  });
  it('survives a browser without it', async () => {
    vi.stubGlobal('navigator', {});
    await expect(persistStorage()).resolves.toBeUndefined();
  });
  it('leaves a refused request to its caller', async () => {
    const storage = { persisted: async () => false, persist: async () => Promise.reject(new Error('denied')) };
    vi.stubGlobal('navigator', { storage });
    await expect(persistStorage()).rejects.toThrow('denied');
  });
  it('leaves a refused estimate to its caller', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => Promise.reject(new Error('denied')) } });
    await expect(storageUse()).rejects.toThrow('denied');
  });
  it('reports how much is used', async () => {
    stub(true);
    expect(await storageUse()).toEqual({ used: 5, quota: 10, persisted: true });
  });
});
