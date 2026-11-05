// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { clearCaches } from '../data/library';
import { getState } from '../store';
import { unit, world } from '../test/fixture';
import { expectToast, openHash, press, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';

const UNITS = unit('tac', 'Tactical Squad', 100);

afterEach(() => vi.unstubAllGlobals());

it('shows the reason in a toast when an army fails to load', async () => {
  await stubBrowserGaps();
  const { roster } = world(UNITS);
  openHash(`#/r/${roster.uid}`);
  const files = {
    ...worldFiles(UNITS),
    'other.cat': '<catalogue id="other" name="Other Army" revision="1" gameSystemId="gst"/>',
  };
  await renderScreen(<App />, { files, rosters: [roster] });
  await db.delFile('test/repo', 'other.cat');

  await press('Add detachment');
  fireEvent.click(await screen.findByText('Tap to change'));
  await press('Other Army');

  await expectToast("Couldn't load this army: Missing data file other.cat. Try syncing again.");
});

it('shows the reason in a toast when the picked detachment fails to load, and adds nothing', async () => {
  await stubBrowserGaps();
  const { roster } = world(UNITS);
  openHash(`#/r/${roster.uid}`);
  await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [roster] });

  await press('Add detachment');
  const detachment = await screen.findByRole('button', { name: 'Detachment' });
  await db.delFile('test/repo', 'test.cat');
  clearCaches('test/repo');
  fireEvent.click(detachment);

  await expectToast("Couldn't load this army: Missing data file test.cat. Try syncing again.");
  expect(getState().rosters[0]?.forces).toHaveLength(1);
});
