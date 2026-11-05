// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { db } from './data/db';
import { addSel, forceRootOptions, type Roster } from './data/engine';
import { DEFAULT_REPOS } from './data/sync';
import { deleteRoster, getState, init, removeRepo, saveRoster, toast, useRosterCtl } from './store';
import { unit, world } from './test/fixture';
import { renderScreen, worldFiles } from './test/screen';

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
const addUnit = async () => fireEvent.click(await screen.findByRole('button', { name: 'Add a unit' }));
const pressRetry = async () => fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

/** Storage refuses every write until restored, as a full phone would. */
const failSaves = () =>
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });

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

/** Installed once the list has loaded, as loading waits on a timer. Leaves storage's own scheduling real. */
async function fakeClock() {
  await screen.findByRole('button', { name: 'Add a unit' });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

async function failASave() {
  const put = failSaves();
  await addUnit();
  await waitFor(() => expect(getState().toast).toBe(SAVE_FAILED));
  return put;
}

const showUndo = () => toast('Removed Tactical Squad', { label: 'Undo', run: () => {} });

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
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

describe('a failed save', () => {
  it('shows a toast with Retry when a save fails, and keeps the edit on screen', async () => {
    const list = newList();
    await renderWithToast(list);
    failSaves();
    await addUnit();
    await waitFor(() => expect(screen.queryByRole('status')?.textContent).toBe(`${SAVE_FAILED}Retry`));
    expect(screen.queryByText('Points: 100')).not.toBeNull();
    expect(unitsInMemory()).toBe(1);
    expect(await storedUnits()).toBe(0);
  });

  it('Retry saves the list as it is at that moment, and a success clears the toast', async () => {
    await renderWithToast(newList());
    const put = failSaves();
    await addUnit();
    await addUnit();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getState().toast).toBe(SAVE_FAILED));
    expect(await storedUnits()).toBe(0);

    put.mockRestore();
    await pressRetry();

    expect(await storedUnits()).toBe(2);
    expect(getState().toast).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows the toast again when a Retry fails', async () => {
    await renderWithToast(newList());
    const put = failSaves();
    await addUnit();
    await waitFor(() => expect(getState().toast).toBe(SAVE_FAILED));

    await pressRetry();
    expect(getState().toast).toBeUndefined();
    await waitFor(() => expect(getState().toast).toBe(SAVE_FAILED));
    expect(put).toHaveBeenCalledTimes(2);

    put.mockRestore();
    await pressRetry();
    expect(await storedUnits()).toBe(1);
  });

  it("Retry doesn't bring back a list deleted after the failed save", async () => {
    const list = newList();
    await renderWithToast(list);
    const put = failSaves();
    await addUnit();
    await waitFor(() => expect(getState().toast).toBe(SAVE_FAILED));

    put.mockRestore();
    await deleteRoster(list.uid);
    await pressRetry();

    expect(await db.rosters()).toEqual([]);
    expect(getState().rosters).toEqual([]);
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
    await waitFor(() => expect(getState().toast).toBe(SAVE_FAILED));
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
    failSaves();
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

  // BUG: a sync that can't record its failure stays "working", which disables every sync button until a reload
  it.fails('stops showing a repo as working when storage refuses its failure', async () => {
    failFirstDownload();
    await init();
    expect(getState().sync[DEFAULT_REPOS[0]]?.stage).toBe('error');
  });

  it('opens with no toast when the browser refuses persistent storage', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('denied'));
    const storage = { persisted: async () => false, persist };
    vi.stubGlobal('navigator', { onLine: false, storage });
    await init();
    expect(persist).toHaveBeenCalled();
    expect(getState().toast).toBeUndefined();
  });
});
