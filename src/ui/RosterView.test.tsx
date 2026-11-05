// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { children, entry, unit, world } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';

const SERGEANT = entry(
  'sgt',
  'Sergeant',
  20,
  `<constraints>
    <constraint id="sgt-min" type="min" field="selections" scope="parent" value="1"/>
    <constraint id="sgt-max" type="max" field="selections" scope="parent" value="1"/>
  </constraints>`,
);
const ASSAULT = unit('assault', 'Assault Squad', 80);
const UNITS = unit('tac', 'Tactical Squad', 100, children(SERGEANT)) + ASSAULT;

const openHash = (hash: string) => history.replaceState(null, '', hash);

/** Waits for the list itself, as its heading also shows while the data loads. */
async function openList(w: ReturnType<typeof world>, units = UNITS) {
  openHash('#/r/r');
  await renderScreen(<App />, { files: worldFiles(units), rosters: [w.roster] });
  await waitFor(() => expect(sumPoints()).not.toBeUndefined());
}

const sumPoints = () => document.querySelector('.sum-bar .pts')?.textContent;
const chip = () => document.querySelector('.sum-bar .chip');
const issues = () => [...document.querySelectorAll('.issues li')].map((li) => [li.className, li.textContent]);

async function openIssues() {
  const open = chip();
  if (!open) throw new Error('no issues chip on the list');
  fireEvent.click(open);
  const sheet = await screen.findByRole('dialog');
  within(sheet).getByText('List check');
  return sheet;
}

/** Each unit on the list as its name and the points it shows. */
const unitRows = () =>
  [...document.querySelectorAll('.unit-row')].map((row) => [
    row.querySelector('.ur-name')?.textContent,
    row.querySelector('.ur-pts')?.textContent,
  ]);

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  // the app's count of history steps outlives the store reset: each step it counts is one entry at most
  for (let i = 0; i < history.length; i++) dispatchEvent(new PopStateEvent('popstate'));
});

describe('RosterView', () => {
  it('adding a unit shows it with its points and adds them to the total', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    w.add('Assault Squad');
    await openList(w);
    expect(sumPoints()).toBe('80/2,000pts');

    fireEvent.click(screen.getByRole('button', { name: 'Add unit' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Tactical Squad/ }));
    await screen.findByRole('heading', { name: 'Tactical Squad' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(sumPoints()).toBe('200/2,000pts'));
    expect(unitRows()).toEqual([
      ['Assault Squad', '80'],
      ['Tactical Squad', '120'],
    ]);
    const [saved] = await db.rosters();
    expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['assault', 'tac']);
  });

  it('shows going over the limit in the issues sheet, by how much', async () => {
    const w = world(UNITS, { costLimit: 150 });
    w.add('Assault Squad', 3);
    await openList(w);
    expect(chip()?.textContent).toBe('1 issue');

    await openIssues();

    expect(issues()).toEqual([['error', 'Over points limit by 90']]);
  });

  it('opens the unit from an issue on it in the issues sheet', async () => {
    const units = unit(
      'tac',
      'Tactical Squad',
      100,
      `<constraints>
        <constraint id="tac-max" type="max" field="selections" scope="parent" value="1"/>
      </constraints>`,
    );
    const w = world(units);
    const sel = w.add('Tactical Squad', 3);
    await openList(w, units);
    expect(chip()?.textContent).toBe('1 issue');

    const sheet = await openIssues();
    fireEvent.click(within(sheet).getByRole('link', { name: 'Tactical Squad: at most 1 allowed (has 3)' }));

    await screen.findByRole('heading', { name: 'Tactical Squad' });
    expect(location.hash).toBe(`#/r/r/u/${sel}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a unit gone from the data as a note in the issues sheet', async () => {
    const w = world(UNITS);
    w.add('Tactical Squad');
    w.add('Assault Squad');
    await openList(w, ASSAULT);
    expect(chip()?.textContent).toBe('1 note');

    await openIssues();

    expect(issues()).toEqual([['warn', '1 unit(s) no longer exist in the data and were skipped']]);
    expect(sumPoints()).toBe('80pts');
  });

  it('says so in the issues sheet when a list has no issues', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    w.add('Assault Squad');
    await openList(w);
    expect(chip()?.textContent).toBe('Valid');

    const sheet = await openIssues();

    within(sheet).getByText(/No problems found/);
    expect(issues()).toEqual([]);
  });
});
