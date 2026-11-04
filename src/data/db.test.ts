import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, persistStorage, storageUse } from './db';
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
    expect(await storageUse()).toBeNull();
  });
  it('reports how much is used', async () => {
    stub(true);
    expect(await storageUse()).toEqual({ used: 5, quota: 10, persisted: true });
  });
});
