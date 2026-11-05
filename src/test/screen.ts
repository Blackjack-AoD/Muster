// Renders a screen on the real store, with data and lists seeded into fake-indexeddb.
import 'fake-indexeddb/auto';
import { render } from '@testing-library/preact';
import type { ComponentChild } from 'preact';
import { db } from '../data/db';
import type { Roster } from '../data/engine';
import { importLocalFiles } from '../data/sync';
import { init } from '../store';
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
  await init();
  render(screen);
}
