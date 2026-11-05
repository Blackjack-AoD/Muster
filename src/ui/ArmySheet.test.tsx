// @vitest-environment jsdom
import { screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { children, entry, unit, world } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';
import { encodeSnapshot, viewUrl, type Snapshot } from './snapshot';

const UNITS =
  unit('tac', 'Tactical Squad', 100, children(entry('melta', 'Melta Gun', 15))) + unit('assault', 'Assault Squad', 80);

const SHARED: Snapshot = {
  v: 1,
  name: 'Friendly Fire',
  game: 'Test Game',
  pts: 1275,
  limit: 2000,
  forces: [
    {
      name: 'Detachment',
      army: 'Test Army',
      pts: 1275,
      units: [
        { name: 'Land Raider', cat: 'Heavy', pts: 1250, gear: [], profiles: [], rules: [] },
        { name: 'Servitor', cat: 'Elites', pts: 25, gear: [], profiles: [], rules: [] },
      ],
    },
  ],
  issues: 0,
  at: 0,
};

const linkHash = async (snap: Snapshot) => new URL(viewUrl((await encodeSnapshot(snap)).data)).hash;
/** Packs a value no Snapshot type allows, as a damaged or hand-made link would hold. */
const linkHashOf = (value: unknown) => linkHash(value as Snapshot);
const openHash = (hash: string) => history.replaceState(null, '', hash);

/** Each unit on the sheet as its name and the points it shows. */
const sheetUnits = () =>
  [...document.querySelectorAll('.as-unit')].map((card) => [
    card.querySelector('b')?.textContent,
    card.querySelector('.as-unit-pts')?.textContent,
  ]);

beforeEach(async () => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  // share links pack through Blob.stream(), which jsdom's Blob lacks; Response still makes Node's
  vi.stubGlobal('Blob', (await new Response().blob()).constructor);
});

describe('SheetPage', () => {
  it('shows each unit on the army sheet with its points', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    w.pick(w.add('Tactical Squad'), 'Melta Gun');
    w.add('Assault Squad', 2);
    openHash('#/r/r/sheet');

    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [w.roster] });

    await screen.findByRole('heading', { name: 'Test list' });
    expect(sheetUnits()).toEqual([
      ['Tactical Squad', '115'],
      ['2× Assault Squad', '160'],
    ]);
    expect(document.querySelector('.as-pts')?.textContent).toBe('275 / 2,000 pts');
  });
});

describe('SharedView', () => {
  it('opens a share link as a read-only list, with no game data on the phone', async () => {
    openHash(await linkHash(SHARED));

    await renderScreen(<App />);

    await screen.findByRole('heading', { name: 'Friendly Fire' });
    expect(sheetUnits()).toEqual([
      ['Land Raider', '1,250'],
      ['Servitor', '25'],
    ]);
    expect(document.querySelector('.as-pts')?.textContent).toBe('1,275 / 2,000 pts');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent.trim());
    expect(buttons).toEqual(['Open Muster', 'Print / save PDF', 'Share link']);
    expect(document.querySelector('.tabbar')).toBeNull();
    expect(await db.rosters()).toEqual([]);
  });

  it.each([
    { broken: 'a link cut short', hash: async () => (await linkHash(SHARED)).slice(0, 30) },
    { broken: 'a link that holds no packed data', hash: async () => '#/view/not-a-list!' },
    { broken: 'a list from a newer Muster', hash: () => linkHashOf({ ...SHARED, v: 2 }) },
  ])('shows the readable error for $broken', async ({ hash }) => {
    openHash(await hash());

    await renderScreen(<App />);

    await screen.findByText("This link doesn't contain a readable list. It may have been cut short when it was sent.");
    expect(sheetUnits()).toEqual([]);
  });
});
