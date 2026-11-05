// @vitest-environment jsdom
import { screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../data/db';
import { Evaluator, type Roster } from '../data/engine';
import { contextsFor } from '../data/library';
import { getState, saveRoster, setGame, syncAll, toast } from '../store';
import { Lists } from '../ui/Lists';
import { unit, world } from './fixture';
import { renderScreen, resetStore, worldFiles } from './screen';

const UNITS = unit('tac', 'Tactical Squad', 100);

afterEach(() => vi.unstubAllGlobals());

describe('renderScreen', () => {
  it('renders a Preact component in a file that opts in to jsdom', async () => {
    await renderScreen(<p>Muster on a test page</p>, { files: worldFiles(UNITS) });
    expect(screen.queryByText('Muster on a test page')?.tagName).toBe('P');
  });

  it('saves a seeded list to the real store and IndexedDB', async () => {
    const { roster } = world(UNITS);
    await renderScreen(<Lists />, { rosters: [roster], files: worldFiles(UNITS) });
    expect(getState().rosters.map((r) => r.uid)).toEqual(['r']);
    expect((await db.rosters()).map((r) => r.name)).toEqual(['Test list']);
  });

  it('seeds data files that the real library loads and prices', async () => {
    const w = world(UNITS);
    const tactical = w.add('Tactical Squad');
    await renderScreen(<Lists />, { rosters: [w.roster], files: worldFiles(UNITS) });
    expect(getState().repos.map((r) => r.repo)).toEqual([w.roster.repo]);
    const contexts = await contextsFor(w.roster, getState().repos);
    expect(new Evaluator(w.roster, contexts).find(tactical)?.total).toBe(100);
  });

  it('seeds the same gst and cat options as world', async () => {
    const options = {
      gst: '<forceEntries><forceEntry id="patrol" name="Patrol"/></forceEntries>',
      cat: `<entryLinks><entryLink id="link" name="Scout Squad" targetId="scouts" type="selectionEntry"/></entryLinks>
        <sharedSelectionEntries>${unit('scouts', 'Scout Squad', 60)}</sharedSelectionEntries>`,
    };
    const w = world('', options);
    const scouts = w.add('Scout Squad');
    await renderScreen(<Lists />, { rosters: [w.roster], files: worldFiles('', options) });
    expect(getState().repos.map((r) => r.repo)).toEqual([w.roster.repo]);
    const contexts = await contextsFor(w.roster, getState().repos);
    expect(
      contexts
        .get('cat')
        ?.forceEntries()
        .map((f) => f.name),
    ).toEqual(['Patrol']);
    expect(new Evaluator(w.roster, contexts).find(scouts)?.total).toBe(60);
  });

  it('shows a seeded list on the Lists screen', async () => {
    const { roster } = world(UNITS, { costLimit: 2000 });
    await renderScreen(<Lists />, { rosters: [roster], files: worldFiles(UNITS) });
    const card = screen.queryByRole('link', { name: /Test list/ });
    expect(card?.getAttribute('href')).toBe('#/r/r');
    expect(card?.textContent).toContain('Test Army');
    expect(card?.textContent).toContain('Test Game');
    expect(card?.textContent).toContain('2,000');
  });
});

describe('between tests', () => {
  it.each([1, 2])('starts each test with an empty screen and store: run %i', async () => {
    expect(document.body.textContent).toBe('');
    expect(getState().rosters).toEqual([]);
    expect(getState().repos).toEqual([]);
    expect(await db.rosters()).toEqual([]);
    expect(await db.repos()).toEqual([]);
    await renderScreen(<Lists />, { rosters: [world(UNITS).roster], files: worldFiles(UNITS) });
  });

  it('resetStore clears the toast, chosen game, sync status and storage', async () => {
    await renderScreen(<Lists />, { rosters: [world(UNITS).roster], files: worldFiles(UNITS) });
    toast('Saved', { label: 'Undo', run: () => {} });
    setGame('test/repo|gst');
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await syncAll(['no/repo']);

    await resetStore();

    const { toast: message, toastAction, game, sync, repos, rosters } = getState();
    expect({ message, toastAction, game, sync, repos, rosters }).toEqual({
      message: undefined,
      toastAction: undefined,
      game: undefined,
      sync: {},
      repos: [],
      rosters: [],
    });
    expect(localStorage.getItem('muster.game')).toBeNull();
    expect(await db.repos()).toEqual([]);
    expect(await db.rosters()).toEqual([]);
    expect(await db.getFile('test/repo', 'test.cat')).toBeUndefined();
  });

  it('resetStore clears the sync status of a repo that storage refused', async () => {
    await renderScreen(<Lists />);
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    await syncAll(['no/repo']);
    put.mockRestore();

    await resetStore();

    expect(getState().sync).toEqual({});
  });

  it('resetStore forgets a list that only reached memory because its save failed', async () => {
    await renderScreen(<Lists />);
    const noKey = { ...world(UNITS).roster, uid: undefined } as unknown as Roster;
    await expect(saveRoster(noKey)).rejects.toMatchObject({ name: 'DataError' });
    expect(getState().rosters.some((r) => r.uid === undefined)).toBe(true);

    await resetStore();

    expect(getState().rosters).toEqual([]);
  });

  it('resetStore drops parsed data, so a seed with the same ids reads fresh', async () => {
    const before = world(UNITS);
    await renderScreen(<Lists />, { rosters: [before.roster], files: worldFiles(UNITS) });
    await contextsFor(before.roster, getState().repos);

    await resetStore();

    const cheaper = unit('tac', 'Tactical Squad', 80);
    const w = world(cheaper);
    const tactical = w.add('Tactical Squad');
    await renderScreen(<Lists />, { rosters: [w.roster], files: worldFiles(cheaper) });
    const contexts = await contextsFor(w.roster, getState().repos);
    expect(new Evaluator(w.roster, contexts).find(tactical)?.total).toBe(80);
  });

  it('does not download the default repos when the seed holds nothing', async () => {
    const download = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', download);
    await renderScreen(<Lists />);
    // a sync would reach fetch as soon as its own read of the repos finishes, before this later read
    await db.repos();
    expect(download).not.toHaveBeenCalled();
  });
});
