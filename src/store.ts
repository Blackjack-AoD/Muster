// Global app state + small hooks.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, persistStorage, type RepoState, type SavedUnit } from './data/db';
import {
  Evaluator,
  applySaved,
  holdsSaved,
  isRecord,
  isUnique,
  locate,
  uid,
  unlinkCopy,
  type Force,
  type RSel,
  type Roster,
  type Sel,
} from './data/engine';
import { clearCaches, contextsFor } from './data/library';
import { DEFAULT_REPOS, failureReason, syncRepo, type SyncProgress } from './data/sync';
import type { Context } from './data/catalog';

interface State {
  ready: boolean;
  repos: RepoState[];
  rosters: Roster[];
  savedUnits: SavedUnit[];
  sync: Record<string, SyncProgress>;
  toast?: string;
  /** optional button on the toast, e.g. Undo; failedSave holds the uid of a list that hasn't saved */
  toastAction?: { label: string; run: () => void; failedSave?: string };
  /** active game: "<repo>|<game system id>", or undefined for all games */
  game?: string;
  /** uids of lists whose latest edit is in memory and not in storage */
  unsaved: ReadonlySet<string>;
}

const GAME_KEY = 'muster.game';
const savedGame = (() => {
  try {
    return localStorage.getItem(GAME_KEY) || undefined;
  } catch {
    return undefined;
  }
})();
let state: State = {
  ready: false,
  repos: [],
  rosters: [],
  savedUnits: [],
  sync: {},
  game: savedGame,
  unsaved: new Set(),
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;

/** Calls `listener` after every change to state, until the function it returns is called. */
export function watchState(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useStore<T>(sel: (s: State) => T): T {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    const stop = watchState(l);
    // catch any update that landed between render and subscribing
    l();
    return stop;
  }, []);
  return sel(state);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, action?: State['toastAction']) {
  set({ toast: msg, toastAction: action });
  clearTimeout(toastTimer);
  if (action?.failedSave) return;
  toastTimer = setTimeout(() => set({ toast: undefined, toastAction: undefined }), action ? 5000 : 2600);
}
export function dismissToast() {
  clearTimeout(toastTimer);
  set({ toast: undefined, toastAction: undefined });
}

/** What to tell the player when something failed: "Couldn't <action>: <the reason given>". */
export function failureMessage(action: string, e: unknown): string {
  return `Couldn't ${action}: ${failureReason(e)}`;
}

export async function init() {
  const [repos, rosters, savedUnits] = await Promise.all([db.repos(), db.rosters(), db.savedUnits()]);
  set({ ready: true, repos, rosters, savedUnits });
  persistStorage().catch(() => {
    /* nothing depends on it: the browser just keeps its right to clear storage */
  });
  if (!repos.length && navigator.onLine) await syncAll(DEFAULT_REPOS);
}

/** Pick the game that Lists and Library show (undefined = all games). */
export function setGame(game: string | undefined) {
  try {
    if (game) localStorage.setItem(GAME_KEY, game);
    else localStorage.removeItem(GAME_KEY);
  } catch {
    /* storage unavailable: keep it for this session only */
  }
  set({ game });
}

/** A failed download shows on the repo's card and in a toast, and the next repo still syncs. A failed save stops. */
export async function syncAll(list?: string[]) {
  const targets = list ?? state.repos.map((r) => r.repo);
  const show = (p: SyncProgress) => set({ sync: { ...state.sync, [p.repo]: p } });
  const showAndWarn = (p: SyncProgress) => {
    show(p);
    if (p.stage === 'error') toast(failureMessage('sync', p.message));
  };
  for (const repo of targets) {
    try {
      await syncRepo(repo, showAndWarn);
      clearCaches(repo);
      set({ repos: await db.repos() });
    } catch (e) {
      const message = failureMessage('sync', e);
      show({ repo, stage: 'error', done: 0, total: 0, message });
      toast(message);
      return;
    }
  }
}

export async function removeRepo(repo: string) {
  await db.delRepo(repo);
  clearCaches(repo);
  const sync = { ...state.sync };
  delete sync[repo];
  set({ repos: await db.repos(), sync });
}

export async function refreshRepos() {
  set({ repos: await db.repos() });
}

function forgetUnsaved(u: string) {
  set({ unsaved: new Set([...state.unsaved].filter((x) => x !== u)) });
}

/** Saves started for each list. Two can share a millisecond, so `updated` can't order them. */
const savesStarted = new Map<string, number>();

