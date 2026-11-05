// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import type { Roster } from '../data/engine';
import { COST_TYPES, FORCE } from '../test/fixture';
import { renderScreen } from '../test/screen';

const FILES = {
  'first.gst': `<gameSystem id="first" name="First Game" revision="1">${COST_TYPES}${FORCE}</gameSystem>`,
  'first.cat': '<catalogue id="first-cat" name="First Army" revision="1" gameSystemId="first"/>',
  'second.gst': `<gameSystem id="second" name="Second Game" revision="1">${COST_TYPES}${FORCE}</gameSystem>`,
  'second.cat': '<catalogue id="second-cat" name="Second Army" revision="1" gameSystemId="second"/>',
};

const list = (uid: string, name: string, gameSystemId: string): Roster => ({
  uid,
  name,
  repo: 'test/repo',
  gameSystemId,
  costLimit: 2000,
  forces: [],
  created: 0,
  updated: 0,
});

const ROSTERS = [list('a', 'First list', 'first'), list('b', 'Second list', 'second')];

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  history.replaceState(null, '', '#/games');
});

describe('Games', () => {
  it.each([
    { game: 'First Game', kept: 'First list', hidden: 'Second list' },
    { game: 'Second Game', kept: 'Second list', hidden: 'First list' },
  ])('shows only the $game lists after picking it', async ({ game, kept, hidden }) => {
    await renderScreen(<App />, { files: FILES, rosters: ROSTERS });

    fireEvent.click(screen.getByRole('button', { name: new RegExp(game) }));

    await screen.findByRole('link', { name: new RegExp(kept) });
    expect(screen.queryByRole('link', { name: new RegExp(hidden) })).toBeNull();
    expect(document.body.textContent).toContain('1 list in other games.');
  });
});
