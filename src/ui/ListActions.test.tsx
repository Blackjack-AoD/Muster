// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { getState } from '../store';
import { unit, world } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';

const UNITS = unit('tac', 'Tactical Squad', 100);
const FILES = worldFiles(UNITS);
const { roster } = world(UNITS);

const refuse = (method: 'put' | 'delete') =>
  vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });
const expectToast = (text: string) => waitFor(() => expect(getState().toast).toBe(text));
const press = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }));
const storedUids = async () => (await db.rosters()).map((r) => r.uid);
const uidsInMemory = () => getState().rosters.map((r) => r.uid);

async function openListMenu() {
  history.replaceState(null, '', `#/r/${roster.uid}`);
  await renderScreen(<App />, { files: FILES, rosters: [roster] });
  await press('List options');
}

async function openCreateList() {
  history.replaceState(null, '', '#/');
  await renderScreen(<App />, { files: FILES });
  await press('New list');
  await press('Test Army');
  await screen.findByRole('button', { name: 'Create list' });
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('list actions', () => {
  it('shows the reason in a toast when a copy fails to save, and stays on the list', async () => {
    await openListMenu();
    refuse('put');

    await press('Duplicate list');

    await expectToast("Couldn't copy this list: Storage is full");
    expect(location.hash).toBe(`#/r/${roster.uid}`);
    expect(await storedUids()).toEqual([roster.uid]);
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
    await openCreateList();
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
    await openCreateList();
    refuse('put');

    await press('Create list');

    await waitFor(() => expect(screen.queryByText('No lists yet')).not.toBeNull());
    expect(uidsInMemory()).toEqual([]);
    expect(await storedUids()).toEqual([]);
  });
});
