// Renders a screen on the real store, with data and lists seeded into fake-indexeddb.
import 'fake-indexeddb/auto';
import { cleanup, render } from '@testing-library/preact';
import type { ComponentChild } from 'preact';
import { afterEach, vi } from 'vitest';
import { db } from '../data/db';
import type { Roster } from '../data/engine';
import { importLocalFiles } from '../data/sync';
import { dismissToast, importRosters, init, removeRepo, setGame } from '../store';
import { COST_TYPES, FORCE, type WorldOptions } from './fixture';

export interface ScreenSeed {
  /** data files by path, as XML */
  files?: Readonly<Record<string, string>>;
  rosters?: readonly Roster[];
}

const REPO = 'test/repo';

/** The XML behind `world(units, o)`, which keeps only what it parsed. */
export function worldFiles(units: string, o: Pick<WorldOptions, 'gst' | 'cat'> = {}): Record<string, string> {
  return {
    'test.gst': `<gameSystem id="gst" name="Test Game" revision="1">${COST_TYPES}${o.gst ?? FORCE}</gameSystem>`,
    'test.cat': `<catalogue id="cat" name="Test Army" revision="1" gameSystemId="gst">
      <selectionEntries>${units}</selectionEntries>${o.cat ?? ''}</catalogue>`,
  };
}

export async function renderScreen(
  screen: ComponentChild,
  { files = {}, rosters = [] }: ScreenSeed = {},
): Promise<void> {
  const picked = Object.entries(files).map(([path, xml]) => new File([xml], path));
  if (picked.length) await importLocalFiles(REPO, picked);
  for (const roster of rosters) await db.putRoster(roster);
  // offline, or init downloads the default repos whenever no data is seeded
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await init();
  online.mockRestore();
  render(screen);
}

export async function resetStore(): Promise<void> {
  dismissToast();
  setGame(undefined);
  for (const { repo } of await db.repos()) await removeRepo(repo);
  for (const { uid } of await db.rosters()) await db.delRoster(uid);
  // importing nothing reloads memory from storage, dropping a list whose save failed
  await importRosters([]);
}

afterEach(async () => {
  cleanup();
  await resetStore();
});
