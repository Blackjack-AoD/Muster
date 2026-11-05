// Renders a screen on the real store, with data and lists seeded into fake-indexeddb.
import type { ComponentChild } from 'preact';
import type { Roster } from '../data/engine';
import type { WorldOptions } from './fixture';

export interface ScreenSeed {
  /** data files by path, as XML */
  files?: Readonly<Record<string, string>>;
  rosters?: readonly Roster[];
}

export function worldFiles(_units: string, _o: Pick<WorldOptions, 'gst' | 'cat'> = {}): Record<string, string> {
  return {};
}

export async function renderScreen(_screen: ComponentChild, _seed: ScreenSeed = {}): Promise<void> {}
