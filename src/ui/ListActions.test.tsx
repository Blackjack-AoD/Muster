// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { getState } from '../store';
import { unit, world } from '../test/fixture';
import {
  expectToast,
  openCreateList,
  openHash,
  press,
  refuse,
  renderScreen,
  stubBrowserGaps,
  worldFiles,
} from '../test/screen';

const UNITS = unit('tac', 'Tactical Squad', 100);
const FILES = worldFiles(UNITS);
const { roster } = world(UNITS);

// oxlint-disable-next-line typescript/unbound-method -- the spy calls it on the store
const realPut = IDBObjectStore.prototype.put;
const storedUids = async () => (await db.rosters()).map((r) => r.uid);
const uidsInMemory = () => getState().rosters.map((r) => r.uid);

async function openListMenu() {
  openHash(`#/r/${roster.uid}`);
  await renderScreen(<App />, { files: FILES, rosters: [roster] });
  await press('List options');
}

beforeEach(async () => {
  await stubBrowserGaps();
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('list actions', () => {
  it("keeps the Retry toast up when Duplicate list can't save the list or its copy", async () => {
    await openListMenu();
    const put = refuse('put');

    await press('Duplicate list');

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    // a trip to storage lets both refused saves report, whichever finishes last
    expect(await storedUids()).toEqual([roster.uid]);
    await waitFor(() => expect(screen.queryByRole('status')?.textContent).toBe("Couldn't save this listRetry"));
    expect(location.hash).toBe(`#/r/${roster.uid}`);
  });

  it('shows the reason in a toast when only the copy fails to save', async () => {
    await openListMenu();
    refuse('put').mockImplementationOnce(realPut);

    await press('Duplicate list');

    await expectToast("Couldn't copy this list: Storage is full");
    expect(getState().toastAction).toBeUndefined();
    expect(location.hash).toBe(`#/r/${roster.uid}`);
    expect(await storedUids()).toEqual([roster.uid]);
  });

  it('Duplicate list saves a copy and opens it', async () => {
    await openListMenu();

    await press('Duplicate list');

    await expectToast('List duplicated');
    const copy = getState().rosters.find((r) => r.uid !== roster.uid);
    expect(copy?.name).toBe('Test list (copy)');
    expect(location.hash).toBe(`#/r/${copy?.uid}`);
    expect(new Set(await storedUids())).toEqual(new Set([roster.uid, copy?.uid]));
  });

  it('Delete list removes the list and returns to Lists', async () => {
    await openListMenu();

    await press('Delete list');

    await waitFor(() => expect(location.hash).toBe('#/'));
    expect(uidsInMemory()).toEqual([]);
    expect(await storedUids()).toEqual([]);
  });

  it('shows the reason in a toast when a delete fails, and keeps the list open', async () => {
    await openListMenu();
    refuse('delete');

    await press('Delete list');

    await expectToast("Couldn't delete this list: Storage is full");
    expect(location.hash).toBe(`#/r/${roster.uid}`);
    expect(getState().rosters.map((r) => r.uid)).toEqual([roster.uid]);
    expect(await storedUids()).toEqual([roster.uid]);
  });

  it('shows the reason in a toast when a new list fails to save, and stays where it was', async () => {
    await openCreateList(FILES);
    refuse('put');

    await press('Create list');

    await expectToast("Couldn't create this list: Storage is full");
    expect(location.hash).toBe('#/');
    expect(await storedUids()).toEqual([]);
  });

  it('leaves a copy that fails to save off the Lists screen and out of memory', async () => {
    await openListMenu();
    refuse('put');

    await press('Duplicate list');
    location.hash = '#/';

    await screen.findByRole('heading', { name: 'Muster' });
    await waitFor(() => expect(screen.queryByText(`${roster.name} (copy)`)).toBeNull());
    expect(uidsInMemory()).toEqual([roster.uid]);
    expect(await storedUids()).toEqual([roster.uid]);
  });

  it('leaves a new list that fails to save off the Lists screen and out of memory', async () => {
    await openCreateList(FILES);
    refuse('put');

    await press('Create list');

    await waitFor(() => expect(screen.queryByText('No lists yet')).not.toBeNull());
    expect(uidsInMemory()).toEqual([]);
    expect(await storedUids()).toEqual([]);
  });
});
