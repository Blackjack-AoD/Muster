import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './data/db';
import type { Roster } from './data/engine';
import {
  deleteRoster,
  dismissToast,
  failureMessage,
  getState,
  importRosters,
  init,
  refreshRepos,
  removeRepo,
  saveRoster,
  setGame,
  syncAll,
  toast,
} from './store';

const roster = (uid: string, name = 'List') =>
  ({ uid, name, repo: 'r', gameSystemId: 'g', costLimit: 0, forces: [], created: 0, updated: 0 }) as Roster;
const stored = async (uid: string) => (await db.rosters()).filter((r) => r.uid === uid);

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { onLine: false });
});

describe('failureMessage', () => {
  it("gives an error's own message", () => {
    expect(failureMessage('sync', new Error('Repo not found'))).toBe("Couldn't sync: Repo not found");
  });

  it("gives a DOM exception's own message", () => {
    expect(failureMessage('save', new DOMException('Storage is full'))).toBe("Couldn't save: Storage is full");
  });

  it('gives the text of a reason that is not an error', () => {
    expect(failureMessage('sync', 'You are offline')).toBe("Couldn't sync: You are offline");
  });
});

describe('saving lists', () => {
  it('saves to memory and storage, stamping the time', async () => {
    const r = roster('s1');
    await saveRoster(r);
    expect(r.updated).toBeGreaterThan(0);
    expect(getState().rosters.find((x) => x.uid === 's1')).toEqual(r);
    expect(await stored('s1')).toHaveLength(1);
  });
  it('replaces rather than duplicates', async () => {
    await saveRoster(roster('s2', 'First'));
    await saveRoster(roster('s2', 'Second'));
    expect(
      getState()
        .rosters.filter((x) => x.uid === 's2')
        .map((x) => x.name),
    ).toEqual(['Second']);
    expect((await stored('s2')).map((x) => x.name)).toEqual(['Second']);
  });
  it('keeps its own copy in memory', async () => {
    const r = roster('s3', 'Saved');
    await saveRoster(r);
    r.name = 'Edited later';
    expect(getState().rosters.find((x) => x.uid === 's3')?.name).toBe('Saved');
  });
  it('deletes', async () => {
    await saveRoster(roster('s4'));
    await deleteRoster('s4');
    expect(getState().rosters.some((x) => x.uid === 's4')).toBe(false);
    expect(await stored('s4')).toEqual([]);
  });
});

describe('restoring a backup', () => {
  it('adds new lists', async () => {
    await importRosters([roster('i1')]);
    expect(getState().rosters.some((x) => x.uid === 'i1')).toBe(true);
  });
  it('never overwrites a list that is already here', async () => {
    await saveRoster(roster('i2', 'Mine'));
    await importRosters([roster('i2', 'From backup')]);
    expect((await stored('i2')).map((x) => x.name)).toEqual(['Mine']);
    expect(getState().rosters.some((x) => x.name === 'From backup')).toBe(true);
  });
  it('skips anything that is not a list', async () => {
    const before = (await db.rosters()).length;
    await importRosters([null, {}, { uid: 'x' }, { uid: 'y', forces: 'nope' }]);
    expect(await db.rosters()).toHaveLength(before);
  });
  it('counts the lists it restored', async () => {
    expect(await importRosters([roster('i3'), null, roster('i4')])).toBe(2);
  });
  it('opens a list in the shape of the first release', async () => {
    const oldest = {
      uid: 'oldest',
      name: 'Old Guard',
      repo: 'r',
      gameSystemId: 'g',
      costLimit: 2000,
      forces: [
        {
          uid: 'f',
          forceEntryId: 'det',
          catalogueId: 'cat',
          selections: [{ uid: 's', key: 'e', number: 1, children: [], categoryId: 'hq' }],
        },
      ],
      created: 1700000000000,
      updated: 1700000000000,
    };
    await importRosters([oldest]);
    expect(await stored('oldest')).toEqual([oldest]);
  });
  const FORCE = { uid: 'f', forceEntryId: 'det', catalogueId: 'cat', selections: [] };
  it.each([
    ['no uid', { ...roster('x'), uid: undefined }],
    ['an empty uid', roster('')],
    ['a uid that is a number', { ...roster('x'), uid: 7 }],
    ['a name that is an object', { ...roster('x'), name: {} }],
    ['a repo that is an object', { ...roster('x'), repo: {} }],
    ['a game that is an object', { ...roster('x'), gameSystemId: {} }],
    ['a points limit that is an object', { ...roster('x'), costLimit: {} }],
    ['no edit time', { ...roster('x'), updated: undefined }],
    ['an edit time that is an object', { ...roster('x'), updated: {} }],
    ['a detachment that is null', { ...roster('x'), forces: [null] }],
    ['a detachment that is text', { ...roster('x'), forces: ['Patrol'] }],
    ['a detachment with no army', { ...roster('x'), forces: [{ ...FORCE, catalogueId: undefined }] }],
    ['a detachment with no type', { ...roster('x'), forces: [{ ...FORCE, forceEntryId: 7 }] }],
    ['a detachment with no units', { ...roster('x'), forces: [{ ...FORCE, selections: 'none' }] }],
  ])('skips a list with %s', async (_what, broken) => {
    const before = (await db.rosters()).length;
    await importRosters([broken]);
    expect(await db.rosters()).toHaveLength(before);
  });
});

describe('app state', () => {
  it('loads what is stored', async () => {
    await db.putRepo({ repo: 'st/1', files: [] });
    await db.putRoster(roster('st1'));
    await init();
    expect(getState().ready).toBe(true);
    expect(getState().repos.some((r) => r.repo === 'st/1')).toBe(true);
    expect(getState().rosters.some((r) => r.uid === 'st1')).toBe(true);
  });
  it('removes a repo and its sync status', async () => {
    await db.putRepo({ repo: 'st/2', files: [] });
    await refreshRepos();
    expect(getState().repos.some((r) => r.repo === 'st/2')).toBe(true);
    await removeRepo('st/2');
    expect(getState().repos.some((r) => r.repo === 'st/2')).toBe(false);
    expect(getState().sync['st/2']).toBeUndefined();
  });
  it('syncs each repo, recording failure against it', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await syncAll(['st/3']);
    expect(getState().repos.find((r) => r.repo === 'st/3')?.error).toBe('Repo not found (is it public?)');
    expect(getState().sync['st/3'].stage).toBe('error');
  });
  it('remembers the chosen game, and copes without local storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    setGame('r|g');
    expect(store.get('muster.game')).toBe('r|g');
    expect(getState().game).toBe('r|g');
    setGame(undefined);
    expect(store.size).toBe(0);
    vi.stubGlobal('localStorage', undefined);
    setGame('r|h');
    expect(getState().game).toBe('r|h');
  });
  it('shows a toast, then clears it', () => {
    vi.useFakeTimers();
    toast('Saved');
    expect(getState().toast).toBe('Saved');
    vi.advanceTimersByTime(2600);
    expect(getState().toast).toBeUndefined();
    vi.useRealTimers();
  });
  it('keeps a toast with an action on screen for longer, until dismissed', () => {
    vi.useFakeTimers();
    toast('Deleted', { label: 'Undo', run: () => {} });
    vi.advanceTimersByTime(4000);
    expect(getState().toastAction?.label).toBe('Undo');
    dismissToast();
    expect(getState().toast).toBeUndefined();
    vi.useRealTimers();
  });
});
