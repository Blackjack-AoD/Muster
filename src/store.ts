// Global app state + small hooks.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, persistStorage, type RepoState, type SavedUnit } from './data/db';
import { Evaluator, isRecord, uid, type Force, type RSel, type Roster, type Sel } from './data/engine';
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
function copySavedUnit(u: SavedUnit): SavedUnit {
  const { name: _name, saved: _saved, ...build } = copySel(u.build);
  return {
    id: u.id,
    name: u.name,
    repo: u.repo,
    gameSystemId: u.gameSystemId,
    catalogueId: u.catalogueId,
    key: u.key,
    categoryId: u.categoryId,
    build,
    created: u.created,
    updated: u.updated,
  };
}

/** Points a copy at its saved unit's id on this phone, or makes it a normal unit when its saved unit isn't here. */
function relinkCopy(s: Sel, ids: ReadonlyMap<string, string>) {
  if (s.saved === undefined) return;
  const id = ids.get(s.saved);
  if (id !== undefined) s.saved = id;
  else {
    delete s.saved;
    delete s.name;
  }
}

/** Returns how many lists and saved units it restored. Anything that isn't one is skipped. */
export async function importBackup(
  list: readonly unknown[],
  units: readonly unknown[] = [],
): Promise<{ lists: number; savedUnits: number }> {
  const savedUnits = units.filter(isSavedUnit);
  // a backup's saved-unit id, to its id on this phone
  const ids = new Map(state.savedUnits.map((u) => [u.id, u.id]));
  for (const u of savedUnits) {
    const copy = copySavedUnit(u);
    if (state.savedUnits.some((x) => x.id === copy.id)) copy.id = uid();
    ids.set(u.id, copy.id);
    await db.putSavedUnit(copy);
  }
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

/** Same options and model names, whatever the uids. */
const sameChildren = (a: readonly Sel[], b: readonly Sel[]): boolean =>
  a.length === b.length &&
  a.every((s, i) => {
    const t = b[i];
    return t !== undefined && sameSel(s, t);
  });

const sameSel = (a: Sel, b: Sel): boolean =>
  a.key === b.key && a.number === b.number && a.name === b.name && sameChildren(a.children, b.children);

/** Copies of a list's linked units, taken apart from the list, as the next edit changes it in place. */
const linkedCopies = (r: Roster): Sel[] =>
  r.forces.flatMap((f) => f.selections.filter((s) => s.saved !== undefined)).map((s) => structuredClone(s));

/**
 * Applies `edit` to a list and saves it, then copies each linked unit the edit changed to its saved unit
 * and to the other lists. A copy the edit added, or left alone, changes nothing else.
 */
export function saveListEdit(r: Roster, edit: (r: Roster) => void): Promise<void> {
  const before = linkedCopies(r);
  edit(r);
  saveEdit(r);
  const changed = linkedCopies(r).filter((copy) => {
    const was = before.find((s) => s.uid === copy.uid);
    return was !== undefined && !sameSel(was, copy);
  });
  return followCopies(r.uid, changed);
}

async function followCopies(listUid: string, copies: readonly Sel[]) {
  for (const copy of copies) {
    const saved = state.savedUnits.find((u) => u.id === copy.saved);
    if (saved) await followCopy(listUid, saved, copy);
  }
}

async function followCopy(listUid: string, saved: SavedUnit, copy: Sel) {
  const name = copy.name ?? saved.name;
  const { name: _name, saved: _saved, ...build } = copy;
  const followed = { ...saved, name, build, updated: Date.now() };
  try {
    await db.putSavedUnit(followed);
  } catch (e) {
    toast(failureMessage('update the saved unit', e));
    return;
  }
  set({ savedUnits: state.savedUnits.map((u) => (u.id === saved.id ? followed : u)) });
  changeCopies(
    saved.id,
    (other) => {
      other.key = build.key;
      other.number = build.number;
      other.children = structuredClone(build.children);
      other.name = name;
    },
    listUid,
  );
}

/** Storage first, as a saved unit that storage refuses has no Retry, so the unit stays unlinked. */
export async function saveUnit(r: Roster, rs: RSel, name: string): Promise<void> {
  const force = r.forces.find((f) => f.uid === rs.force.force.uid);
  const sel = force?.selections.find((s) => s.uid === rs.sel.uid);
  if (!force || !sel) throw new Error('Only a unit of this list can be saved.');
  const now = Date.now();
  const { name: _name, saved: _saved, ...build } = structuredClone(sel);
  const saved: SavedUnit = {
    id: uid(),
    name,
    repo: r.repo,
    gameSystemId: r.gameSystemId,
    catalogueId: force.catalogueId,
    key: sel.key,
    // as the Add unit sheet groups a unit with no category
    categoryId: rs.eff.primary ?? '',
    build,
    created: now,
    updated: now,
  };
  await db.putSavedUnit(saved);
  set({ savedUnits: [...state.savedUnits, saved] });
  sel.saved = saved.id;
  sel.name = name;
  saveEdit(r);
}

/** Changes every copy of saved unit `id` in every list but `skip`, and saves each list that holds one as an edit. */
function changeCopies(id: string, change: (copy: Sel) => void, skip?: string) {
  const holds = (r: Roster) => r.uid !== skip && r.forces.some((f) => f.selections.some((s) => s.saved === id));
  for (const held of state.rosters.filter(holds)) {
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
  changeCopies(id, (copy) => {
    delete copy.saved;
    delete copy.name;
  });
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
        else void saveListEdit(local, fn);
        setVersion((v) => v + 1);
      },
    },
  };
}
