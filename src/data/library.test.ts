import 'fake-indexeddb/auto';
import { DOMParser as XmlParser } from '@xmldom/xmldom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, type FileMeta, type RepoState } from './db';
import type { Roster } from './engine';
import { activeSystems, clearCaches, contextsFor, gameKey, getContext, rosterGameKey, systemsOf } from './library';
import { readHeader } from './parse';
import { COST_TYPES } from '../test/fixture';

/** The browser's DOMParser, as far as library.ts needs it: bad XML comes back as a parsererror document. */
class Parser {
  parseFromString(text: string, type: string) {
    const doc = new XmlParser().parseFromString(text, type as 'text/xml');
    return Object.assign(doc, { querySelector: () => (text.includes('BROKEN') ? {} : null) });
  }
}

const gst = (id = 'g') => `<gameSystem id="${id}" name="Game ${id}" revision="1">${COST_TYPES}</gameSystem>`;
const cat = (id: string, inner = '', attrs = '') => `<catalogue id="${id}" name="Army ${id}" revision="1" gameSystemId="g" ${attrs}>${inner}</catalogue>`;
const meta = (path: string, xml: string): FileMeta => ({ path, sha: '1', size: xml.length, header: readHeader(xml) });

async function repoOf(repo: string, files: Record<string, string>): Promise<RepoState> {
  for (const [p, x] of Object.entries(files)) await db.putFile(repo, p, x);
  return { repo, files: Object.entries(files).map(([p, x]) => meta(p, x)) };
}
const roster = (repo: string, ...cats: string[]) =>
  ({ repo, gameSystemId: 'g', forces: cats.map((c) => ({ catalogueId: c })) }) as unknown as Roster;

beforeEach(() => vi.stubGlobal('DOMParser', Parser));

describe('systemsOf', () => {
  const repo: RepoState = { repo: 'r', files: [
    meta('g.gst', gst()), meta('z.cat', cat('z')), meta('a.cat', cat('a')), meta('l.cat', cat('l', '', 'library="true"')),
    meta('other.cat', cat('x').replace('gameSystemId="g"', 'gameSystemId="other"')), { path: 'bad.cat', sha: '1', size: 0, header: null },
  ] };
  it('groups catalogues under their game, sorted, with libraries apart', () => {
    const [s] = systemsOf([repo]);
    expect(s.gst.path).toBe('g.gst');
    expect(s.catalogues.map((c) => c.path)).toEqual(['a.cat', 'z.cat']);
    expect(s.libraries.map((c) => c.path)).toEqual(['l.cat']);
  });
  it('handles several games and repos', () => {
    const two = { repo: 'r2', files: [meta('a.gst', gst('a')), meta('b.gst', gst('b'))] };
    expect(systemsOf([repo, two]).map(gameKey)).toEqual(['r|g', 'r2|a', 'r2|b']);
  });
  it('makes the same key for a roster as for its game', () => {
    expect(rosterGameKey(roster('r'))).toBe(gameKey(systemsOf([repo])[0]));
  });
});

describe('activeSystems', () => {
  const repo: RepoState = { repo: 'r', files: [meta('a.gst', gst('a')), meta('b.gst', gst('b'))] };
  it('shows just the chosen game', () => {
    const { systems, active } = activeSystems([repo], 'r|b');
    expect(systems).toHaveLength(1);
    expect(active && gameKey(active)).toBe('r|b');
  });
  it('shows everything when nothing is chosen, or the choice is gone', () => {
    expect(activeSystems([repo]).systems).toHaveLength(2);
    expect(activeSystems([repo], 'r|gone').active).toBeUndefined();
  });
  it('picks the only game there is', () => {
    const one = { repo: 'r', files: [meta('a.gst', gst('a'))] };
    expect(activeSystems([one]).active).toBeDefined();
  });
});

describe('getContext', () => {
  it('builds a context with everything linked, following links between libraries', async () => {
    const link = (t: string) => `<catalogueLinks><catalogueLink targetId="${t}"/></catalogueLinks>`;
    const repo = await repoOf('ctx/1', {
      'g.gst': gst(), 'a.cat': cat('a', link('l1')), 'l1.cat': cat('l1', link('l2') + link('a')), 'l2.cat': cat('l2', link('l1') + link('gone')),
    });
    const ctx = await getContext(repo, 'a');
    expect(ctx.files.map((f) => f.id)).toEqual(['a', 'l1', 'l2', 'g']);
  });
  it('is cached until cleared', async () => {
    const repo = await repoOf('ctx/2', { 'g.gst': gst(), 'a.cat': cat('a') });
    const first = await getContext(repo, 'a');
    expect(await getContext(repo, 'a')).toBe(first);
    clearCaches('ctx/2');
    expect(await getContext(repo, 'a')).not.toBe(first);
  });
  it('clearing one repo leaves others cached', async () => {
    const [r3, r4] = [await repoOf('ctx/3', { 'g.gst': gst(), 'a.cat': cat('a') }), await repoOf('ctx/4', { 'g.gst': gst(), 'a.cat': cat('a') })];
    const keep = await getContext(r4, 'a');
    await getContext(r3, 'a');
    clearCaches('ctx/3');
    expect(await getContext(r4, 'a')).toBe(keep);
    clearCaches();
    expect(await getContext(r4, 'a')).not.toBe(keep);
  });
  it('falls back to any game system when the link does not match', async () => {
    const repo = await repoOf('ctx/5', { 'x.gst': gst('other'), 'a.cat': cat('a') });
    expect((await getContext(repo, 'a')).gst.id).toBe('other');
  });
  it('says when the army has gone', async () => {
    const repo = await repoOf('ctx/6', { 'g.gst': gst() });
    await expect(getContext(repo, 'a')).rejects.toThrow('This army is no longer in the synced data');
  });
  it('says when there is no game system', async () => {
    const repo = await repoOf('ctx/7', { 'a.cat': cat('a') });
    await expect(getContext(repo, 'a')).rejects.toThrow('Game system file missing');
  });
  it('says when a file is missing from storage', async () => {
    const repo: RepoState = { repo: 'ctx/8', files: [meta('a.cat', cat('a'))] };
    await expect(getContext(repo, 'a')).rejects.toThrow('Missing data file a.cat. Try syncing again.');
  });
  it('says when a file cannot be read', async () => {
    const repo = await repoOf('ctx/9', { 'a.cat': cat('a', '<!-- BROKEN -->') });
    await expect(getContext(repo, 'a')).rejects.toThrow("Couldn't read a.cat");
  });
});

describe('contextsFor', () => {
  it('gives one context per catalogue in the roster', async () => {
    const repo = await repoOf('cf/1', { 'g.gst': gst(), 'a.cat': cat('a'), 'b.cat': cat('b') });
    const out = await contextsFor(roster('cf/1', 'a', 'b', 'a'), [repo]);
    expect([...out.keys()]).toEqual(['a', 'b']);
  });
  it('says when the data is not on this phone', async () => {
    await expect(contextsFor(roster('cf/2', 'a'), [])).rejects.toThrow("Data for cf/2 isn't on this phone. Sync it on the Data tab.");
  });
});