export async function saveRoster(r: Roster) {
  const started = (savesStarted.get(r.uid) ?? 0) + 1;
  savesStarted.set(r.uid, started);
  r.updated = Date.now();
  // update memory first so screens opened straight after an edit see it
  const rosters = state.rosters.filter((x) => x.uid !== r.uid);
  rosters.push(structuredClone(r));
  set({ rosters });
  await db.putRoster(r);
  if (savesStarted.get(r.uid) !== started) return;
  forgetUnsaved(r.uid);
  if (state.toastAction?.failedSave === r.uid) dismissToast();
}

/** Storage first, unlike `saveRoster`: a list that storage refuses has no Retry, so it can't wait in memory. */
export async function addRoster(r: Roster) {
  const saved = { ...structuredClone(r), updated: Date.now() };
  await db.putRoster(saved);
  set({ rosters: [...state.rosters, saved] });
}

export async function deleteRoster(u: string) {
  await db.delRoster(u);
  set({ rosters: state.rosters.filter((x) => x.uid !== u) });
  forgetUnsaved(u);
}

/** Far deeper than any real unit, and shallow enough that copying a list's selections can't overflow the stack. */
const MAX_SEL_LEVELS = 32;

/** What `uid()` writes. A list's address holds its uid, and a `/` there leaves the list out of reach. */
const LIST_UID = /^[a-z0-9]+$/;

const isSel = (s: unknown, level: number): boolean =>
  level <= MAX_SEL_LEVELS &&
  isRecord(s) &&
  typeof s.uid === 'string' &&
  typeof s.key === 'string' &&
  typeof s.number === 'number' &&
  (s.categoryId === undefined || typeof s.categoryId === 'string') &&
  (s.name === undefined || typeof s.name === 'string') &&
  (s.saved === undefined || typeof s.saved === 'string') &&
  Array.isArray(s.children) &&
  s.children.every((c) => isSel(c, level + 1));

const isForce = (f: unknown) =>
  isRecord(f) &&
  typeof f.uid === 'string' &&
  typeof f.catalogueId === 'string' &&
  typeof f.forceEntryId === 'string' &&
  Array.isArray(f.selections) &&
  f.selections.every((s) => isSel(s, 1));

/** Every field of the type, as a copy keeps whatever a known field holds. Every release has written all of them. */
function isRoster(r: unknown): r is Roster {
  return (
    isRecord(r) &&
    typeof r.uid === 'string' &&
    LIST_UID.test(r.uid) &&
    typeof r.name === 'string' &&
    typeof r.repo === 'string' &&
    typeof r.gameSystemId === 'string' &&
    typeof r.costLimit === 'number' &&
    typeof r.created === 'number' &&
    typeof r.updated === 'number' &&
    Array.isArray(r.forces) &&
    r.forces.every(isForce)
  );
}

function copySel(s: Sel): Sel {
  const copy: Sel = { uid: s.uid, key: s.key, number: s.number, children: s.children.map(copySel) };
  if (s.categoryId !== undefined) copy.categoryId = s.categoryId;
  if (s.name !== undefined) copy.name = s.name;
  if (s.saved !== undefined) copy.saved = s.saved;
  return copy;
}

const copyForce = (f: Force): Force => ({
  uid: f.uid,
  forceEntryId: f.forceEntryId,
  catalogueId: f.catalogueId,
  selections: f.selections.map(copySel),
});

/** A backup can carry anything in a field no release wrote, so only the fields of the type get stored. */
const copyRoster = (r: Roster): Roster => ({
  uid: r.uid,
  name: r.name,
  repo: r.repo,
  gameSystemId: r.gameSystemId,
  costLimit: r.costLimit,
  forces: r.forces.map(copyForce),
  created: r.created,
  updated: r.updated,
});

function isSavedUnit(u: unknown): u is SavedUnit {
  return (
    isRecord(u) &&
    typeof u.id === 'string' &&
    typeof u.name === 'string' &&
    (u.kind === undefined || u.kind === 'preconfigured') &&
    typeof u.repo === 'string' &&
    typeof u.gameSystemId === 'string' &&
    typeof u.catalogueId === 'string' &&
    typeof u.key === 'string' &&
    typeof u.categoryId === 'string' &&
    isSel(u.build, 1) &&
    typeof u.created === 'number' &&
    typeof u.updated === 'number'
  );
}

