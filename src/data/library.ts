// Loads and caches parsed data files from on-phone storage, and builds Contexts.
import { Context } from './catalog';
import { db, type FileMeta, type RepoState } from './db';
import type { Roster } from './engine';
import type { DataFile } from './model';
import { parseDataFile } from './parse';

export interface SystemInfo {
  repo: string;
  gst: FileMeta;
  catalogues: FileMeta[]; // playable (non-library)
  libraries: FileMeta[];
}

const parsed = new Map<string, DataFile>();
const contexts = new Map<string, Context>();

export function clearCaches(repo?: string) {
  for (const k of [...parsed.keys()]) if (!repo || k.startsWith(repo + '|')) parsed.delete(k);
  for (const k of [...contexts.keys()]) if (!repo || k.startsWith(repo + '|')) contexts.delete(k);
}

export function systemsOf(repos: RepoState[]): SystemInfo[] {
  const out: SystemInfo[] = [];
  for (const r of repos) {
    for (const g of r.files.filter((f) => f.header?.kind === 'gameSystem')) {
      const cats = r.files.filter((f) => f.header?.kind === 'catalogue' && f.header.gameSystemId === g.header!.id);
      out.push({
        repo: r.repo,
        gst: g,
        catalogues: cats.filter((c) => !c.header!.library).sort((a, b) => a.header!.name.localeCompare(b.header!.name)),
        libraries: cats.filter((c) => c.header!.library),
      });
    }
  }
  return out;
}

async function loadFile(repo: string, meta: FileMeta): Promise<DataFile> {
  const key = `${repo}|${meta.header!.id}`;
  const hit = parsed.get(key);
  if (hit) return hit;
  const text = await db.getFile(repo, meta.path);
  if (!text) throw new Error(`Missing data file ${meta.path}. Try syncing again.`);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`Couldn't read ${meta.path}`);
  const f = parseDataFile(doc.documentElement);
  parsed.set(key, f);
  return f;
}

/** Context for a catalogue id within a repo (gst + catalogue + everything linked). */
export async function getContext(repo: RepoState, catalogueId: string): Promise<Context> {
  const key = `${repo.repo}|${catalogueId}`;
  const hit = contexts.get(key);
  if (hit) return hit;
  const byId = new Map(repo.files.filter((f) => f.header).map((f) => [f.header!.id, f]));
  const catMeta = byId.get(catalogueId);
  if (!catMeta) throw new Error('This army is no longer in the synced data');
  const cat = await loadFile(repo.repo, catMeta);
  const gstMeta = byId.get(cat.gameSystemId ?? '') ?? repo.files.find((f) => f.header?.kind === 'gameSystem');
  if (!gstMeta) throw new Error('Game system file missing');
  const gst = await loadFile(repo.repo, gstMeta);
  const linked: DataFile[] = [];
  const queue = [cat];
  while (queue.length) {
    const c = queue.pop()!;
    for (const l of c.catalogueLinks) {
      const m = byId.get(l.targetId);
      if (!m || linked.some((x) => x.id === l.targetId) || l.targetId === cat.id) continue;
      const lf = await loadFile(repo.repo, m);
      linked.push(lf);
      queue.push(lf);
    }
  }
  const ctx = new Context(gst, cat, linked);
  contexts.set(key, ctx);
  return ctx;
}

export async function contextsFor(roster: Roster, repos: RepoState[]): Promise<Map<string, Context>> {
  const repo = repos.find((r) => r.repo === roster.repo);
  if (!repo) throw new Error(`Data for ${roster.repo} isn't on this phone. Sync it on the Data tab.`);
  const out = new Map<string, Context>();
  for (const f of roster.forces) if (!out.has(f.catalogueId)) out.set(f.catalogueId, await getContext(repo, f.catalogueId));
  return out;
}
