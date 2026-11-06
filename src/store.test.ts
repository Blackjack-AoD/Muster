import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './data/db';
import {
  Evaluator,
  addSavedUnit,
  addSel,
  displayName,
  forceRootOptions,
  uid as newUid,
  type Roster,
  type Sel,
} from './data/engine';
import { setUpForce } from './data/setup';
import {
  deleteRoster,
  deleteSavedUnit,
  dismissToast,
  failureMessage,
  getState,
  importBackup,
  init,
  refreshRepos,
  removeRepo,
  renameSavedUnit,
  saveListEdit,
  saveRoster,
  saveUnit,
  setGame,
  syncAll,
  toast,
} from './store';
import { Context } from './data/catalog';
import { SWORD, catalogue, children, present, sergeant, unit, world } from './test/fixture';

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
    await importBackup([roster('i1')]);
    expect(getState().rosters.some((x) => x.uid === 'i1')).toBe(true);
  });
  it('never overwrites a list that is already here', async () => {
    await saveRoster(roster('i2', 'Mine'));
    await importBackup([roster('i2', 'From backup')]);
    expect((await stored('i2')).map((x) => x.name)).toEqual(['Mine']);
    expect(getState().rosters.some((x) => x.name === 'From backup')).toBe(true);
  });
  it('skips anything that is not a list', async () => {
    const before = (await db.rosters()).length;
    await importBackup([null, {}, { uid: 'x' }, { uid: 'y', forces: 'nope' }]);
    expect(await db.rosters()).toHaveLength(before);
  });
  it('counts the lists it restored', async () => {
    expect((await importBackup([roster('i3'), null, roster('i4')])).lists).toBe(2);
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
    await importBackup([oldest]);
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
    expect((await importBackup([nested])).lists).toBe(1);
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
            { uid: 'u', key: 'e', number: 1, categoryId: 'hq', name: 'Squad Thrax', saved: 'kept', children: [model] },
          ],
        },
      ],
    };
    const thrax = {
      id: 'kept',
      name: 'Squad Thrax',
      repo: 'r',
      gameSystemId: 'g',
      catalogueId: 'cat',
      key: 'e',
      categoryId: 'hq',
      build: { uid: 'b', key: 'e', number: 1, children: [] },
      created: 0,
      updated: 0,
    };
    expect((await importBackup([named], [thrax])).lists).toBe(1);
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
    await importBackup([broken]);
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
      expect((await importBackup([withJunk(list)])).lists).toBe(1);
      expect(await stored(list.uid)).toEqual([list]);
    });
    it('leaves a category absent from a selection that has none', async () => {
      const list = realList('nocategory');
      await importBackup([withJunk(list)]);
      const [restored] = await stored('nocategory');
      const child = restored?.forces[0]?.selections.at(-1)?.children[0];
      expect(Object.keys(child ?? {}).sort()).toEqual(['children', 'key', 'number', 'uid']);
    });
    it('adds no custom name or saved-unit link to a list that had none', async () => {
      const list = realList('unnamed');
      await importBackup([withJunk(list)]);
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
      await importBackup([JSON.parse(JSON.stringify(w.roster))]);
      const [restored] = await stored('reopened');
      expect(shown(new Evaluator(present(restored, 'the restored list'), w.contexts))).toEqual(before);
    });
  });
  it('restores the rest of a backup past a selection that is null', async () => {
    const lists = [roster('r1'), withSel(null), roster('r2')];
    expect((await importBackup(lists)).lists).toBe(2);
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
    expect((await importBackup([deepest])).lists).toBe(1);
    expect(await stored('deepest')).toEqual([deepest]);
  });
  it.each([
    ['one level too deep', 33],
    ['too deep to store', 3_000],
    ['too deep for the stack', 100_000],
  ])('skips a list nested %s and restores the rest', async (_what, levels) => {
    const tooDeep = { ...withSel(nested(levels)), uid: `deep${levels}` };
    expect((await importBackup([roster('d1'), tooDeep, roster('d2')])).lists).toBe(2);
    expect(await stored('d1')).toHaveLength(1);
    expect(await stored('d2')).toHaveLength(1);
    expect(await stored('x')).toEqual([]);
  });

  describe('with saved units', () => {
    const MODEL = { uid: 'm', key: 'e/m', number: 1, name: 'Brother Thrax', children: [] };
    const BUILD = { uid: 'b', key: 'e', number: 1, categoryId: 'hq', children: [MODEL] };
    const savedUnit = (id: string, name = 'Squad Thrax') => ({
      id,
      name,
      repo: 'r',
      gameSystemId: 'g',
      catalogueId: 'cat',
      key: 'e',
      categoryId: 'hq',
      build: BUILD,
      created: 1700000000000,
      updated: 1700000000001,
    });
    /** A list holding one copy of saved unit `id`, under the saved unit's name. */
    const listWithCopy = (listUid: string, id: string) => ({
      ...roster(listUid),
      forces: [
        {
          ...FORCE,
          selections: [
            { uid: 'u', key: 'e', number: 1, categoryId: 'hq', name: 'Squad Thrax', saved: id, children: [MODEL] },
          ],
        },
      ],
    });
    const storedUnit = async (id: string) => (await db.savedUnits()).filter((u) => u.id === id);
    const copyIn = async (listUid: string) => (await stored(listUid))[0]?.forces[0]?.selections[0];

    it('stores each saved unit with only the fields of a saved unit, and counts them', async () => {
      const junk = {
        ...savedUnit('junky'),
        junk: 'unit',
        build: {
          ...BUILD,
          name: 'Squad Thrax',
          saved: 'junky',
          junk: 'build',
          children: [{ ...MODEL, junk: 'model' }],
        },
      };
      expect(await importBackup([], [junk])).toEqual({ lists: 0, savedUnits: 1 });
      expect(await storedUnit('junky')).toEqual([savedUnit('junky')]);
      expect(getState().savedUnits).toContainEqual(savedUnit('junky'));
    });
    it('keeps a restored copy linked to its restored saved unit', async () => {
      await importBackup([listWithCopy('linked', 'thrax1')], [savedUnit('thrax1')]);
      expect(await storedUnit('thrax1')).toEqual([savedUnit('thrax1')]);
      expect(await copyIn('linked')).toMatchObject({ saved: 'thrax1', name: 'Squad Thrax' });
    });
    it('gives a saved unit whose id is taken a new id, and its copies follow it', async () => {
      await importBackup([], [savedUnit('taken', 'Mine')]);
      await importBackup([listWithCopy('follows', 'taken')], [savedUnit('taken', 'From backup')]);
      expect((await storedUnit('taken')).map((u) => u.name)).toEqual(['Mine']);
      const restored = (await db.savedUnits()).filter((u) => u.name === 'From backup');
      const newId = restored[0]?.id ?? '';
      expect(newId).not.toBe('taken');
      expect(restored).toEqual([savedUnit(newId, 'From backup')]);
      expect((await copyIn('follows'))?.saved).toBe(newId);
      expect(getState().savedUnits.map((u) => u.name)).toEqual(expect.arrayContaining(['Mine', 'From backup']));
    });
    it('keeps a copy linked to a saved unit already on the phone', async () => {
      await importBackup([], [savedUnit('here')]);
      await importBackup([listWithCopy('onphone', 'here')]);
      expect(getState().savedUnits.filter((u) => u.id === 'here')).toEqual([savedUnit('here')]);
      expect(await copyIn('onphone')).toMatchObject({ saved: 'here', name: 'Squad Thrax' });
    });
    it('turns a copy whose saved unit is missing into a normal unit with no name', async () => {
      await importBackup([listWithCopy('orphan', 'gone')]);
      expect(await copyIn('orphan')).toEqual({ uid: 'u', key: 'e', number: 1, categoryId: 'hq', children: [MODEL] });
    });
    it('turns a copy of a saved unit it skipped into a normal unit', async () => {
      await importBackup([listWithCopy('skippedcopy', 'broken')], [{ ...savedUnit('broken'), key: 7 }]);
      expect(await copyIn('skippedcopy')).toEqual({
        uid: 'u',
        key: 'e',
        number: 1,
        categoryId: 'hq',
        children: [MODEL],
      });
    });
    it.each([
      ['that is null', null],
      ['that is text', 'Squad Thrax'],
      ['with an id that is a number', { ...savedUnit('x'), id: 7 }],
      ['with no name', { ...savedUnit('x'), name: undefined }],
      ['with a repo that is an object', { ...savedUnit('x'), repo: {} }],
      ['with a game that is an object', { ...savedUnit('x'), gameSystemId: {} }],
      ['with an army that is a number', { ...savedUnit('x'), catalogueId: 7 }],
      ['with a key that is a number', { ...savedUnit('x'), key: 7 }],
      ['with a category that is null', { ...savedUnit('x'), categoryId: null }],
      ['with no build', { ...savedUnit('x'), build: undefined }],
      ['with a build that is text', { ...savedUnit('x'), build: 'Tactical Squad' }],
      ['with a build with no key', { ...savedUnit('x'), build: { ...BUILD, key: undefined } }],
      ['with a model in its build that is null', { ...savedUnit('x'), build: { ...BUILD, children: [null] } }],
      ['with a creation time that is text', { ...savedUnit('x'), created: 'today' }],
      ['with no edit time', { ...savedUnit('x'), updated: undefined }],
    ])('skips a saved unit %s and restores the rest', async (_what, broken) => {
      const before = (await db.savedUnits()).length;
      expect(await importBackup([], [savedUnit('ok1'), broken, savedUnit('ok2')])).toEqual({ lists: 0, savedUnits: 2 });
      expect(await db.savedUnits()).toHaveLength(before + 2);
      expect(await storedUnit('x')).toEqual([]);
    });
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
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

  /** A copy of saved unit `id` in a new list, as adding it to a detachment would leave it. */
  const listWithCopy = async (listUid: string, id: string, name: string) => {
    const { w, squad } = listWithSquad(listUid);
    Object.assign(savedIn(w.roster, squad), { saved: id, name });
    await saveRoster(w.roster);
    return { roster: w.roster, squad };
  };

  /** Runs `save` and returns the one saved unit it added. */
  const addedBy = async (save: () => Promise<void>) => {
    const before = new Set(getState().savedUnits.map((u) => u.id));
    await save();
    const added = getState().savedUnits.filter((u) => !before.has(u.id));
    expect(added).toHaveLength(1);
    return present(added[0], 'the saved unit');
  };

  /** Saves the Tactical Squad of a new stored list, and returns the saved unit's id. */
  const savedSquad = async (listUid: string, name: string) => {
    const { w, squad, rs } = listWithSquad(listUid);
    await saveRoster(w.roster);
    const { id } = await addedBy(() => saveUnit(w.roster, rs, name));
    return { roster: w.roster, squad, id };
  };

  it('saves a unit with its army file, key, category and build, from a detachment of another army file', async () => {
    const w = world(SQUAD);
    w.roster.uid = 'su1';
    const other = catalogue(`<selectionEntries>${SQUAD}</selectionEntries>`, 'cat2');
    w.contexts.set(other.id, new Context(w.gst, other, []));
    w.roster.forces.push({ uid: 'f2', forceEntryId: 'det', catalogueId: 'cat2', selections: [] });
    const opt = present(
      forceRootOptions(present(w.contexts.get('cat2'), 'the other army file'), w.ctx.forceEntries()[0]).find(
        (o) => o.node.name === 'Tactical Squad',
      ),
      'the squad entry',
    );
    const squad = present(addSel(w.roster, w.contexts, 'f2', null, opt, 1, 'hq'), 'the squad');
    const rs = w.sel(squad);
    const build = structuredClone(savedIn(w.roster, squad));
    const { id } = await addedBy(() => saveUnit(w.roster, rs, 'Squad Thrax'));
    const expected = {
      id,
      name: 'Squad Thrax',
      repo: 'test/repo',
      gameSystemId: 'gst',
      catalogueId: 'cat2',
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

  it("keeps no name or link on the root of a saved unit's build, and keeps model names", async () => {
    const { w, squad, rs } = listWithSquad('su6');
    const root = savedIn(w.roster, squad);
    Object.assign(root, { name: 'Old Name', saved: 'old' });
    const model = present(root.children[0], 'the sergeant');
    model.name = 'Brother Thrax';
    const { id } = await addedBy(() => saveUnit(w.roster, rs, 'Squad Thrax'));
    for (const saved of [savedUnit(id), await storedSavedUnit(id)]) {
      const build = present(saved, 'the saved unit').build;
      expect(Object.keys(build)).not.toContain('name');
      expect(Object.keys(build)).not.toContain('saved');
      expect(build.children[0]?.name).toBe('Brother Thrax');
    }
  });

  it('takes the category the list shows for a unit added under none', async () => {
    const w = world(SQUAD);
    w.roster.uid = 'su3';
    const squad = present(addSel(w.roster, w.contexts, 'f1', null, w.root('Tactical Squad')), 'the squad');
    const saved = await addedBy(() => saveUnit(w.roster, w.sel(squad), 'No Heading'));
    expect(saved.categoryId).toBe('troops');
  });

  it('saves a unit with no category under the empty category', async () => {
    const w = world(unit('hero', 'Lone Hero', 50));
    w.roster.uid = 'su7';
    const hero = present(addSel(w.roster, w.contexts, 'f1', null, w.root('Lone Hero')), 'the hero');
    const saved = await addedBy(() => saveUnit(w.roster, w.sel(hero), 'Brother Thrax'));
    expect(saved.categoryId).toBe('');
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

  it('renames a saved unit and its copies in every list, and no other unit', async () => {
    const { id } = await savedSquad('rn1', 'Squad Thrax');
    await listWithCopy('rn2', id, 'Squad Thrax');
    const { w: other, squad: unlinked } = listWithSquad('rn3');
    savedIn(other.roster, unlinked).name = 'Squad Vorr';
    await saveRoster(other.roster);

    await renameSavedUnit(id, 'Squad Iron');

    expect(savedUnit(id)?.name).toBe('Squad Iron');
    expect((await storedSavedUnit(id))?.name).toBe('Squad Iron');
    for (const list of ['rn1', 'rn2']) {
      await vi.waitFor(async () => expect((await inStorage(list)).map((s) => s.name)).toEqual(['Squad Iron']));
      expect(inMemory(list).map((s) => s.name)).toEqual(['Squad Iron']);
    }
    expect((await inStorage('rn3')).map((s) => s.name)).toEqual(['Squad Vorr']);
  });

  it('refuses to rename a saved unit that is not on this phone', async () => {
    await expect(renameSavedUnit('gone', 'Squad Iron')).rejects.toThrow("This saved unit isn't on this phone.");
    expect(await storedSavedUnit('gone')).toBeUndefined();
  });

  it('deletes a saved unit, leaving its copies with their build and no link or name', async () => {
    const { roster: first, squad: firstSquad, id } = await savedSquad('dl1', 'Squad Thrax');
    const { roster: second, squad: secondSquad } = await listWithCopy('dl2', id, 'Squad Thrax');
    const unlinked = (s: Sel): Sel => ({
      uid: s.uid,
      key: s.key,
      number: s.number,
      categoryId: 'hq',
      children: s.children,
    });
    const expected = {
      dl1: [unlinked(savedIn(first, firstSquad))],
      dl2: [unlinked(savedIn(second, secondSquad))],
    };

    await deleteSavedUnit(id);

    expect(savedUnit(id)).toBeUndefined();
    expect(await storedSavedUnit(id)).toBeUndefined();
    for (const list of ['dl1', 'dl2'] as const) {
      await vi.waitFor(async () => expect(await inStorage(list)).toEqual(expected[list]));
      expect(inMemory(list)).toEqual(expected[list]);
    }
  });

  it('stamps when a saved unit was made, and when it was last renamed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const { id } = await savedSquad('ts1', 'Squad Thrax');
    expect(savedUnit(id)).toMatchObject({ created: 1000, updated: 1000 });
    vi.setSystemTime(2000);
    await renameSavedUnit(id, 'Squad Iron');
    expect(savedUnit(id)).toMatchObject({ created: 1000, updated: 2000 });
    expect(await storedSavedUnit(id)).toMatchObject({ created: 1000, updated: 2000 });
  });

  it('loads saved units from storage at start', async () => {
    const { w, squad } = listWithSquad('ld1');
    const record = {
      id: 'loaded',
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
    expect(savedUnit('loaded')).toEqual(record);
  });

  describe('a copy edited in a list', () => {
    afterEach(dismissToast);
    const sergeantOf = (copy: Sel | undefined) => present(present(copy, 'the copy').children[0], 'the sergeant');

    it('takes a wargear change to the saved unit and to the copy in another list', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1000);
      const { roster: a, squad, id } = await savedSquad('fl1', 'Squad Thrax');
      await listWithCopy('fl2', id, 'Squad Thrax');
      expect(sergeantOf(inMemory('fl2')[0]).children.map((s) => s.key)).toEqual(['sword']);

      vi.setSystemTime(2000);
      await saveListEdit(a, () => {
        sergeantOf(savedIn(a, squad)).children = [];
      });

      for (const saved of [savedUnit(id), await storedSavedUnit(id)]) {
        expect(sergeantOf(saved?.build).children).toEqual([]);
        expect(saved?.updated).toBe(2000);
      }
      await vi.waitFor(async () => expect(sergeantOf((await inStorage('fl2'))[0]).children).toEqual([]));
      expect(sergeantOf(inMemory('fl2')[0]).children).toEqual([]);
    });

    it('renames the saved unit and the copies in other lists', async () => {
      const { roster: a, squad, id } = await savedSquad('fn1', 'Squad Thrax');
      await listWithCopy('fn2', id, 'Squad Thrax');
      await listWithCopy('fn3', id, 'Squad Thrax');

      await saveListEdit(a, () => {
        savedIn(a, squad).name = 'Squad Iron';
      });

      expect(savedUnit(id)?.name).toBe('Squad Iron');
      expect((await storedSavedUnit(id))?.name).toBe('Squad Iron');
      for (const list of ['fn1', 'fn2', 'fn3']) {
        await vi.waitFor(async () => expect((await inStorage(list)).map((s) => s.name)).toEqual(['Squad Iron']));
        expect(inMemory(list).map((s) => s.name)).toEqual(['Squad Iron']);
      }
    });

    it('takes a renamed model to the saved unit and to the copy in another list', async () => {
      const { roster: a, squad, id } = await savedSquad('fm1', 'Squad Thrax');
      await listWithCopy('fm2', id, 'Squad Thrax');

      await saveListEdit(a, () => {
        sergeantOf(savedIn(a, squad)).name = 'Brother Kael';
      });

      for (const saved of [savedUnit(id), await storedSavedUnit(id)]) {
        expect(sergeantOf(saved?.build).name).toBe('Brother Kael');
      }
      await vi.waitFor(async () => expect(sergeantOf((await inStorage('fm2'))[0]).name).toBe('Brother Kael'));
      expect(sergeantOf(inMemory('fm2')[0]).name).toBe('Brother Kael');
    });

    it('leaves each copy its own root uid, link and category when it takes the new build', async () => {
      const { roster: a, squad: first, id } = await savedSquad('fu1', 'Squad Thrax');
      const { roster: b, squad: second } = await listWithCopy('fu2', id, 'Squad Thrax');
      savedIn(a, first).categoryId = 'troops';
      await saveRoster(a);

      await saveListEdit(b, () => {
        sergeantOf(savedIn(b, second)).children = [];
      });

      await vi.waitFor(async () => expect(sergeantOf((await inStorage('fu1'))[0]).children).toEqual([]));
      expect((await inStorage('fu1')).map((s) => [s.uid, s.saved, s.categoryId])).toEqual([[first, id, 'troops']]);
      expect(inMemory('fu1').map((s) => [s.uid, s.saved, s.categoryId])).toEqual([[first, id, 'troops']]);
    });

    it('changes no other list and not the saved unit when the edited unit has no link', async () => {
      const { id } = await savedSquad('fp1', 'Squad Thrax');
      const { roster: b, squad: copy } = await listWithCopy('fp2', id, 'Squad Thrax');
      const plain: Sel = { ...structuredClone(savedIn(b, copy)), uid: newUid() };
      delete plain.saved;
      delete plain.name;
      present(b.forces[0], 'the detachment').selections.push(plain);
      await saveRoster(b);
      const before = {
        list: structuredClone(getState().rosters.find((r) => r.uid === 'fp1')),
        saved: structuredClone(savedUnit(id)),
      };

      await saveListEdit(b, () => {
        sergeantOf(plain).children = [];
      });

      await vi.waitFor(async () => expect(sergeantOf((await inStorage('fp2'))[1]).children).toEqual([]));
      expect(sergeantOf((await inStorage('fp2'))[0]).children.map((s) => s.key)).toEqual(['sword']);
      expect(getState().rosters.find((r) => r.uid === 'fp1')).toEqual(before.list);
      expect(savedUnit(id)).toEqual(before.saved);
      expect(await storedSavedUnit(id)).toEqual(before.saved);
    });

    it('leaves the saved unit and other lists as they are when adding a copy drops an option', async () => {
      const { w: first, squad, rs } = listWithSquad('fa1');
      savedIn(first.roster, squad).children.push({ uid: newUid(), key: 'gone-banner', number: 1, children: [] });
      await saveRoster(first.roster);
      const saved = await addedBy(() => saveUnit(first.roster, rs, 'Squad Thrax'));
      await listWithCopy('fa2', saved.id, 'Squad Thrax');
      const before = {
        lists: structuredClone(getState().rosters.filter((r) => r.uid === 'fa1' || r.uid === 'fa2')),
        saved: structuredClone(saved),
      };
      const w = world(SQUAD);
      w.roster.uid = 'fa3';
      await saveRoster(w.roster);

      let result: ReturnType<typeof addSavedUnit> | undefined;
      await saveListEdit(w.roster, (r) => {
        result = addSavedUnit(r, w.contexts, 'f1', saved);
      });

      expect(result).toMatchObject({ added: true, dropped: 1 });
      expect(savedUnit(saved.id)).toEqual(before.saved);
      expect(await storedSavedUnit(saved.id)).toEqual(before.saved);
      expect(getState().rosters.filter((r) => r.uid === 'fa1' || r.uid === 'fa2')).toEqual(before.lists);
    });

    it('pushes nothing from a copy that differs from its saved unit when another unit in its list changes', async () => {
      const { id } = await savedSquad('fd1', 'Squad Thrax');
      const { roster: b, squad: copy } = await listWithCopy('fd2', id, 'Squad Thrax');
      sergeantOf(savedIn(b, copy)).children = [];
      const plain: Sel = { ...structuredClone(savedIn(b, copy)), uid: newUid() };
      delete plain.saved;
      delete plain.name;
      present(b.forces[0], 'the detachment').selections.push(plain);
      await saveRoster(b);
      const before = {
        list: structuredClone(getState().rosters.find((r) => r.uid === 'fd1')),
        saved: structuredClone(savedUnit(id)),
      };

      await saveListEdit(b, () => {
        plain.children = [];
      });

      expect(savedUnit(id)).toEqual(before.saved);
      expect(await storedSavedUnit(id)).toEqual(before.saved);
      expect(getState().rosters.find((r) => r.uid === 'fd1')).toEqual(before.list);
      expect(sergeantOf((await inStorage('fd1'))[0]).children.map((s) => s.key)).toEqual(['sword']);
    });

    it('saves the edited list before any other', async () => {
      const { roster: a, squad, id } = await savedSquad('fo1', 'Squad Thrax');
      await listWithCopy('fo2', id, 'Squad Thrax');
      const puts = vi.spyOn(db, 'putRoster');

      await saveListEdit(a, () => {
        savedIn(a, squad).name = 'Squad Iron';
      });

      await vi.waitFor(() => expect(puts.mock.calls.map(([r]) => r.uid)).toEqual(['fo1', 'fo2']));
    });

    it('leaves other lists as they are, and says so, when storage refuses the saved unit', async () => {
      const { roster: a, squad, id } = await savedSquad('fr1', 'Squad Thrax');
      await listWithCopy('fr2', id, 'Squad Thrax');
      const before = structuredClone(getState().rosters.find((r) => r.uid === 'fr2'));
      // oxlint-disable-next-line typescript/unbound-method -- the spy calls it on the store
      const put = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'savedUnits') throw new DOMException('Storage is full', 'QuotaExceededError');
        return put.call(this, value, key);
      });

      await saveListEdit(a, () => {
        savedIn(a, squad).name = 'Squad Iron';
      });

      expect(getState().toast).toBe("Couldn't update the saved unit: Storage is full");
      expect(savedUnit(id)?.name).toBe('Squad Thrax');
      expect(getState().rosters.find((r) => r.uid === 'fr2')).toEqual(before);
      expect((await inStorage('fr2')).map((s) => s.name)).toEqual(['Squad Thrax']);
    });
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
      [
        'renaming a saved unit',
        async () => {
          const { id } = await savedSquad('rt2', 'Squad Thrax');
          refuseLists();
          await renameSavedUnit(id, 'Squad Iron');
          return { list: 'rt2', expected: { saved: id, name: 'Squad Iron' } };
        },
      ],
      [
        'deleting a saved unit',
        async () => {
          const { id } = await savedSquad('rt3', 'Squad Thrax');
          refuseLists();
          await deleteSavedUnit(id);
          return { list: 'rt3', expected: { name: undefined, saved: undefined } };
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
      const [copy] = await inStorage(list);
      expect({ saved: copy?.saved, name: copy?.name }).toEqual(expected);
    });
  });
});
