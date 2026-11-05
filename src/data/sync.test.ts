import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { DATA_FILE, importLocalFiles, normaliseRepo, syncRepo } from './sync';
import { present } from '../test/fixture';
import { makeZip } from '../test/zipfile';

const xml = (id: string, name = id) =>
  `<catalogue id="${id}" name="${name}" revision="1" gameSystemId="g"></catalogue>`;

interface Remote {
  tree: { path: string; sha: string; type?: string; size?: number }[];
  bodies: Record<string, string | Uint8Array>;
}

/** A stand-in for GitHub. `fail` maps a URL part to a response status. */
function github(remote: Remote, fail: Record<string, number> = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    for (const [part, status] of Object.entries(fail)) if (url.includes(part)) return new Response('', { status });
    const u = new URL(url);
    if (u.hostname === 'raw.githubusercontent.com') {
      const path = u.pathname.split('/').slice(4).map(decodeURIComponent).join('/');
      return new Response(remote.bodies[path] as BodyInit);
    }
    if (u.pathname.endsWith('/branches/main')) return Response.json({ commit: { sha: 'c1' } });
    if (u.pathname.includes('/git/trees/'))
      return Response.json({ tree: remote.tree.map((t) => ({ type: 'blob', size: 0, ...t })) });
    return Response.json({ default_branch: 'main' });
  });
  vi.stubGlobal('fetch', f);
  return calls;
}

let n = 0;
const repoName = () => `test/repo${n++}`;
const noop = () => {};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('navigator', { onLine: true });
});

describe('normaliseRepo', () => {
  it.each([
    ['owner/repo', 'owner/repo'],
    ['  owner/repo  ', 'owner/repo'],
    ['https://github.com/owner/repo', 'owner/repo'],
    ['https://github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/owner/repo/', 'owner/repo'],
    ['github.com/owner/repo', 'owner/repo'],
    ['https://GitHub.com/owner/repo', 'owner/repo'],
    ['git@github.com:owner/repo.git', 'owner/repo'],
    ['ssh://git@github.com/owner/repo.git', 'owner/repo'],
    ['https://github.com/owner/my repo', null],
    ['just-a-word', null],
    ['', null],
  ])('%s', (input, expected) => {
    expect(normaliseRepo(input)).toBe(expected);
  });

  it('copes with a link to a branch page', () => {
    expect(normaliseRepo('https://github.com/owner/repo/tree/main')).toBe('owner/repo');
  });

  it('reads a page link whatever the case of the host', () => {
    expect(normaliseRepo('https://GitHub.com/owner/repo/tree/main')).toBe('owner/repo');
  });

  it.each([
    'https://github.com/owner/repo/tree/feature/x',
    'https://github.com/owner/repo/blob/main/x.cat',
    'https://github.com/owner/repo/tree/main/sub/dir',
    'github.com/owner/repo/tree/main',
    'https://github.com/owner/repo?tab=readme-ov-file',
    'https://github.com/owner/repo#readme',
    'https://github.com/owner/repo/blob/main/x.cat?raw=1',
  ])('drops everything after owner/repo in %s', (input) => {
    expect(normaliseRepo(input)).toBe('owner/repo');
  });

  it('keeps dots and hyphens in the name when a link goes inside the repo', () => {
    expect(normaliseRepo('https://github.com/my-org/wh40k-10e.data/tree/main')).toBe('my-org/wh40k-10e.data');
  });

  it('drops .git before a trailing slash', () => {
    expect(normaliseRepo('https://github.com/owner/repo.git/')).toBe('owner/repo');
  });

  it('rejects a link to an owner page', () => {
    expect(normaliseRepo('https://github.com/owner')).toBeNull();
  });
});

