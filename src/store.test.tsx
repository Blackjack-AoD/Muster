// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { db } from './data/db';
import { addSel, forceRootOptions, type Roster } from './data/engine';
import { DEFAULT_REPOS } from './data/sync';
import {
  addRoster,
  deleteRoster,
  getState,
  importRosters,
  init,
  removeRepo,
  saveRoster,
  toast,
  useRosterCtl,
} from './store';
import { unit, world } from './test/fixture';
import { expectToast, failReads, press, refuse, renderScreen, stubBrowserGaps, worldFiles } from './test/screen';

const FILES = worldFiles(unit('tac', 'Tactical Squad', 100));
const SAVE_FAILED = "Couldn't save this list";

function ListEditor({ source, scratch }: { source?: Roster; scratch?: boolean }) {
  const { ctl, error, loading } = useRosterCtl(source, scratch);
  if (loading) return <p>Loading</p>;
  if (!ctl) return <p>{error}</p>;
  const add = () =>
    ctl.mutate((r) => {
      const force = r.forces[0];
      const ctx = ctl.contexts.get(force.catalogueId);
      if (!ctx) throw new Error('no data for this force');
      addSel(r, ctl.contexts, force.uid, null, forceRootOptions(ctx, ctx.forceEntries()[0])[0]);
    });
  return (
    <>
      <p>Points: {ctl.ev.total}</p>
      <button onClick={add}>Add a unit</button>
    </>
  );
}

const newList = () => world(unit('tac', 'Tactical Squad', 100)).roster;
const unitsIn = (r?: Roster) => r?.forces[0].selections.length;
const storedUnits = async () => unitsIn((await db.rosters())[0]);
const unitsInMemory = () => unitsIn(getState().rosters[0]);
const addUnit = () => press('Add a unit');
const pressRetry = () => press('Retry');

/** The App shell draws the toast and its button. */
async function renderWithToast(source: Roster) {
  await renderScreen(
    <>
      <App />
      <ListEditor source={source} />
    </>,
    { files: FILES, rosters: [source] },
  );
}

/** Install this once the list has loaded, as loading waits on a timer. It leaves storage's own scheduling real. */
async function fakeClock() {
  await screen.findByRole('button', { name: 'Add a unit' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

async function failASave() {
  const put = refuse('put');
  await addUnit();
  await expectToast(SAVE_FAILED);
  return put;
}

const showUndo = () => toast('Removed Tactical Squad', { label: 'Undo', run: () => {} });

// oxlint-disable-next-line typescript/unbound-method -- the spy calls it on the store
const realPut = IDBObjectStore.prototype.put;

/** The next save writes to storage, but the app hears how it went only when the test answers. */
function holdNextSave() {
  let answer: { finish: () => void; fail: () => void } | undefined;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, value: unknown) {
    const t = this.transaction;
    // the caller sets its handlers after this returns
    queueMicrotask(() => {
      const { oncomplete, onabort } = t;
      t.oncomplete = null;
      t.onabort = null;
      answer = {
        finish: () => oncomplete?.call(t, new Event('complete')),
        fail: () => onabort?.call(t, new Event('abort')),
      };
    });
    return realPut.call(this, value);
  });
  const answered = async (how: 'finish' | 'fail') => {
    const held = await waitFor(() => answer ?? Promise.reject(new Error('the save has not started')));
    held[how]();
    // a trip to storage lets the save report whatever it does next
    await db.rosters();
  };
  return { finish: () => answered('finish'), fail: () => answered('fail') };
}

beforeEach(stubBrowserGaps);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useRosterCtl', () => {
  it('shows loading, then the list and its points once its data has loaded', async () => {
    const w = world(unit('tac', 'Tactical Squad', 100));
    w.add('Tactical Squad');
    await renderScreen(<ListEditor source={w.roster} />, { files: FILES, rosters: [w.roster] });
    expect(document.body.textContent).toBe('Loading');
    await screen.findByText('Points: 100');
    expect(screen.queryByText('Loading')).toBeNull();
  });

  it("reports a list that isn't there", async () => {
    await renderScreen(<ListEditor />, { files: FILES });
    expect(document.body.textContent).toBe('List not found');
  });

  it('gives the reason when the data fails to load with a reason that is no Error', async () => {
    const w = world(unit('tac', 'Tactical Squad', 100));
    failReads('Storage is gone');
    await renderScreen(<ListEditor source={w.roster} />, { files: FILES, rosters: [w.roster] });
    await waitFor(() => expect(document.body.textContent).toBe('Storage is gone'));
  });

  it('saves an edit to memory and storage with no toast', async () => {
    const list = newList();
    await renderScreen(<ListEditor source={list} />, { files: FILES, rosters: [list] });
    await addUnit();
    await screen.findByText('Points: 100');
    expect(unitsInMemory()).toBe(1);
    expect(await storedUnits()).toBe(1);
    expect(getState().toast).toBeUndefined();
  });

  it('keeps an edit to a scratch list out of memory and storage', async () => {
    const list = newList();
    await renderScreen(<ListEditor source={list} scratch />, { files: FILES, rosters: [list] });
    await addUnit();
    await screen.findByText('Points: 100');
    expect(unitsInMemory()).toBe(0);
    expect(await storedUnits()).toBe(0);
  });
});