/** A saved unit's build never holds a name or a link of its own: the copies in lists do. */
function buildOf({ name: _name, saved: _saved, ...build }: Sel): Sel {
  return build;
}

function copySavedUnit(u: SavedUnit): SavedUnit {
  return {
    id: u.id,
    name: u.name,
    ...(u.kind === undefined ? {} : { kind: u.kind }),
    repo: u.repo,
    gameSystemId: u.gameSystemId,
    catalogueId: u.catalogueId,
    key: u.key,
    categoryId: u.categoryId,
    build: buildOf(copySel(u.build)),
    created: u.created,
    updated: u.updated,
  };
}

/** Points a copy at its saved unit's id on this phone, or makes it a normal unit when its saved unit isn't here. */
function relinkCopy(s: Sel, ids: ReadonlyMap<string, string>) {
  if (s.saved === undefined) return;
  const id = ids.get(s.saved);
  if (id !== undefined) s.saved = id;
  else unlinkCopy(s);
}

/**
 * Stores a backup's saved units, each under a new id when its own is taken. Returns a map from the
 * saved-unit id a restored copy holds to that saved unit's id on this phone.
 */
async function restoreSavedUnits(units: readonly SavedUnit[]): Promise<ReadonlyMap<string, string>> {
  const ids = new Map(state.savedUnits.map((u) => [u.id, u.id]));
  for (const u of units) {
    const copy = copySavedUnit(u);
    if (state.savedUnits.some((x) => x.id === copy.id)) copy.id = uid();
    ids.set(u.id, copy.id);
    await db.putSavedUnit(copy);
  }
  return ids;
}

/** Returns how many lists and saved units it restored. It skips anything that isn't a list or a saved unit. */
export async function importBackup(
  list: readonly unknown[],
  units: readonly unknown[] = [],
): Promise<{ lists: number; savedUnits: number }> {
  const savedUnits = units.filter(isSavedUnit);
  const ids = await restoreSavedUnits(savedUnits);
  const lists = list.filter(isRoster);
  for (const r of lists) {
    const copy = copyRoster(r);
    if (state.rosters.some((x) => x.uid === copy.uid)) copy.uid = uid();
    for (const f of copy.forces) for (const s of f.selections) relinkCopy(s, ids);
    await db.putRoster(copy);
  }
  // storage still holds the old copy of a list whose save failed, and only memory has the edit
  const stored = (await db.rosters()).filter((r) => !state.unsaved.has(r.uid));
  set({
    rosters: [...stored, ...state.rosters.filter((r) => state.unsaved.has(r.uid))],
    savedUnits: await db.savedUnits(),
  });
  return { lists: lists.length, savedUnits: savedUnits.length };
}

/** Retry reads memory, which holds every edit, as `r` may be stale by then or the player may have deleted it. */
function saveEdit(r: Roster) {
  const retry = () => {
    const latest = state.rosters.find((x) => x.uid === r.uid);
    if (latest) saveEdit(latest);
  };
  const saving = saveRoster(r);
  // saveRoster counts itself before it first waits, and a newer save reports on the list instead of this one
  const started = savesStarted.get(r.uid);
  saving.catch(() => {
    if (savesStarted.get(r.uid) !== started) return;
    // a deleted list has nothing left to save
    if (!state.rosters.some((x) => x.uid === r.uid)) return;
    set({ unsaved: new Set([...state.unsaved, r.uid]) });
    toast("Couldn't save this list", { label: 'Retry', run: retry, failedSave: r.uid });
  });
}

/** Applies `edit` to a list and saves it. Copies of saved units change only in this list, until Save updates. */
export function saveListEdit(r: Roster, edit: (r: Roster) => void): void {
  edit(r);
  saveEdit(r);
}

/**
 * Save updates: takes a linked copy's build, and a unique unit's name, to its saved unit, then to every copy in
 * every other list, over any changes of their own. The caller updates other copies in this list.
 */
export async function saveUpdates(r: Roster, selUid: string): Promise<SavedUnit> {
  const copy = locate(r, selUid)?.sel;
  const saved = state.savedUnits.find((u) => u.id === copy?.saved);
  if (!copy || !saved) throw new Error("This saved unit isn't on this phone.");
  const updated: SavedUnit = {
    ...saved,
    name: isUnique(saved) ? (copy.name ?? saved.name) : '',
    build: buildOf(structuredClone(copy)),
    updated: Date.now(),
  };
  await db.putSavedUnit(updated);
  set({ savedUnits: state.savedUnits.map((u) => (u.id === saved.id ? updated : u)) });
  changeCopies(saved.id, (other) => applySaved(other, updated), r.uid);
  return updated;
}

