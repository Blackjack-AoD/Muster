import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db } from './db';
import type { SystemInfo } from './library';
import { compendium, extractRules, xmlText } from './rules';

describe('xmlText', () => {
  it('decodes named and numeric entities', () => {
    expect(xmlText('  it&#8217;s &#x2014; a &lt;b&gt; &amp; c ')).toBe('it’s — a <b> & c');
  });
  it('does not decode twice', () => {
    expect(xmlText('&amp;#65;')).toBe('&#65;');
  });
});

describe('extractRules', () => {
  it('finds rules, with their text', () => {
    expect(extractRules('<rules><rule id="1" name="Fearless"><description>Never &amp; ever</description></rule></rules>')).toEqual([{ name: 'Fearless', description: 'Never & ever' }]);
  });
  it('keeps hidden rules', () => {
    expect(extractRules('<rule name="A" hidden="true"><description>x</description></rule>')).toHaveLength(1);
  });
  it('handles a rule with no text', () => {
    expect(extractRules('<rule name="A"/><rule name="B"><description/></rule><rule name="C"><description>c</description></rule>'))
      .toEqual([{ name: 'A', description: '' }, { name: 'B', description: '' }, { name: 'C', description: 'c' }]);
  });
  it('unwraps CDATA', () => {
    expect(extractRules('<rule name="A"><description><![CDATA[Text]]></description></rule>')[0].description).toBe('Text');
  });
  it('skips a rule with no name', () => {
    expect(extractRules('<rule id="1"><description>x</description></rule>')).toEqual([]);
  });
  it('does not mistake the wrapper for a rule', () => {
    expect(extractRules('<rules name="not a rule"></rules>')).toEqual([]);
  });
  it('decodes the rule name', () => {
    expect(extractRules('<rule name="Fire &amp; Fury"/>')[0].name).toBe('Fire & Fury');
  });
});

describe('compendium', () => {
  const file = (path: string, name: string, sha = 'x') => ({ path, sha, size: 0, header: { kind: 'catalogue', id: path, name, revision: 1, library: false } });
  const put = async (repo: string, files: Record<string, string>) => {
    for (const [path, xml] of Object.entries(files)) await db.putFile(repo, path, xml);
  };
  const rule = (name: string, text: string) => `<rule name="${name}"><description>${text}</description></rule>`;
  const sys = (repo: string, ...paths: [string, string][]) => {
    const [gst, ...cats] = paths.map(([p, n]) => file(p, n));
    return { repo, gst, catalogues: cats, libraries: [] } as unknown as SystemInfo;
  };

  it('merges copies of a rule, keeping different wordings apart', async () => {
    await put('c/1', { g: rule('Fear', 'One'), a: rule('fear', 'one ') + rule('Zeal', 'Z'), b: rule('Fear', 'Two') });
    const list = await compendium('c/1', sys('c/1', ['g', 'Game'], ['a', '2022 - Orks'], ['b', 'Elves']));
    expect(list.map((r) => r.name)).toEqual(['Fear', 'Zeal']);
    expect(list[0].versions).toEqual([
      { description: 'One', sources: ['Game', 'Orks'] },
      { description: 'Two', sources: ['Elves'] },
    ]);
    expect(list[0].hay).toBe('fear\none\ntwo');
  });
  it('puts the most used wording first and drops empty ones', async () => {
    await put('c/2', { g: rule('A', ''), a: rule('A', 'Rare'), b: rule('A', 'Common'), c: rule('A', 'Common') });
    const list = await compendium('c/2', sys('c/2', ['g', 'G'], ['a', 'A'], ['b', 'B'], ['c', 'C']));
    expect(list[0].versions.map((v) => v.description)).toEqual(['Common', 'Rare']);
  });
  it('keeps a rule that only has empty wording', async () => {
    await put('c/3', { g: rule('A', '') });
    expect((await compendium('c/3', sys('c/3', ['g', 'G'])))[0].versions).toEqual([{ description: '', sources: ['G'] }]);
  });
  it('skips files that are not stored', async () => {
    expect(await compendium('c/4', sys('c/4', ['gone', 'G']))).toEqual([]);
  });
  it('is cached until a file changes', async () => {
    await put('c/5', { g: rule('A', 'x') });
    const s = sys('c/5', ['g', 'G']);
    const first = await compendium('c/5', s);
    await put('c/5', { g: rule('B', 'y') });
    expect(await compendium('c/5', s)).toBe(first);
    s.gst.sha = 'changed';
    expect((await compendium('c/5', s))[0].name).toBe('B');
  });
});