describe('adding a list', () => {
  it('saves a new list to memory and storage, stamping the time', async () => {
    await renderScreen(<p>Lists</p>);
    const list = { ...newList(), updated: 0 };
    await addRoster(list);
    const [saved] = getState().rosters;
    expect(saved.updated).toBeGreaterThan(0);
    expect(saved).toEqual({ ...list, updated: saved.updated });
    expect(await db.rosters()).toEqual([saved]);
  });

  it('leaves the list it gets unchanged', async () => {
    await renderScreen(<p>Lists</p>);
    const list = { ...newList(), updated: 0 };
    await addRoster(list);
    expect(list.updated).toBe(0);
  });

  it('keeps its own copy in memory', async () => {
    await renderScreen(<p>Lists</p>);
    const list = newList();
    await addRoster(list);
    list.forces[0].uid = 'edited later';
    expect(getState().rosters.map((r) => r.forces[0].uid)).toEqual(['f1']);
  });
});

describe('a failed save', () => {
  it('shows a toast with Retry when a save fails, and keeps the edit on screen', async () => {
    const list = newList();
    await renderWithToast(list);
    refuse('put');
    await addUnit();
    await waitFor(() => expect(screen.queryByRole('status')?.textContent).toBe(`${SAVE_FAILED}Retry`));
    expect(screen.queryByText('Points: 100')).not.toBeNull();
    expect(unitsInMemory()).toBe(1);
    expect(await storedUnits()).toBe(0);
  });

  it('Retry saves the list as it is at that moment, and a success clears the toast', async () => {
    await renderWithToast(newList());
    const put = refuse('put');
    await addUnit();
    await addUnit();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    await expectToast(SAVE_FAILED);
    expect(await storedUnits()).toBe(0);

    put.mockRestore();
    await pressRetry();

    expect(await storedUnits()).toBe(2);
    expect(getState().toast).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows the toast again when a Retry fails', async () => {
    await renderWithToast(newList());
    const put = refuse('put');
    await addUnit();
    await expectToast(SAVE_FAILED);

    await pressRetry();
    expect(getState().toast).toBeUndefined();
    await expectToast(SAVE_FAILED);
    expect(put).toHaveBeenCalledTimes(2);

    put.mockRestore();
    await pressRetry();
    expect(await storedUnits()).toBe(1);
  });

  it("Retry doesn't bring back a list deleted after the failed save", async () => {
    const list = newList();
    await renderWithToast(list);
    const put = refuse('put');
    await addUnit();
    await expectToast(SAVE_FAILED);

    put.mockRestore();
    await deleteRoster(list.uid);
    await pressRetry();

    expect(await db.rosters()).toEqual([]);
    expect(getState().rosters).toEqual([]);
  });
});

