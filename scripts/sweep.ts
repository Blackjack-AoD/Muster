// Finds cases worth a unit test. It never fails a build, and it isn't a substitute for the tests.
//   1. Adds each unit of each army to a list set up as the app does, and groups what goes wrong by smallest example.
//   2. Lists the shapes of condition, repeat, constraint and modifier in the data that no unit test mentions.
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Context, type Opt } from '../src/data/catalog';
import {
  Evaluator,
  addSel,
  forceRootOptions,
  uid,
  unavailable,
  type Issue,
  type Roster,
  type Sel,
} from '../src/data/engine';
import type { DataFile, EntryNode } from '../src/data/model';
import { parseDataFile, readHeader } from '../src/data/parse';
import { setUpForce } from '../src/data/setup';
import { costIds, shapesOf } from './shapes';

const [dir, only] = process.argv.slice(2);
if (!dir) {
  console.log('usage: mise run sweep <data-dir> ["<army name filter>"]');
  process.exit(1);
}

const walk = (d: string, match: RegExp): string[] =>
  readdirSync(d).flatMap((f) => {
    if (f.startsWith('.') || f === 'node_modules') return [];
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p, match) : match.test(f) ? [p] : [];
  });

const texts = new Map(walk(dir, /\.(gst|cat)$/i).map((f) => [f, readFileSync(f, 'utf8')]));
interface Source {
  xml: string;
  h: NonNullable<ReturnType<typeof readHeader>>;
}
const meta = new Map<string, Source>();
for (const xml of texts.values()) {
  const h = readHeader(xml);
  if (h) meta.set(h.id, { xml, h });
}

const parsed = new Map<string, DataFile>();
const load = (source: Source) => {
  const hit = parsed.get(source.h.id);
  if (hit) return hit;
  const file = parseDataFile(
    new DOMParser().parseFromString(source.xml, 'text/xml').documentElement as unknown as Element,
  );
  parsed.set(source.h.id, file);
  return file;
};
const linkedTo = (cat: DataFile) => {
  const linked: DataFile[] = [];
  const queue = [cat];
  for (let c = queue.pop(); c; c = queue.pop()) {
    for (const l of c.catalogueLinks) {
      const source = meta.get(l.targetId);
      if (!source || linked.some((x) => x.id === l.targetId)) continue;
      const f = load(source);
      linked.push(f);
      queue.push(f);
    }
  }
  return linked;
};

// ---------- 1. what goes wrong ----------
interface Problem {
  count: number;
  size: number;
  example: string;
}
const problems = new Map<string, Problem>();
const nodes = (s: Sel[]): number => s.reduce((t, x) => t + 1 + nodes(x.children), 0);
const note = (kind: string, size: number, example: string, count = 1) => {
  const p = problems.get(kind) ?? { count: 0, size: Infinity, example };
  p.count += count;
  if (size < p.size) {
    p.size = size;
    p.example = example;
  }
  problems.set(kind, p);
};
const kindOf = (i: Issue) => i.message.replace(/[\d.]+/g, 'N').replace(/^.*›/, '›');
const issueKey = (i: Issue) => `${i.selUid}|${i.level}|${i.message}`;
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Army {
  name: string;
  catalogueId: string;
  ctx: Context;
  contexts: Map<string, Context>;
}

let units = 0;

/** A new list of this force entry with its set-up in place, as the app starts one, and what its set-up raises. */
function setUpList(army: Army, fe: EntryNode, list: string, noteOnce: typeof note) {
  const roster: Roster = {
    uid: uid(),
    name: 't',
    repo: 'x',
    gameSystemId: army.ctx.gst.id,
    costLimit: 2000,
    forces: [{ uid: uid(), forceEntryId: fe.id, catalogueId: army.catalogueId, selections: [] }],
    created: 0,
    updated: 0,
  };
  const fromSetUp = new Set<string>();
  try {
    setUpForce(roster, army.contexts, roster.forces[0].uid, army.name);
    const size = nodes(roster.forces[0].selections);
    for (const i of new Evaluator(roster, army.contexts).issues) {
      if (!i.selUid || i.level !== 'error') continue;
      fromSetUp.add(issueKey(i));
      noteOnce(`SET-UP ${kindOf(i)}`, size, list);
    }
  } catch (e) {
    // the app also carries on with whatever set-up it managed
    noteOnce(`SET-UP CRASH ${reason(e)}`, 0, list);
  }
  return { roster, fromSetUp };
}

/** Adds one root entry to a copy of the set-up list and notes what goes wrong that the set-up didn't raise. */
function tryUnit(army: Army, setUp: Roster, fromSetUp: Set<string>, o: Opt, where: string) {
  const roster = structuredClone(setUp);
  try {
    const before = new Evaluator(roster, army.contexts);
    const eff = before.optionEff(o, null, before.forces[0]);
    if (eff.hidden || unavailable(eff)) return;
    // a second copy of a set-up entry only reports that entry's own cap
    if (before.forces[0].roots.some((r) => r.node.id === o.node.id)) return;
    const primary = o.node.categoryLinks.find((c) => c.primary)?.targetId;
    const su = addSel(roster, army.contexts, roster.forces[0].uid, null, o, 1, primary);
    if (su === null) throw new Error('the unit was not added');
    const ev = new Evaluator(roster, army.contexts);
    units++;
    const size = nodes(roster.forces[0].selections);
    for (const i of ev.issues)
      if ((i.selUid === su || (i.selUid && i.level === 'error')) && !fromSetUp.has(issueKey(i)))
        note(kindOf(i), size, where);
  } catch (e) {
    note(`CRASH ${reason(e)}`, 0, where);
  }
}

for (const m of meta.values()) {
  if (m.h.kind !== 'catalogue' || m.h.library || (only && !m.h.name.includes(only))) continue;
  const cat = load(m);
  const gst = meta.get(cat.gameSystemId ?? '');
  if (!gst) continue;
  const ctx = new Context(load(gst), cat, linkedTo(cat));
  const army: Army = { name: m.h.name, catalogueId: cat.id, ctx, contexts: new Map([[cat.id, ctx]]) };
  // A problem the set-up raises on its own belongs to the army, not to each unit added after it.
  const armyWide = new Set<string>();
  const noteOnce = (kind: string, size: number, example: string) => {
    note(kind, size, example, armyWide.has(kind) ? 0 : 1);
    armyWide.add(kind);
  };
  for (const fe of ctx.forceEntries()) {
    if (fe.hidden) continue; // the app doesn't offer it
    const list = `${m.h.name} / ${fe.name}`;
    const { roster, fromSetUp } = setUpList(army, fe, list, noteOnce);
    for (const o of forceRootOptions(ctx, fe)) tryUnit(army, roster, fromSetUp, o, `${list} / ${o.node.name}`);
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
for (const [s, u] of [...untested].sort((a, b) => b[1].count - a[1].count).slice(0, 40))
  console.log(`${String(u.count).padStart(6)}  ${s}  (${u.file.replace(dir, '').replace(/^\//, '')})`);
