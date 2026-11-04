// Finds cases worth a unit test. Exploration only: it never fails a build, and it isn't a substitute for the tests.
//   1. Adds every unit of every army and groups what goes wrong, with the smallest unit showing each kind of problem.
//   2. Lists the shapes of condition, repeat, constraint and modifier in the data that no unit test mentions.
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Context } from '../src/data/catalog';
import { Evaluator, addSel, forceRootOptions, uid, unavailable, type Roster, type Sel } from '../src/data/engine';
import type { DataFile } from '../src/data/model';
import { parseDataFile, readHeader } from '../src/data/parse';
import { costIds, shapesOf } from './shapes';

const [dir, only] = process.argv.slice(2);
if (!dir) { console.log('usage: mise run sweep <data-dir> ["<army name filter>"]'); process.exit(1); }

const walk = (d: string, match: RegExp): string[] => readdirSync(d).flatMap((f) => {
  if (f.startsWith('.') || f === 'node_modules') return [];
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p, match) : match.test(f) ? [p] : [];
});

const texts = new Map(walk(dir, /\.(gst|cat)$/i).map((f) => [f, readFileSync(f, 'utf8')]));
const meta = new Map<string, { path: string; h: NonNullable<ReturnType<typeof readHeader>> }>();
for (const [path, xml] of texts) { const h = readHeader(xml); if (h) meta.set(h.id, { path, h }); }

const parsed = new Map<string, DataFile>();
const load = (id: string) => {
  if (!parsed.has(id)) parsed.set(id, parseDataFile(new DOMParser().parseFromString(texts.get(meta.get(id)!.path)!, 'text/xml').documentElement as unknown as Element));
  return parsed.get(id)!;
};
const linkedTo = (cat: DataFile) => {
  const linked: DataFile[] = [];
  const queue = [cat];
  while (queue.length) {
    for (const l of queue.pop()!.catalogueLinks) {
      if (!meta.has(l.targetId) || linked.some((x) => x.id === l.targetId)) continue;
      const f = load(l.targetId);
      linked.push(f);
      queue.push(f);
    }
  }
  return linked;
};

// ---------- 1. what goes wrong ----------
interface Problem { count: number; size: number; example: string }
const problems = new Map<string, Problem>();
const nodes = (s: Sel[]): number => s.reduce((t, x) => t + 1 + nodes(x.children), 0);
const note = (kind: string, size: number, example: string) => {
  const p = problems.get(kind) ?? { count: 0, size: Infinity, example };
  p.count++;
  if (size < p.size) { p.size = size; p.example = example; }
  problems.set(kind, p);
};

let units = 0;
for (const [id, m] of meta) {
  if (m.h.kind !== 'catalogue' || m.h.library || (only && !m.h.name.includes(only))) continue;
  const cat = load(id);
  if (!cat.gameSystemId || !meta.has(cat.gameSystemId)) continue;
  const ctx = new Context(load(cat.gameSystemId), cat, linkedTo(cat));
  const contexts = new Map([[cat.id, ctx]]);
  for (const fe of ctx.forceEntries()) {
    for (const o of forceRootOptions(ctx, fe)) {
      const roster: Roster = { uid: uid(), name: 't', repo: 'x', gameSystemId: ctx.gst.id, costLimit: 0, forces: [{ uid: uid(), forceEntryId: fe.id, catalogueId: cat.id, selections: [] }], created: 0, updated: 0 };
      const where = `${m.h.name} / ${fe.name} / ${o.node.name}`;
      try {
        const empty = new Evaluator(roster, contexts);
        const eff = empty.optionEff(o, null, empty.forces[0]);
        if (eff.hidden || unavailable(eff)) continue;
        const su = addSel(roster, contexts, roster.forces[0].uid, null, o, 1, o.node.categoryLinks.find((c) => c.primary)?.targetId);
        const ev = new Evaluator(roster, contexts);
        units++;
        const size = nodes(roster.forces[0].selections);
        for (const i of ev.issues) if (i.selUid === su || (i.selUid && i.level === 'error')) note(i.message.replace(/[\d.]+/g, 'N').replace(/^.*›/, '›'), size, where);
      } catch (e) {
        note(`CRASH ${(e as Error).message}`, 0, where);
      }
    }
  }
}

console.log(`Added ${units} units.\n\nWhat went wrong, with the smallest example of each:`);
const worst = [...problems].sort((a, b) => b[1].count - a[1].count).slice(0, 30);
for (const [kind, p] of worst) console.log(`${String(p.count).padStart(6)}  ${kind}\n        e.g. ${p.example}`);
if (!worst.length) console.log('  nothing');

// ---------- 2. what no unit test mentions ----------
const costs = new Set([...texts.values()].flatMap(costIds));
const tested = new Set(walk('src', /\.test\.tsx?$/).flatMap((f) => shapesOf(readFileSync(f, 'utf8'), costs)));
const untested = new Map<string, { count: number; file: string }>();
for (const [path, xml] of texts) {
  for (const s of shapesOf(xml, costs)) {
    if (tested.has(s)) continue;
    const u = untested.get(s) ?? { count: 0, file: path };
    u.count++;
    untested.set(s, u);
  }
}
const seen = new Set([...texts.values()].flatMap((x) => shapesOf(x, costs)));
console.log(`\nShapes in this data with no unit test: ${untested.size} of ${seen.size}, commonest first:`);
for (const [s, u] of [...untested].sort((a, b) => b[1].count - a[1].count).slice(0, 40)) console.log(`${String(u.count).padStart(6)}  ${s}  (${u.file.replace(dir, '').replace(/^\//, '')})`);
