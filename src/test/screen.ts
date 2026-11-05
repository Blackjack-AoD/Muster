// Renders a screen on the real store, with data and lists seeded into fake-indexeddb.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { h, type ComponentChild } from 'preact';
import { afterEach, expect, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import type { Roster } from '../data/engine';
import { importLocalFiles } from '../data/sync';
import { deleteRoster, dismissToast, getState, importRosters, init, removeRepo, setGame } from '../store';
import { encodeSnapshot, viewUrl, type Snapshot } from '../ui/snapshot';
import { FORCE, catalogueXml, gameSystemXml, type WorldOptions } from './fixture';

export interface ScreenSeed {
  /** data files by path, as XML */
  files?: Readonly<Record<string, string>>;
  rosters?: readonly Roster[];
}

const REPO = 'test/repo';

/** The XML behind `world(units, o)`, which keeps only what it parsed. */
export function worldFiles(units: string, o: Pick<WorldOptions, 'gst' | 'cat'> = {}): Record<string, string> {
  return {
    'test.gst': gameSystemXml(o.gst ?? FORCE),
    'test.cat': catalogueXml(`<selectionEntries>${units}</selectionEntries>${o.cat ?? ''}`),
  };
}

export const openHash = (hash: string) => history.replaceState(null, '', hash);

/** The address part of a share link to `snap`. */
export const linkHash = async (snap: Snapshot) => new URL(viewUrl((await encodeSnapshot(snap)).data)).hash;

/** Storage refuses every write of this kind until restored, as a full phone would. */
export const refuse = (method: 'put' | 'delete') =>
  vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });

/** Storage fails every read of a data file with a bare reason, which is no `Error`, until restored. */
export const failReads = (reason: string) =>
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
    throw reason;
  });

export const expectToast = (text: string) => waitFor(() => expect(getState().toast).toBe(text));

export const press = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }));

type Point = readonly [x: number, y: number];

/** A finger going down at the origin, through each point, then lifting. */
export function drag(row: HTMLElement, path: readonly Point[]): void {
  const pointer = { pointerId: 1, pointerType: 'touch' };
  row.setPointerCapture = vi.fn(); // jsdom has none
  fireEvent.pointerDown(row, { ...pointer, clientX: 0, clientY: 0 });
  for (const [clientX, clientY] of path) fireEvent.pointerMove(row, { ...pointer, clientX, clientY });
  fireEvent.pointerUp(row, pointer);
}

/** Fills in what jsdom lacks and the app calls, and clears the history steps the app counted in the last test. */
export async function stubBrowserGaps(): Promise<void> {
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  // share links pack through Blob.stream(), which jsdom's Blob lacks; Response still makes Node's
  vi.stubGlobal('Blob', (await new Response().blob()).constructor);
  // the app's count outlives the store reset, and each step it counts is one entry at most
  for (let i = 0; i < history.length; i++) dispatchEvent(new PopStateEvent('popstate'));
}

export async function renderScreen(
  screen: ComponentChild,
  { files = {}, rosters = [] }: ScreenSeed = {},
): Promise<void> {
  const picked = Object.entries(files).map(([path, xml]) => new File([xml], path));
  if (picked.length) await importLocalFiles(REPO, picked);
  for (const roster of rosters) await db.putRoster(roster);
  // offline, or init downloads the default repos whenever the seed holds no data
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  await init();
  online.mockRestore();
  render(screen);
}

/** Opens Lists on `files`, as far as the sheet that names the new list. */
export async function openCreateList(files: ScreenSeed['files']): Promise<void> {
  openHash('#/');
  await renderScreen(h(App, null), { files });
  await press('New list');
  await press('Test Army');
  await screen.findByRole('button', { name: 'Create list' });
}

export async function resetStore(): Promise<void> {
  dismissToast();
  setGame(undefined);
  // a repo that storage refused has a sync status and no record
  const stored = (await db.repos()).map((r) => r.repo);
  for (const repo of new Set([...stored, ...Object.keys(getState().sync)])) await removeRepo(repo);
  for (const uid of getState().unsaved) await deleteRoster(uid);
  for (const { uid } of await db.rosters()) await db.delRoster(uid);
  // importing nothing reloads memory from storage, dropping a list whose save failed
  await importRosters([]);
}

afterEach(async () => {
  cleanup();
  await resetStore();
});