/**
 * Stores the saved unit and returns it. The unit page links the unit only after this,
 * so a refused write, which has no Retry, leaves the unit unlinked.
 */
export async function saveUnit(r: Roster, rs: RSel, name: string | undefined): Promise<SavedUnit> {
  const loc = locate(r, rs.sel.uid);
  if (!loc || loc.list !== loc.force.selections) throw new Error('Only a unit of this list can be saved.');
  const { force, sel } = loc;
  const now = Date.now();
  const saved: SavedUnit = {
    id: uid(),
    name: name ?? '',
    ...(name ? {} : { kind: 'preconfigured' as const }),
    repo: r.repo,
    gameSystemId: r.gameSystemId,
    catalogueId: force.catalogueId,
    key: sel.key,
    // '' for a unit with no primary category, as the Add unit sheet groups it
    categoryId: rs.eff.primary ?? '',
    build: buildOf(structuredClone(sel)),
    created: now,
    updated: now,
  };
  await db.putSavedUnit(saved);
  set({ savedUnits: [...state.savedUnits, saved] });
  return saved;
}

/** Changes every copy of saved unit `id` in every list but `skip`, and saves each list that holds one as an edit. */
function changeCopies(id: string, change: (copy: Sel) => void, skip?: string) {
  for (const held of state.rosters.filter((r) => r.uid !== skip && holdsSaved(r, id))) {
    const r = structuredClone(held);
    for (const f of r.forces) for (const s of f.selections) if (s.saved === id) change(s);
    saveEdit(r);
  }
}

export async function renameSavedUnit(id: string, name: string): Promise<void> {
  const saved = state.savedUnits.find((u) => u.id === id);
  if (!saved) throw new Error("This saved unit isn't on this phone.");
  const renamed = { ...saved, name, updated: Date.now() };
  await db.putSavedUnit(renamed);
  set({ savedUnits: state.savedUnits.map((u) => (u.id === id ? renamed : u)) });
  changeCopies(id, (copy) => {
    copy.name = name;
  });
}

/** Its copies become normal units: each list keeps the build and loses the link and the name. */
export async function deleteSavedUnit(id: string): Promise<void> {
  await db.delSavedUnit(id);
  set({ savedUnits: state.savedUnits.filter((u) => u.id !== id) });
  changeCopies(id, unlinkCopy);
}

// ---------- roster controller ----------
export interface RosterCtl {
  roster: Roster;
  contexts: Map<string, Context>;
  ev: Evaluator;
  mutate: (fn: (r: Roster) => void) => void;
  scratch: boolean;
}

/** Load contexts for a roster and keep an evaluator in sync with edits. */
export function useRosterCtl(
  source: Roster | undefined,
  scratch = false,
): { ctl?: RosterCtl; error?: string; loading: boolean } {
  const repos = useStore((s) => s.repos);
  const [contexts, setContexts] = useState<Map<string, Context>>();
  const [error, setError] = useState<string>();
  const [local, setLocal] = useState<Roster | undefined>(source && structuredClone(source));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setLocal(source && structuredClone(source));
  }, [source?.uid]);

  const catKey = local ? local.repo + local.forces.map((f) => f.catalogueId).join(',') : '';
  useEffect(() => {
    if (!local) return;
    let live = true;
    setError(undefined);
    // let the spinner paint before parsing big files
    setTimeout(() => {
      contextsFor(local, repos)
        .then((c) => live && setContexts(c))
        .catch((e: unknown) => live && setError(failureReason(e)));
    }, 30);
    return () => void (live = false);
  }, [catKey, repos]);

  const ev = useMemo(() => {
    if (!local || !contexts) return undefined;
    if (!local.forces.every((f) => contexts.has(f.catalogueId))) return undefined;
    return new Evaluator(local, contexts);
  }, [local, contexts, version]);

  if (!local) return { loading: false, error: 'List not found' };
  if (error) return { loading: false, error };
  if (!ev || !contexts) return { loading: true };
  return {
    loading: false,
    ctl: {
      roster: local,
      contexts,
      ev,
      scratch,
      mutate: (fn) => {
        if (scratch) fn(local);
        else saveListEdit(local, fn);
        setVersion((v) => v + 1);
      },
    },
  };
}