describe('saves of one list that overlap', () => {
  /** The list on screen with a failed save showing, and the app's next two saves held. */
  async function twoHeldSaves(list: Roster) {
    await renderWithToast(list);
    const put = await failASave();
    put.mockRestore();
    const older = holdNextSave();
    await addUnit();
    const newer = holdNextSave();
    await addUnit();
    return { older, newer };
  }

  it('leaves the mark and the toast up when an older save finishes before a newer one answers', async () => {
    const list = newList();
    const { older, newer } = await twoHeldSaves(list);

    await older.finish();
    expect(getState().unsaved.has(list.uid)).toBe(true);
    expect(getState().toast).toBe(SAVE_FAILED);

    await newer.finish();
    expect(getState().unsaved.size).toBe(0);
    expect(getState().toast).toBeUndefined();
  });

  it('keeps a newer failure when an older save finishes after it', async () => {
    const list = newList();
    const { older, newer } = await twoHeldSaves(list);

    await newer.fail();
    await older.finish();

    expect(getState().unsaved.has(list.uid)).toBe(true);
    expect(getState().toast).toBe(SAVE_FAILED);
  });

  it('clears on a newer success, and a save still answering later leaves the next failure alone', async () => {
    const list = newList();
    const { older, newer } = await twoHeldSaves(list);

    await newer.finish();
    expect(getState().unsaved.size).toBe(0);
    expect(getState().toast).toBeUndefined();

    refuse('put');
    await addUnit();
    await expectToast(SAVE_FAILED);
    await older.finish();

    expect(getState().unsaved.has(list.uid)).toBe(true);
    expect(getState().toast).toBe(SAVE_FAILED);
  });

  it('leaves the list unmarked when an older save fails after a newer success', async () => {
    await renderWithToast(newList());
    const older = holdNextSave();
    await addUnit();
    await addUnit();
    await waitFor(async () => expect(await storedUnits()).toBe(2));

    await older.fail();

    expect(getState().unsaved.size).toBe(0);
    expect(getState().toast).toBeUndefined();
    expect(await storedUnits()).toBe(2);
  });

  it('leaves no mark or toast when a save fails after its list was deleted', async () => {
    const list = newList();
    await renderWithToast(list);
    const held = holdNextSave();
    await addUnit();

    await deleteRoster(list.uid);
    await held.fail();

    expect(getState().rosters).toEqual([]);
    expect(getState().unsaved.size).toBe(0);
    expect(getState().toast).toBeUndefined();
  });

  it('counts saves for each list apart', async () => {
    await renderWithToast(newList());
    const put = await failASave();
    put.mockRestore();
    const held = holdNextSave();
    await addUnit();

    await saveRoster({ ...newList(), uid: 'other' });
    await held.finish();

    expect(getState().unsaved.size).toBe(0);
  });
});

describe('a Restore while a save has failed', () => {
  it('keeps the unsaved edit in memory, beside the restored list', async () => {
    const list = newList();
    await renderWithToast(list);
    const put = await failASave();

    put.mockRestore();
    await importRosters([{ ...newList(), uid: 'restored' }]);

    expect(getState().rosters.map((r) => [r.uid, unitsIn(r)])).toEqual([
      ['restored', 0],
      [list.uid, 1],
    ]);
    expect(getState().toast).toBe(SAVE_FAILED);
  });

  it('lets Retry save the edit that storage refused', async () => {
    const list = newList();
    await renderWithToast(list);
    const put = await failASave();

    put.mockRestore();
    await importRosters([{ ...newList(), uid: 'restored' }]);
    await pressRetry();

    const stored = await db.rosters();
    expect(stored.map((r) => [r.uid, unitsIn(r)])).toEqual([
      [list.uid, 1],
      ['restored', 0],
    ]);
    expect(getState().toast).toBeUndefined();
  });

  it('keeps the edit after another toast replaced Retry, and the next save stores it', async () => {
    const list = newList();
    await renderWithToast(list);
    const put = await failASave();
    showUndo();

    put.mockRestore();
    await importRosters([]);
    expect(unitsInMemory()).toBe(1);

    await addUnit();
    await waitFor(async () => expect(await storedUnits()).toBe(2));
    getState().rosters[0].name = 'Changed only in memory';
    await importRosters([]);
    expect(getState().rosters.map((r) => r.name)).toEqual([list.name]);
  });

  it('keeps the edit of every list whose save failed', async () => {
    const first = { ...newList(), uid: 'first' };
    const second = { ...newList(), uid: 'second' };
    await renderScreen(
      <>
        <App />
        <ListEditor source={first} />
        <ListEditor source={second} />
      </>,
      { files: FILES, rosters: [first, second] },
    );
    const adds = async () => {
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'Add a unit' })).toHaveLength(2));
      return screen.getAllByRole('button', { name: 'Add a unit' });
    };
    const [addToFirst, addToSecond] = await adds();
    const put = refuse('put');
    fireEvent.click(addToFirst);
    await expectToast(SAVE_FAILED);
    fireEvent.click(addToSecond);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));

    put.mockRestore();
    await importRosters([]);

    expect(getState().rosters.map(unitsIn)).toEqual([1, 1]);
  });

  it('forgets a list the player deleted after its save failed', async () => {
    const list = newList();
    await renderWithToast(list);
    const put = await failASave();

    put.mockRestore();
    await deleteRoster(list.uid);
    expect(getState().unsaved.size).toBe(0);
  });

  it('reloads every list from storage when no save has failed', async () => {
    const list = newList();
    await renderWithToast(list);
    await addUnit();
    await waitFor(async () => expect(await storedUnits()).toBe(1));
    getState().rosters[0].name = 'Changed only in memory';

    await importRosters([]);

    expect(getState().rosters.map((r) => r.name)).toEqual([list.name]);
  });
});

