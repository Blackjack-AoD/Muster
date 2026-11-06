// @vitest-environment jsdom
import { screen } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../app';
import type { Roster } from '../data/engine';
import { getState } from '../store';
import { TWO_FORCES, unit, world } from '../test/fixture';
import { openHash, press, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';

const UNITS = unit('tac', 'Tactical Squad', 100);

afterEach(() => vi.unstubAllGlobals());

/** A list with the Detachment and an Allies detachment, one Tactical Squad in the Allies. */
function twoDetachments(): Roster {
  const { roster } = world(UNITS, { gst: TWO_FORCES });
  roster.forces.push({
    uid: 'f2',
    forceEntryId: 'ally',
    catalogueId: 'cat',
    selections: [{ uid: 's1', key: 'tac', number: 1, children: [] }],
  });
  return roster;
}

async function open(roster: Roster) {
  await stubBrowserGaps();
  openHash(`#/r/${roster.uid}`);
  await renderScreen(<App />, { files: worldFiles(UNITS, { gst: TWO_FORCES }), rosters: [roster] });
}

it('deletes a detachment and its units from its header, after asking', async () => {
  const ask = vi.fn(() => true);
  vi.stubGlobal('confirm', ask);
  await open(twoDetachments());

  await press('Delete Allies');

  expect(ask).toHaveBeenCalledWith('Delete Allies and its 1 unit(s)?');
  expect(getState().rosters[0]?.forces.map((f) => f.uid)).toEqual(['f1']);
});

it('keeps the detachment when the player says no', async () => {
  vi.stubGlobal('confirm', () => false);
  await open(twoDetachments());

  await press('Delete Allies');

  expect(getState().rosters[0]?.forces.map((f) => f.uid)).toEqual(['f1', 'f2']);
});

it('offers no delete on the only detachment of a list', async () => {
  const { roster } = world(UNITS, { gst: TWO_FORCES });
  await open(roster);

  await screen.findByText('Detachment');
  expect(screen.queryByRole('button', { name: 'Delete Detachment' })).toBeNull();
});
