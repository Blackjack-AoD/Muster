// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { App, go } from './app';
import { toast } from './store';
import { unit, world } from './test/fixture';
import { linkHash, openHash, renderScreen, stubBrowserGaps, worldFiles } from './test/screen';
import { Sheet } from './ui/common';
import type { Snapshot } from './ui/snapshot';

const UNITS = unit('tac', 'Tactical Squad', 100);

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
  await stubBrowserGaps();
  scrollTo = vi.fn();
  vi.stubGlobal('scrollTo', scrollTo);
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
    openHash(await linkHash(snapshot));
    await renderScreen(<App />);
    await screen.findByRole('heading', { name: 'Friendly Fire' });
    expect(hasTabBar()).toBe(false);
  });

  it.each(['#/view', '#/view/'])('%s holds no list, so it shows Lists with the tab bar', async (hash) => {
    openHash(hash);
    await renderApp();
    await heading('Muster')();
    expect(activeTab()).toBe('Lists');
  });

  it('decodes an address before matching a list', async () => {
    openHash('#/r/my%20list');
    await renderApp({ ...seededWorld().roster, uid: 'my list' });
    await button('List options')();
  });

  it('swaps the screen and returns to the top when the player taps a tab', async () => {
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

  it('steps back through a pop-up opened from a pop-up, and leaves only once both are closed', async () => {
    await openListFromGames();
    fireEvent.click(screen.getByRole('button', { name: 'Add detachment' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tap to change/ }));
    await heading('Army')();

    await pressBack();

    await heading('Add detachment')();
    expect(location.hash).toBe('#/r/r');

    await pressBack();

    await noPopUp();
    expect(location.hash).toBe('#/r/r');

    await pressBack();

    await heading('Games')();
  });
});

describe('a pop-up opened from a pop-up', () => {
  async function openArmyPicker() {
    await openListFromGames();
    fireEvent.click(screen.getByRole('button', { name: 'Add detachment' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tap to change/ }));
    await heading('Army')();
  }

  it('leaves no step behind when Back closes the inner one and the X closes the outer one', async () => {
    await openArmyPicker();
    await pressBack();
    await heading('Add detachment')();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await noPopUp();
    await waitFor(() => expect(history.state).toBeNull());
    await pressBack();
    await heading('Games')();
  });

  it('keeps the outer one open while its own step is under Back', async () => {
    await openArmyPicker();
    const outerStep = history.state;

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await heading('Add detachment')();
    await waitFor(() => expect(history.state).toEqual(outerStep));

    history.pushState(null, '', location.href);
    await pressBack();

    expect(history.state).toEqual(outerStep);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    await heading('Add detachment')();
  });
});

describe('two pop-ups', () => {
  function Stacked() {
    const [topOpen, setTopOpen] = useState(false);
    return (
      <Sheet title="Outer" onClose={() => {}}>
        <button onClick={() => setTopOpen(true)}>Open the top one</button>
        {topOpen && (
          <Sheet title="Top" onClose={() => setTopOpen(false)}>
            Top sheet
          </Sheet>
        )}
      </Sheet>
    );
  }

  it('closes only the top one on Back when both are up', async () => {
    await renderScreen(<Stacked />);
    fireEvent.click(await button('Open the top one')());
    await heading('Top')();

    await pressBack();

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Top' })).toBeNull());
    await heading('Outer')();
  });

  it('gives a pop-up that takes over from another its own step, which the X then removes', async () => {
    await openListFromGames();
    go('/');
    fireEvent.click(await button('New list')());
    fireEvent.click(await button('Test Army')());
    await button('Create list')();
    await waitFor(() => expect(history.state?.sheet).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await noPopUp();
    await waitFor(() => expect(history.state).toBeNull());
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