describe('DATA_FILE', () => {
  it('matches data files, zipped or not, in any case', () => {
    expect(['a.cat', 'b.GST', 'c.catz', 'd.gstz', 'e.xml', 'f.cat.bak'].map((f) => DATA_FILE.test(f))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('syncRepo', () => {
  it('downloads data files, in subfolders too, and nothing else', async () => {
    const repo = repoName();
    github({
      tree: [
        { path: 'a.cat', sha: '1' },
        { path: 'sub dir/b.cat', sha: '2' },
        { path: 'README.md', sha: '3' },
        { path: 'folder.cat', sha: '4', type: 'tree' },
      ],
      bodies: { 'a.cat': xml('a'), 'sub dir/b.cat': xml('b') },
    });
    const state = await syncRepo(repo, noop);
    expect(state.files.map((f) => f.path)).toEqual(['a.cat', 'sub dir/b.cat']);
    expect(state).toMatchObject({ repo, branch: 'main', commit: 'c1' });
    expect(state.files[0].header?.id).toBe('a');
    expect(await db.getFile(repo, 'sub dir/b.cat')).toBe(xml('b'));
    expect((await db.repos()).find((r) => r.repo === repo)?.commit).toBe('c1');
  });

  it('unpacks zipped data files', async () => {
    const repo = repoName();
    github({
      tree: [{ path: 'a.catz', sha: '1' }],
      bodies: { 'a.catz': await makeZip([{ name: 'a.cat', text: xml('a') }]) },
    });
    await syncRepo(repo, noop);
    expect(await db.getFile(repo, 'a.catz')).toBe(xml('a'));
  });

  it('only downloads what changed', async () => {
    const repo = repoName();
    github({
      tree: [
        { path: 'a.cat', sha: '1' },
        { path: 'b.cat', sha: '1' },
      ],
      bodies: { 'a.cat': xml('a'), 'b.cat': xml('b') },
    });
    await syncRepo(repo, noop);
    const calls = github({
      tree: [
        { path: 'a.cat', sha: '1' },
        { path: 'b.cat', sha: '2' },
      ],
      bodies: { 'b.cat': xml('b', 'New name') },
    });
    const state = await syncRepo(repo, noop);
    expect(calls.filter((c) => c.includes('raw.githubusercontent'))).toHaveLength(1);
    expect(state.files.map((f) => f.header?.name)).toEqual(['a', 'New name']);
  });

  it('removes files that went away upstream', async () => {
    const repo = repoName();
    github({
      tree: [
        { path: 'a.cat', sha: '1' },
        { path: 'b.cat', sha: '1' },
      ],
      bodies: { 'a.cat': xml('a'), 'b.cat': xml('b') },
    });
    await syncRepo(repo, noop);
    github({ tree: [{ path: 'a.cat', sha: '1' }], bodies: {} });
    const state = await syncRepo(repo, noop);
    expect(state.files.map((f) => f.path)).toEqual(['a.cat']);
    expect(await db.getFile(repo, 'b.cat')).toBeUndefined();
  });

  it('reports its progress', async () => {
    const stages: string[] = [];
    github({ tree: [{ path: 'a.cat', sha: '1' }], bodies: { 'a.cat': xml('a') } });
    await syncRepo(repoName(), (p) => stages.push(`${p.stage} ${p.done}/${p.total}`));
    expect(stages).toEqual(['checking 0/0', 'downloading 0/1', 'downloading 1/1', 'done 1/1']);
  });

  it('says when there was nothing to do', async () => {
    const repo = repoName();
    github({ tree: [], bodies: {} });
    const seen: (string | undefined)[] = [];
    await syncRepo(repo, (p) => seen.push(p.message));
    expect(seen.at(-1)).toBe('Already up to date');
  });

  it('tries a download three times', async () => {
    const repo = repoName();
    let tries = 0;
    github({ tree: [{ path: 'a.cat', sha: '1' }], bodies: {} });
    const api = vi.mocked(fetch);
    const real = present(api.getMockImplementation(), 'the fetch stub');
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('raw.githubusercontent') && ++tries < 3) throw new Error('flaky');
      if (url.includes('raw.githubusercontent')) return new Response(xml('a'));
      return real(url);
    });
    const state = await syncRepo(repo, noop);
    expect(tries).toBe(3);
    expect(state.error).toBeUndefined();
  });

  it.each([
    [403, 'GitHub rate limit reached, try again in an hour'],
    [429, 'GitHub rate limit reached, try again in an hour'],
    [404, 'Repo not found (is it public?)'],
    [500, 'GitHub error 500'],
  ])('explains a %i from GitHub', async (status, message) => {
    github({ tree: [], bodies: {} }, { 'api.github.com': status });
    expect((await syncRepo(repoName(), noop)).error).toBe(message);
  });

  it('keeps what it had when a sync fails, and records the error', async () => {
    const repo = repoName();
    github({ tree: [{ path: 'a.cat', sha: '1' }], bodies: { 'a.cat': xml('a') } });
    await syncRepo(repo, noop);
    github({ tree: [{ path: 'a.cat', sha: '2' }], bodies: {} }, { 'raw.githubusercontent': 500 });
    const stages: string[] = [];
    const state = await syncRepo(repo, (p) => stages.push(p.stage));
    expect(state.error).toBe('Failed to download a.cat: HTTP 500');
    expect(state.files.map((f) => f.sha)).toEqual(['1']);
    expect(await db.getFile(repo, 'a.cat')).toBe(xml('a'));
    expect(stages.at(-1)).toBe('error');
  });

  it('clears an old error after a good sync', async () => {
    const repo = repoName();
    github({ tree: [], bodies: {} }, { 'api.github.com': 500 });
    await syncRepo(repo, noop);
    github({ tree: [], bodies: {} });
    expect((await syncRepo(repo, noop)).error).toBeUndefined();
  });

  it('tells the user when they are offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const seen: (string | undefined)[] = [];
    await syncRepo(repoName(), (p) => seen.push(p.message));
    expect(seen.at(-1)).toBe('You are offline');
  });
});

describe('importLocalFiles', () => {
  const file = (name: string, body: BlobPart, lastModified = 5) => new File([body], name, { lastModified });

  it('imports plain and zipped data files, ignoring the rest', async () => {
    const repo = repoName();
    const added = await importLocalFiles(repo, [
      file('a.cat', xml('a')),
      file('b.catz', (await makeZip([{ name: 'b.cat', text: xml('b') }])) as BlobPart),
      file('notes.txt', 'x'),
    ]);
    expect(added).toBe(2);
    const state = present(
      (await db.repos()).find((r) => r.repo === repo),
      'the stored repo',
    );
    expect(state.files.map((f) => [f.path, f.sha, f.header?.id])).toEqual([
      ['a.cat', 'local-5', 'a'],
      ['b.catz', 'local-5', 'b'],
    ]);
    expect(await db.getFile(repo, 'b.catz')).toBe(xml('b'));
  });

  it("unpacks a whole repo zip, dropping GitHub's top folder", async () => {
    const repo = repoName();
    await importLocalFiles(repo, [
      file(
        'dl.zip',
        (await makeZip([
          { name: 'data-main/', method: 0 },
          { name: 'data-main/a.cat', text: xml('a') },
          { name: 'data-main/sub/b.cat', text: xml('b') },
          { name: 'data-main/README.md', text: 'x' },
        ])) as BlobPart,
      ),
    ]);
    const stored = present(
      (await db.repos()).find((r) => r.repo === repo),
      'the stored repo',
    );
    expect(stored.files.map((f) => f.path)).toEqual(['a.cat', 'sub/b.cat']);
  });

  it('keeps folders when the zip has more than one at the top', async () => {
    const repo = repoName();
    await importLocalFiles(repo, [
      file(
        'dl.zip',
        (await makeZip([
          { name: 'a/x.cat', text: xml('x') },
          { name: 'b/y.cat', text: xml('y') },
        ])) as BlobPart,
      ),
    ]);
    const stored = present(
      (await db.repos()).find((r) => r.repo === repo),
      'the stored repo',
    );
    expect(stored.files.map((f) => f.path)).toEqual(['a/x.cat', 'b/y.cat']);
  });

  it('keeps paths when files sit at the top of the zip', async () => {
    const repo = repoName();
    await importLocalFiles(repo, [file('dl.zip', (await makeZip([{ name: 'x.cat', text: xml('x') }])) as BlobPart)]);
    const stored = present(
      (await db.repos()).find((r) => r.repo === repo),
      'the stored repo',
    );
    expect(stored.files.map((f) => f.path)).toEqual(['x.cat']);
  });

  it('replaces a file of the same name and keeps the others', async () => {
    const repo = repoName();
    await importLocalFiles(repo, [file('a.cat', xml('a')), file('b.cat', xml('b'))]);
    await importLocalFiles(repo, [file('a.cat', xml('a', 'New'))]);
    const files = present(
      (await db.repos()).find((r) => r.repo === repo),
      'the stored repo',
    ).files;
    expect(files.map((f) => f.header?.name)).toEqual(['New', 'b']);
  });
});