describe('how long the failed save toast stays up', () => {
  it('outlasts a normal toast, and Retry still works', async () => {
    await renderWithToast(newList());
    await fakeClock();
    const put = await failASave();

    vi.advanceTimersByTime(60_000);
    expect(getState().toast).toBe(SAVE_FAILED);

    put.mockRestore();
    await pressRetry();
    expect(await storedUnits()).toBe(1);
    expect(getState().toast).toBeUndefined();
  });

  it('comes back and stays when the save still fails after another toast replaced it', async () => {
    await renderWithToast(newList());
    await fakeClock();
    await failASave();
    showUndo();

    await addUnit();
    await expectToast(SAVE_FAILED);
    vi.advanceTimersByTime(60_000);
    expect(getState().toast).toBe(SAVE_FAILED);
  });

  it('outlives the timer of an Undo toast it replaced', async () => {
    await renderWithToast(newList());
    await fakeClock();
    showUndo();
    await failASave();

    vi.advanceTimersByTime(5000);
    expect(getState().toast).toBe(SAVE_FAILED);
  });

  it("doesn't stop an Undo toast that replaced it from timing out", async () => {
    await renderWithToast(newList());
    await fakeClock();
    await failASave();
    showUndo();

    vi.advanceTimersByTime(4999);
    expect(getState().toast).toBe('Removed Tactical Squad');
    vi.advanceTimersByTime(1);
    expect(getState().toast).toBeUndefined();
  });

  it('clears when a later edit saves', async () => {
    await renderWithToast(newList());
    const put = await failASave();

    put.mockRestore();
    await addUnit();

    expect(await storedUnits()).toBe(2);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('leaves a different toast up when a later edit saves', async () => {
    await renderWithToast(newList());
    const put = await failASave();
    showUndo();

    put.mockRestore();
    await addUnit();

    expect(await storedUnits()).toBe(2);
    expect(getState().toast).toBe('Removed Tactical Squad');
    expect(getState().toastAction?.label).toBe('Undo');
  });

  it('stays up when a different list saves', async () => {
    await renderWithToast(newList());
    const put = await failASave();

    put.mockRestore();
    await saveRoster({ ...newList(), uid: 'other' });

    expect(getState().toast).toBe(SAVE_FAILED);
  });
});

describe('starting up', () => {
  /** A first open: online with no data, and neither GitHub nor storage will take a download. */
  function failFirstDownload() {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    refuse('put');
  }

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // removing a repo also clears its record in the store's sync progress
    await removeRepo(DEFAULT_REPOS[0]);
  });

  it('shows the reason in a toast when storage refuses the first download', async () => {
    failFirstDownload();
    await init();
    expect(getState().toast).toBe("Couldn't sync: Storage is full");
  });

  it('stops showing a repo as working when storage refuses its failure', async () => {
    failFirstDownload();
    await init();
    expect(getState().sync[DEFAULT_REPOS[0]]?.stage).toBe('error');
  });

  it('gives the reason on the repo that failed and leaves the next repo unstarted', async () => {
    failFirstDownload();
    await init();
    expect(getState().sync).toEqual({
      [DEFAULT_REPOS[0]]: {
        repo: DEFAULT_REPOS[0],
        stage: 'error',
        done: 0,
        total: 0,
        message: "Couldn't sync: Storage is full",
      },
    });
  });

  it('opens with no toast when the browser refuses persistent storage', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('denied'));
    const storage = { persisted: async () => false, persist };
    vi.stubGlobal('navigator', { onLine: false, storage });
    await init();
    expect(persist).toHaveBeenCalled();
    // a trip to storage lets the refusal land first
    await db.repos();
    expect(getState().toast).toBeUndefined();
  });
});
