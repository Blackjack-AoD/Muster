// Rules compendium: every rule in every data file of one game system, searchable.
// Uses a text scan rather than a full parse, so even big systems index in about a second on a phone.
import { db } from './db';
import type { SystemInfo } from './library';
import { decodeXml } from './parse';

export interface RuleVersion {
  description: string;
  /** names of the files (game system / armies / libraries) that use this wording */
  sources: string[];
}
export interface CompRule {
  name: string;
  /** one per distinct wording; most files usually share the first */
  versions: RuleVersion[];
  /** lower-cased name + all wordings, for searching */
  hay: string;
}

const cache = new Map<string, CompRule[]>();

const RULE = /<rule\b([^>]*?)(?:\/>|>([\s\S]*?)<\/rule>)/g;
const attr = (attrs: string, n: string) => attrs.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1];

/** XML text → plain text, including numeric entities (&#8217; etc.) */
export function xmlText(s: string) {
  return decodeXml(
    s
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))),
  ).trim();
}

/** Pull rules out of one data file's XML. Hidden rules are kept: they're often switched on by choices in a list. */
export function extractRules(xml: string): { name: string; description: string }[] {
  const out: { name: string; description: string }[] = [];
  for (const m of xml.matchAll(RULE)) {
    const name = xmlText(attr(m[1], 'name') ?? '');
    if (!name) continue;
    const d = m[2]?.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '';
    out.push({ name, description: xmlText(d.replace(/^<!\[CDATA\[|\]\]>$/g, '')) });
  }
  return out;
}

const tidy = (name: string) => name.replace(/^\d{4}\s*-\s*/, '');

export async function compendium(repo: string, sys: SystemInfo): Promise<CompRule[]> {
  const files = [sys.gst, ...sys.libraries, ...sys.catalogues];
  const key = `${repo}|${sys.gst.header.id}|${files.map((f) => f.sha).join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const byName = new Map<string, { name: string; versions: Map<string, RuleVersion> }>();
  for (const f of files) {
    const xml = await db.getFile(repo, f.path);
    if (!xml) continue;
    const source = tidy(f.header.name);
    for (const r of extractRules(xml)) {
      // the same rule is often copied into many files: one entry per name, one version per wording
      const nk = r.name.toLowerCase();
      let e = byName.get(nk);
      if (!e) byName.set(nk, (e = { name: r.name, versions: new Map() }));
      const dk = r.description.replace(/\s+/g, ' ').toLowerCase();
      const v = e.versions.get(dk);
      if (v) {
        if (!v.sources.includes(source)) v.sources.push(source);
      } else e.versions.set(dk, { description: r.description, sources: [source] });
    }
  }
  const list: CompRule[] = [...byName.values()]
    .map(({ name, versions }) => {
      // drop empty wordings when real text exists; most widely used wording first
      let vs = [...versions.values()];
      if (vs.some((v) => v.description)) vs = vs.filter((v) => v.description);
      vs.sort((a, b) => b.sources.length - a.sources.length);
      return { name, versions: vs, hay: (name + '\n' + vs.map((v) => v.description).join('\n')).toLowerCase() };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  cache.set(key, list);
  return list;
}
