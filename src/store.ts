// Global app state + small hooks.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, persistStorage, type RepoState } from './data/db';
import { Evaluator, isRecord, uid, type Roster } from './data/engine';
import { clearCaches, contextsFor } from './data/library';
import { DEFAULT_REPOS, syncRepo, type SyncProgress } from './data/sync';
import type { Context } from './data/catalog';

interface State {
  ready: boolean;
  repos: RepoState[];
  rosters: Roster[];
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
let state: State = { ready: false, repos: [], rosters: [], sync: {}, game: savedGame, unsaved: new Set() };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;

export function useStore<T>(sel: (s: State) => T): T {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    // catch any update that landed between render and subscribing
    l();
    return () => void listeners.delete(l);
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

/** The reason a failure gives, which can be any value. */
export function failureReason(e: unknown): string {
  return e instanceof Error || e instanceof DOMException ? e.message : String(e);
}

/** What to tell the player when something failed: "Couldn't <action>: <the reason given>". */
export function failureMessage(action: string, e: unknown): string {
  return `Couldn't ${action}: ${failureReason(e)}`;
}

export async function init() {
  const [repos, rosters] = await Promise.all([db.repos(), db.rosters()]);
  set({ ready: true, repos, rosters });
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

export async function saveRoster(r: Roster) {
  r.updated = Date.now();
  // update memory first so screens opened straight after an edit see it
  const rosters = state.rosters.filter((x) => x.uid !== r.uid);
  rosters.push(structuredClone(r));
  set({ rosters });
  await db.putRoster(r);
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

const isSel = (s: unknown): boolean =>
  isRecord(s) &&
  typeof s.uid === 'string' &&
  typeof s.key === 'string' &&
  typeof s.number === 'number' &&
  (s.categoryId === undefined || typeof s.categoryId === 'string') &&
  Array.isArray(s.children) &&
  s.children.every(isSel);

const isForce = (f: unknown) =>
  isRecord(f) &&
  typeof f.catalogueId === 'string' &&
  typeof f.forceEntryId === 'string' &&
  Array.isArray(f.selections) &&
  f.selections.every(isSel);

/** The fields Lists can't draw without, and every selection. Every release has written all of them. */
function isRoster(r: unknown): r is Roster {
  return (
    isRecord(r) &&
    typeof r.uid === 'string' &&
    r.uid !== '' &&
    typeof r.name === 'string' &&
    typeof r.repo === 'string' &&
    typeof r.gameSystemId === 'string' &&
    typeof r.costLimit === 'number' &&
    typeof r.updated === 'number' &&
    Array.isArray(r.forces) &&
    r.forces.every(isForce)
  );
}

/** A crafted list can nest too deep for the stack, in the check or in the copies `db.putRoster` and a screen make. */
function isStorable(r: unknown): r is Roster {
  try {
    if (!isRoster(r)) return false;
    structuredClone(JSON.parse(JSON.stringify(r)));
    return true;
  } catch {
    return false;
  }
}

/** Returns how many lists it restored. Anything that isn't a list is skipped. */
export async function importRosters(list: readonly unknown[]): Promise<number> {
  const lists = list.filter(isStorable);
  for (const r of lists) {
    if (state.rosters.some((x) => x.uid === r.uid)) r.uid = uid();
    await db.putRoster(r);
  }
  // storage still holds the old copy of a list whose save failed, and only memory has the edit
  const stored = (await db.rosters()).filter((r) => !state.unsaved.has(r.uid));
  set({ rosters: [...stored, ...state.rosters.filter((r) => state.unsaved.has(r.uid))] });
  return lists.length;
}

/** Retry reads memory, which holds every edit, as `r` may be stale by then or the player may have deleted it. */
function saveEdit(r: Roster) {
  const retry = () => {
    const latest = state.rosters.find((x) => x.uid === r.uid);
    if (latest) saveEdit(latest);
  };
  saveRoster(r).catch(() => {
    set({ unsaved: new Set([...state.unsaved, r.uid]) });
    toast("Couldn't save this list", { label: 'Retry', run: retry, failedSave: r.uid });
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
        fn(local);
        setVersion((v) => v + 1);
        if (!scratch) saveEdit(local);
      },
    },
  };
}
