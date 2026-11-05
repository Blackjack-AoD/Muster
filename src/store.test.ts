import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './data/db';
import { Evaluator, addSel, displayName, uid as newUid, type Roster, type Sel } from './data/engine';
import { setUpForce } from './data/setup';
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
  saveUnit,
  setGame,
  syncAll,
  toast,
} from './store';
import { SWORD, children, present, sergeant, unit, world } from './test/fixture';

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
  it('restores a list in the shape of the first release', async () => {
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
  it('restores a list with nested selections', async () => {
    const leaf = { uid: 'leaf', key: 'e/c/d', number: 2, children: [] };
    const nested = {
      ...roster('nested'),
      forces: [
        {
          uid: 'f',
          forceEntryId: 'det',
          catalogueId: 'cat',
          selections: [
            {
              uid: 'root',
              key: 'e',
              number: 1,
              categoryId: 'hq',
              children: [{ uid: 'mid', key: 'e/c', number: 1, children: [leaf] }],
            },
          ],
        },
      ],
    };
    expect(await importRosters([nested])).toBe(1);
    expect(await stored('nested')).toEqual([nested]);
  });
  it('keeps custom names and saved-unit links on units and models', async () => {
    const model = { uid: 'm', key: 'e/m', number: 1, name: 'Brother Thrax', children: [] };
    const named = {
      ...roster('named'),
      forces: [
        {
          uid: 'f',
          forceEntryId: 'det',
          catalogueId: 'cat',
          selections: [
            { uid: 'u', key: 'e', number: 1, categoryId: 'hq', name: 'Squad Thrax', saved: 'thrax', children: [model] },
          ],
        },
      ],
    };
    expect(await importRosters([named])).toBe(1);
    expect(await stored('named')).toEqual([named]);
  });
  const FORCE = { uid: 'f', forceEntryId: 'det', catalogueId: 'cat', selections: [] };
  const SEL = { uid: 's', key: 'e', number: 1, children: [] };
  const withSel = (selection: unknown) => ({
    ...roster('x'),
    forces: [{ ...FORCE, selections: [selection] }],
  });
  it.each([
    ['no uid', { ...roster('x'), uid: undefined }],
    ['an empty uid', roster('')],
    ['a uid that is a number', { ...roster('x'), uid: 7 }],
    ['a slash in its uid', roster('a/b')],
    ['a capital in its uid', roster('aB1')],
    ['a dash in its uid', roster('preview-a1')],
    ['a space in its uid', roster('a b')],
    ['a line break after its uid', roster('ab\n')],
    ['a name that is an object', { ...roster('x'), name: {} }],
    ['a repo that is an object', { ...roster('x'), repo: {} }],
    ['a game that is an object', { ...roster('x'), gameSystemId: {} }],
    ['a points limit that is an object', { ...roster('x'), costLimit: {} }],
    ['no edit time', { ...roster('x'), updated: undefined }],
    ['an edit time that is an object', { ...roster('x'), updated: {} }],
    ['no creation time', { ...roster('x'), created: undefined }],
    ['a creation time that is an object', { ...roster('x'), created: {} }],
    ['a detachment that is null', { ...roster('x'), forces: [null] }],
    ['a detachment that is text', { ...roster('x'), forces: ['Patrol'] }],
    ['a detachment with no uid', { ...roster('x'), forces: [{ ...FORCE, uid: undefined }] }],
    ['a detachment with a uid that is an object', { ...roster('x'), forces: [{ ...FORCE, uid: {} }] }],
    ['a detachment with no army', { ...roster('x'), forces: [{ ...FORCE, catalogueId: undefined }] }],
    ['a detachment with no type', { ...roster('x'), forces: [{ ...FORCE, forceEntryId: 7 }] }],
    ['a detachment with no units', { ...roster('x'), forces: [{ ...FORCE, selections: 'none' }] }],
    ['a selection that is null', withSel(null)],
    ['a selection that is text', withSel('Boyz')],
    ['a selection with no uid', withSel({ ...SEL, uid: undefined })],
    ['a selection with a key that is a number', withSel({ ...SEL, key: 7 })],
    ['a selection with a number that is text', withSel({ ...SEL, number: '1' })],
    ['a selection with no children', withSel({ ...SEL, children: undefined })],
    ['a selection with children that are text', withSel({ ...SEL, children: 'none' })],
    ['a selection with a category that is a number', withSel({ ...SEL, categoryId: 7 })],
    ['a selection with a category that is null', withSel({ ...SEL, categoryId: null })],
    ['a selection with a name that is a number', withSel({ ...SEL, name: 7 })],
    ['a selection with a name that is null', withSel({ ...SEL, name: null })],
    ['a selection with a saved unit that is a number', withSel({ ...SEL, saved: 7 })],
    ['a selection with a saved unit that is null', withSel({ ...SEL, saved: null })],
    ['a nested selection with a name that is an object', withSel({ ...SEL, children: [{ ...SEL, name: {} }] })],
    ['a nested selection with a saved unit that is an object', withSel({ ...SEL, children: [{ ...SEL, saved: {} }] })],
    ['a nested selection that is null', withSel({ ...SEL, children: [null] })],
    ['a selection two levels down with no key', withSel({ ...SEL, children: [{ ...SEL, children: [{ uid: 's' }] }] })],
  ])('skips a list with %s', async (_what, broken) => {
    const before = (await db.rosters()).length;
    await importRosters([broken]);
    expect(await db.rosters()).toHaveLength(before);
  });
  describe('with fields it does not know', () => {
    const SQUAD = unit(
      'tac',
      'Tactical Squad',
      100,
      `<categoryLinks><categoryLink id="tac-hq" name="HQ" targetId="hq" primary="true"/></categoryLinks>
      <constraints><constraint id="tac-min" type="min" field="selections" scope="force" value="1"/></constraints>
      ${children(sergeant(children(SWORD)))}`,
    );
    /** A list as the app writes it: the set-up adds a root selection, and adding a unit fills its defaults. */
    const realWorld = (listUid: string) => {
      const w = world(SQUAD, { costLimit: 2000 });
      w.roster.uid = listUid;
      w.roster.created = 1700000000000;
      w.roster.updated = 1700000000001;
      setUpForce(w.roster, w.contexts, 'f1', 'Test Army');
      w.add('Tactical Squad', 2);
      return w;
    };
    const realList = (listUid: string) => JSON.parse(JSON.stringify(realWorld(listUid).roster)) as Roster;
    const junkSel = (s: Sel): unknown => ({ ...s, junk: 'sel', children: s.children.map(junkSel) });
    const withJunk = (r: Roster) => ({
      ...r,
      junk: 'roster',
      forces: r.forces.map((f) => ({ ...f, junk: 'force', selections: f.selections.map(junkSel) })),
    });

    it('stores a list the app built with every real field, and none of the junk', async () => {
      const list = realList(newUid());
      expect(list.forces[0]?.selections.some((s) => s.categoryId === 'hq')).toBe(true);
      expect(await importRosters([withJunk(list)])).toBe(1);
      expect(await stored(list.uid)).toEqual([list]);
    });
    it('leaves a category absent from a selection that has none', async () => {
      const list = realList('nocategory');
      await importRosters([withJunk(list)]);
      const [restored] = await stored('nocategory');
      const child = restored?.forces[0]?.selections.at(-1)?.children[0];
      expect(Object.keys(child ?? {}).sort()).toEqual(['children', 'key', 'number', 'uid']);
    });
    it('adds no custom name or saved-unit link to a list that had none', async () => {
      const list = realList('unnamed');
      await importRosters([withJunk(list)]);
      const [restored] = await stored('unnamed');
      const keys = new Set<string>();
      const collect = (s: Sel) => {
        Object.keys(s).forEach((k) => keys.add(k));
        s.children.forEach(collect);
      };
      restored?.forces.forEach((f) => f.selections.forEach(collect));
      expect([...keys].sort()).toEqual(['categoryId', 'children', 'key', 'number', 'uid']);
    });
    it('opens a restored list with the points and names it had', async () => {
      const w = realWorld('reopened');
      const shown = (ev: Evaluator) => ev.forces[0]?.roots.map((u) => [displayName(u), u.total]);
      const before = shown(w.ev());
      expect(before).toContainEqual(['Tactical Squad', 250]);
      await importRosters([JSON.parse(JSON.stringify(w.roster))]);
      const [restored] = await stored('reopened');
      expect(shown(new Evaluator(present(restored, 'the restored list'), w.contexts))).toEqual(before);
    });
  });
  it('restores the rest of a backup past a selection that is null', async () => {
    const lists = [roster('r1'), withSel(null), roster('r2')];
    expect(await importRosters(lists)).toBe(2);
    expect((await db.rosters()).map((r) => r.uid)).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect(await stored('x')).toEqual([]);
  });
  /** A selection directly in a force is level 1, and each child is one level down. */
  const nested = (levels: number) => {
    let top: unknown = SEL;
    for (let level = 1; level < levels; level++) top = { ...SEL, children: [top] };
    return top;
  };
  it('restores a list nested exactly 32 levels', async () => {
    const deepest = { ...withSel(nested(32)), uid: 'deepest' };
    expect(await importRosters([deepest])).toBe(1);
    expect(await stored('deepest')).toEqual([deepest]);
  });
  it.each([
    ['one level too deep', 33],
    ['too deep to store', 3_000],
    ['too deep for the stack', 100_000],
  ])('skips a list nested %s and restores the rest', async (_what, levels) => {
    const tooDeep = { ...withSel(nested(levels)), uid: `deep${levels}` };
    expect(await importRosters([roster('d1'), tooDeep, roster('d2')])).toBe(2);
    expect(await stored('d1')).toHaveLength(1);
    expect(await stored('d2')).toHaveLength(1);
    expect(await stored('x')).toEqual([]);
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

describe('saved units', () => {
  afterEach(() => vi.restoreAllMocks());
  const SQUAD = unit(
    'tac',
    'Tactical Squad',
    100,
    `<categoryLinks>
      <categoryLink id="tac-troops" name="Troops" targetId="troops" primary="true"/>
      <categoryLink id="tac-hq" name="HQ" targetId="hq"/>
    </categoryLinks>
    ${children(sergeant(children(SWORD)))}`,
  );
  /** A list holding one Tactical Squad, added under the HQ heading rather than its primary Troops. */
  const listWithSquad = (listUid: string) => {
    const w = world(SQUAD);
    w.roster.uid = listUid;
    const squad = present(addSel(w.roster, w.contexts, 'f1', null, w.root('Tactical Squad'), 1, 'hq'), 'the squad');
    return { w, squad, rs: w.sel(squad) };
  };
  const rootsOf = (r?: Roster) => r?.forces.flatMap((f) => f.selections) ?? [];
  const inMemory = (listUid: string) => rootsOf(getState().rosters.find((r) => r.uid === listUid));
  const inStorage = async (listUid: string) => rootsOf((await stored(listUid))[0]);
  const savedIn = (r: Roster, selUid: string) =>
    present(
      rootsOf(r).find((s) => s.uid === selUid),
      'the unit',
    );
  const savedUnit = (id: string) => getState().savedUnits.find((u) => u.id === id);
  const storedSavedUnit = async (id: string) => (await db.savedUnits()).find((u) => u.id === id);

  /** Storage refuses every write of a list, as a full phone would, and still takes saved units. */
  const refuseLists = () => {
    // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on the store
    const put = IDBObjectStore.prototype.put;
    return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'rosters') throw new DOMException('Storage is full', 'QuotaExceededError');
      return put.call(this, value, key);
    });
  };

  /** Runs `save` and returns the one saved unit it added. */
  const addedBy = async (save: () => Promise<void>) => {
    const before = new Set(getState().savedUnits.map((u) => u.id));
    await save();
    const added = getState().savedUnits.filter((u) => !before.has(u.id));
    expect(added).toHaveLength(1);
    return present(added[0], 'the saved unit');
  };

  it('saves a unit with its army file, key, category and build', async () => {
    const { w, squad, rs } = listWithSquad('su1');
    const build = structuredClone(savedIn(w.roster, squad));
    const { id } = await addedBy(() => saveUnit(w.roster, rs, 'Squad Thrax'));
    const expected = {
      id,
      name: 'Squad Thrax',
      repo: 'test/repo',
      gameSystemId: 'gst',
      catalogueId: 'cat',
      key: 'tac',
      categoryId: 'hq',
      build,
    };
    expect(savedUnit(id)).toMatchObject(expected);
    expect(await storedSavedUnit(id)).toMatchObject(expected);
  });

  it('links the unit to its saved unit by id and name, in memory and storage', async () => {
    const { w, squad, rs } = listWithSquad('su2');
    const { id } = await addedBy(() => saveUnit(w.roster, rs, 'Squad Thrax'));
    const link = { uid: squad, saved: id, name: 'Squad Thrax' };
    expect(savedIn(w.roster, squad)).toMatchObject(link);
    expect(inMemory('su2')).toEqual([expect.objectContaining(link)]);
    expect(await inStorage('su2')).toEqual([expect.objectContaining(link)]);
  });

  it('takes the category the list shows for a unit added under none', async () => {
    const w = world(SQUAD);
    w.roster.uid = 'su3';
    const squad = present(addSel(w.roster, w.contexts, 'f1', null, w.root('Tactical Squad')), 'the squad');
    const saved = await addedBy(() => saveUnit(w.roster, w.sel(squad), 'No Heading'));
    expect(saved.categoryId).toBe('troops');
  });

  it('refuses to save a model inside a unit, and adds nothing', async () => {
    const { w, squad } = listWithSquad('su5');
    const model = present(savedIn(w.roster, squad).children[0], 'the sergeant');
    const before = getState().savedUnits.length;
    await expect(saveUnit(w.roster, w.sel(model.uid), 'Brother Thrax')).rejects.toThrow(
      'Only a unit of this list can be saved.',
    );
    expect(getState().savedUnits).toHaveLength(before);
    expect(model.saved).toBeUndefined();
  });

  it('leaves the unit unlinked when storage refuses the saved unit', async () => {
    const { w, squad, rs } = listWithSquad('su4');
    await saveRoster(w.roster);
    const before = getState().savedUnits.length;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    await expect(saveUnit(w.roster, rs, 'Squad Thrax')).rejects.toThrow('Storage is full');
    expect(getState().savedUnits).toHaveLength(before);
    expect(Object.keys(savedIn(w.roster, squad))).not.toContain('saved');
    expect(inMemory('su4')[0]?.saved).toBeUndefined();
  });

  it('loads saved units from storage at start', async () => {
    const { w, squad } = listWithSquad('ld1');
    const record = {
      id: 'thrax',
      name: 'Squad Thrax',
      repo: 'test/repo',
      gameSystemId: 'gst',
      catalogueId: 'cat',
      key: 'tac',
      categoryId: 'hq',
      build: savedIn(w.roster, squad),
      created: 1,
      updated: 2,
    };
    await db.putSavedUnit(record);
    await init();
    expect(savedUnit('thrax')).toEqual(record);
  });

  describe('a list that fails to save', () => {
    afterEach(dismissToast);
    it.each([
      [
        'saving a unit',
        async () => {
          const { w, rs } = listWithSquad('rt1');
          await saveRoster(w.roster);
          refuseLists();
          await saveUnit(w.roster, rs, 'Squad Thrax');
          return { list: 'rt1', expected: { saved: expect.any(String), name: 'Squad Thrax' } };
        },
      ],
    ])('offers Retry after %s, and Retry stores it', async (_what, change) => {
      const { list, expected } = await change();
      await vi.waitFor(() => expect(getState().toastAction?.failedSave).toBe(list));
      expect(getState().toast).toBe("Couldn't save this list");
      expect(getState().unsaved.has(list)).toBe(true);

      vi.restoreAllMocks();
      getState().toastAction?.run();
      await vi.waitFor(() => expect(getState().unsaved.has(list)).toBe(false));
      expect((await inStorage(list))[0]).toMatchObject(expected);
    });
  });
});
