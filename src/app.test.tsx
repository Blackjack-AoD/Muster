// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { App, go } from './app';
import { toast } from './store';
import { unit, world } from './test/fixture';
import { renderScreen, worldFiles } from './test/screen';
import { encodeSnapshot, viewUrl, type Snapshot } from './ui/snapshot';

const UNITS = unit('tac', 'Tactical Squad', 100);

const openHash = (hash: string) => history.replaceState(null, '', hash);

/** A list holding a Tactical Squad, with the parts an address needs to reach that squad. */
function seededWorld() {
  const w = world(UNITS);
  const sel = w.add('Tactical Squad');
  return { roster: w.roster, sel, unitKey: w.root('Tactical Squad').key };
}

const renderApp = (roster = seededWorld().roster) =>
  renderScreen(<App />, { files: worldFiles(UNITS), rosters: [roster] });

const heading = (name: string) => () => screen.findByRole('heading', { name });
const selectedTab = (name: string) => () => screen.findByRole('tab', { name, selected: true });
const button = (name: string) => () => screen.findByRole('button', { name });

const activeTab = () => document.querySelector('.tabbar .on')?.textContent;
const hasTabBar = () => document.querySelector('.tabbar') !== null;

/** The phone's back button. History moves a moment after the call, so this waits for it. */
async function pressBack() {
  const moved = new Promise((resolve) => addEventListener('popstate', resolve, { once: true }));
  history.back();
  await moved;
}

/** Reaches the list from Games, which isn't where the Back arrow would fall back to. */
async function openListFromGames() {
  openHash('#/games');
  await renderApp();
  go('/r/r');
  await button('List options')();
}

async function openOptions() {
  fireEvent.click(await button('List options')());
  await screen.findByRole('dialog');
}

const noPopUp = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

let scrollTo: Mock;

beforeEach(async () => {
  scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo); // jsdom has none, and App calls it on each address
  vi.stubGlobal('matchMedia', () => ({ matches: false })); // jsdom has none, and DataView asks if it's installed
  // share links pack through Blob.stream(), which jsdom's Blob lacks; Response still makes Node's
  vi.stubGlobal('Blob', (await new Response().blob()).constructor);
  // the app's count of history steps outlives the store reset: each step it counts is one entry at most
  for (let i = 0; i < history.length; i++) dispatchEvent(new PopStateEvent('popstate'));
  openHash('#/');
});

afterEach(() => vi.unstubAllGlobals());

describe('routes', () => {
  it.each([
    { hash: '', shows: heading('Muster'), tab: 'Lists' },
    { hash: '#/', shows: heading('Muster'), tab: 'Lists' },
    { hash: '#/no-such-screen', shows: heading('Muster'), tab: 'Lists' },
    { hash: '#/games', shows: heading('Games'), tab: 'Games' },
    { hash: '#/lib', shows: selectedTab('Armies'), tab: 'Library' },
    { hash: '#/lib/test/repo', shows: selectedTab('Armies'), tab: 'Library' },
    { hash: '#/lib-rules', shows: selectedTab('Rules'), tab: 'Library' },
    { hash: '#/lib/test/repo/cat', shows: heading('Test Army'), tab: 'Library' },
    { hash: '#/data', shows: heading('Data'), tab: 'Data' },
  ])("'$hash' shows its screen under the $tab tab", async ({ hash, shows, tab }) => {
    openHash(hash || location.pathname);
    await renderApp();
    await shows();
    expect(activeTab()).toBe(tab);
  });

  it.each([
    {
      to: 'a unit in the Library',
      hash: (_: string, key: string) => `#/lib/test/repo/cat/${key}`,
      shows: heading('Tactical Squad'),
    },
    { to: 'a list', hash: () => '#/r/r', shows: button('List options') },
    { to: 'its army sheet', hash: () => '#/r/r/sheet', shows: button('Print / save PDF') },
    { to: 'a unit in a list', hash: (sel: string) => `#/r/r/u/${sel}`, shows: heading('Tactical Squad') },
  ])('shows $to with no tab bar', async ({ hash, shows }) => {
    const { roster, sel, unitKey } = seededWorld();
    openHash(hash(sel, unitKey));
    await renderApp(roster);
    await shows();
    expect(hasTabBar()).toBe(false);
  });

  it('shows a share link with no tab bar', async () => {
    const snapshot: Snapshot = {
      v: 1,
      name: 'Friendly Fire',
      game: 'Test Game',
      pts: 0,
      limit: 0,
      forces: [],
      issues: 0,
      at: 0,
    };
    openHash(new URL(viewUrl((await encodeSnapshot(snapshot)).data)).hash);
    await renderScreen(<App />);
    await screen.findByRole('heading', { name: 'Friendly Fire' });
    expect(hasTabBar()).toBe(false);
  });

  it('decodes an address before matching a list', async () => {
    openHash('#/r/my%20list');
    await renderApp({ ...seededWorld().roster, uid: 'my list' });
    await button('List options')();
  });

  it('swaps the screen and returns to the top when a tab is tapped', async () => {
    await renderApp();
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'Games' }));
    await heading('Games')();
    expect(location.hash).toBe('#/games');
    expect(activeTab()).toBe('Games');
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0));
  });
});

describe('the back button', () => {
  it('closes a pop-up and stays on the screen, then leaves on the next press', async () => {
    await openListFromGames();
    await openOptions();

    await pressBack();

    await noPopUp();
    expect(location.hash).toBe('#/r/r');
    await button('List options')();

    await pressBack();

    await heading('Games')();
    expect(location.hash).toBe('#/games');
  });

  it("takes a pop-up's history step off when the X closes it", async () => {
    await openListFromGames();
    await openOptions();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await noPopUp();
    await waitFor(() => expect(history.state).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Games')();
    expect(location.hash).toBe('#/games');
  });

  it('closes a pop-up on a list opened from its address, and the Back arrow goes to Lists', async () => {
    // the entry behind this one isn't the app's, as when a link opens the list
    openHash('#/games');
    history.pushState(null, '', '#/r/r');
    await renderApp();
    await openOptions();

    await pressBack();

    await noPopUp();
    expect(location.hash).toBe('#/r/r');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Muster')();
    expect(location.hash).toBe('#/');
  });
});

describe('the toast', () => {
  it('shows its message and action, and tapping the action runs it once and clears the toast', async () => {
    const run = vi.fn();
    await renderApp();

    toast('Removed Tactical Squad', { label: 'Undo', run });

    const status = await screen.findByRole('status');
    within(status).getByText('Removed Tactical Squad');
    fireEvent.click(within(status).getByRole('button', { name: 'Undo' }));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('shows no button when the toast has no action', async () => {
    await renderApp();

    toast('Link copied');

    const status = await screen.findByRole('status');
    within(status).getByText('Link copied');
    expect(within(status).queryByRole('button')).toBeNull();
  });
});
