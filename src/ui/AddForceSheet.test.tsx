// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { getState } from '../store';
import { unit, world } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';

const UNITS = unit('tac', 'Tactical Squad', 100);

afterEach(() => vi.unstubAllGlobals());

it('shows the reason in a toast when an army fails to load', async () => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  const { roster } = world(UNITS);
  history.replaceState(null, '', `#/r/${roster.uid}`);
  const files = {
    ...worldFiles(UNITS),
    'other.cat': '<catalogue id="other" name="Other Army" revision="1" gameSystemId="gst"/>',
  };
  await renderScreen(<App />, { files, rosters: [roster] });
  await db.delFile('test/repo', 'other.cat');

  fireEvent.click(await screen.findByRole('button', { name: 'Add detachment' }));
  fireEvent.click(await screen.findByText('Tap to change'));
  fireEvent.click(await screen.findByRole('button', { name: 'Other Army' }));

  await waitFor(() =>
    expect(getState().toast).toBe("Couldn't load this army: Missing data file other.cat. Try syncing again."),
  );
});
