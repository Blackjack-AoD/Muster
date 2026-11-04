// Download .gst/.cat files from a GitHub repo onto the phone, only fetching what changed.
import { db, type FileMeta, type RepoState } from './db';
import { readHeader } from './parse';
import { dataFileText, readZip } from './zip';

export const DEFAULT_REPOS = ['Blackjack-AoD/NRData', 'Blackjack-AoD/M40GA'];

export function normaliseRepo(input: string): string | null {
  const s = input
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  const m = s.match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export interface SyncProgress {
  repo: string;
  stage: 'checking' | 'downloading' | 'done' | 'error';
  done: number;
  total: number;
  message?: string;
}

async function gh(path: string) {
  const r = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 403 || r.status === 429) throw new Error('GitHub rate limit reached, try again in an hour');
  if (r.status === 404) throw new Error('Repo not found (is it public?)');
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);
  return r.json();
}

/** .gst/.cat, or their zipped forms .gstz/.catz, anywhere in the repo */
export const DATA_FILE = /\.(gst|cat)z?$/i;

export async function syncRepo(repo: string, onProgress: (p: SyncProgress) => void): Promise<RepoState> {
  const existing = (await db.repos()).find((r) => r.repo === repo) ?? { repo, files: [] };
  onProgress({ repo, stage: 'checking', done: 0, total: 0 });
  try {
    const info = await gh(`/repos/${repo}`);
    const branch: string = info.default_branch;
    const br = await gh(`/repos/${repo}/branches/${encodeURIComponent(branch)}`);
    const commit: string = br.commit.sha;
    // recursive: data files in subfolders count too
    const tree = await gh(`/repos/${repo}/git/trees/${commit}?recursive=1`);
    const remote: { path: string; sha: string; size: number }[] = tree.tree
      .filter((t: { type: string; path: string }) => t.type === 'blob' && DATA_FILE.test(t.path))
      .map((t: { path: string; sha: string; size: number }) => ({ path: t.path, sha: t.sha, size: t.size }));

    const have = new Map(existing.files.map((f) => [f.path, f]));
    const todo = remote.filter((f) => have.get(f.path)?.sha !== f.sha);
    const files: FileMeta[] = remote.filter((f) => !todo.includes(f)).map((f) => have.get(f.path)!);
    let done = 0;
    onProgress({ repo, stage: 'downloading', done, total: todo.length });

    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift()!;
        const url = `https://raw.githubusercontent.com/${repo}/${commit}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
        let text = '';
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            text = await dataFileText(f.path, await r.arrayBuffer());
            break;
          } catch (e) {
            if (attempt === 2) throw new Error(`Failed to download ${f.path}: ${(e as Error).message}`);
          }
        }
        await db.putFile(repo, f.path, text);
        files.push({ path: f.path, sha: f.sha, size: text.length, header: readHeader(text) });
        done++;
        onProgress({ repo, stage: 'downloading', done, total: todo.length });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    // drop files removed upstream
    const keep = new Set(remote.map((f) => f.path));
    for (const f of existing.files) if (!keep.has(f.path)) await db.delFile(repo, f.path);

    files.sort((a, b) => a.path.localeCompare(b.path));
    const state: RepoState = { repo, branch, commit, syncedAt: Date.now(), files };
    await db.putRepo(state);
    onProgress({
      repo,
      stage: 'done',
      done,
      total: todo.length,
      message: todo.length ? `${todo.length} file(s) updated` : 'Already up to date',
    });
    return state;
  } catch (e) {
    const msg = (e as Error).message || 'Sync failed';
    const state = { ...existing, error: msg };
    await db.putRepo(state);
    onProgress({ repo, stage: 'error', done: 0, total: 0, message: navigator.onLine ? msg : 'You are offline' });
    return state;
  }
}

/**
 * Import data picked from the phone (no internet needed): .gst/.cat/.gstz/.catz files,
 * or a .zip of a whole repo (e.g. GitHub's "Download ZIP"). Returns how many data files were added.
 */
export async function importLocalFiles(repo: string, picked: File[]): Promise<number> {
  const existing = (await db.repos()).find((r) => r.repo === repo) ?? { repo, files: [] as FileMeta[] };
  const incoming: { path: string; text: string; stamp: string }[] = [];
  for (const p of picked) {
    if (DATA_FILE.test(p.name)) {
      incoming.push({
        path: p.name,
        text: await dataFileText(p.name, await p.arrayBuffer()),
        stamp: 'local-' + p.lastModified,
      });
    } else if (/\.zip$/i.test(p.name)) {
      const entries = readZip(await p.arrayBuffer()).filter((e) => DATA_FILE.test(e.name));
      // GitHub zips wrap everything in "<repo>-<branch>/": drop a single shared top folder
      const tops = new Set(entries.map((e) => e.name.split('/')[0]));
      const strip = tops.size === 1 && entries.every((e) => e.name.includes('/'));
      for (const e of entries) {
        const path = strip ? e.name.slice(e.name.indexOf('/') + 1) : e.name;
        incoming.push({ path, text: await dataFileText(e.name, await e.read()), stamp: 'local-' + p.lastModified });
      }
    }
  }
  const files = existing.files.filter((f) => !incoming.some((p) => p.path === f.path));
  for (const f of incoming) {
    await db.putFile(repo, f.path, f.text);
    files.push({ path: f.path, sha: f.stamp, size: f.text.length, header: readHeader(f.text) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  await db.putRepo({ ...existing, repo, files, syncedAt: Date.now() });
  return incoming.length;
}
