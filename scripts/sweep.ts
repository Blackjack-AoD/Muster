// Sweep every catalogue in a data dir: add each root unit with defaults, report crashes and unit-level errors.
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDataFile, readHeader } from '../src/data/parse';
import { Context } from '../src/data/catalog';
import { Evaluator, addSel, forceRootOptions, uid, unavailable, type Roster } from '../src/data/engine';

const dir = process.argv[2];
const only = process.argv[3];
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); if (f.startsWith('.')) return []; return statSync(p).isDirectory() ? walk(p) : /\.(gst|cat)$/i.test(f) ? [p] : []; });
const files = walk(dir);
const meta = new Map<string, { path: string; h: any }>();
for (const f of files) { const h = readHeader(readFileSync(f, 'utf8')); if (h) meta.set(h.id, { path: f, h }); }
const parsed = new Map<string, any>();
const load = (id: string) => { if (!parsed.has(id)) { const doc = new DOMParser().parseFromString(readFileSync(meta.get(id)!.path, 'utf8'), 'text/xml'); parsed.set(id, parseDataFile(doc.documentElement as any)); } return parsed.get(id); };
const summary: Record<string, number> = {};
const bump = (k: string) => (summary[k] = (summary[k] ?? 0) + 1);
for (const [id, m] of meta) {
  if (m.h.kind !== 'catalogue' || m.h.library) continue;
  if (only && !m.h.name.includes(only)) continue;
  const cat = load(id);
  const gst = load(cat.gameSystemId);
  const linked: any[] = []; const q = [cat];
  while (q.length) { const c = q.pop(); for (const l of c.catalogueLinks) if (meta.has(l.targetId) && !linked.find((x) => x.id === l.targetId)) { const lf = load(l.targetId); linked.push(lf); q.push(lf); } }
  for (const l of cat.catalogueLinks) if (!meta.has(l.targetId)) console.log(`[${m.h.name}] missing linked catalogue ${l.name}`);
  const ctx = new Context(gst, cat, linked);
  const contexts = new Map([[cat.id, ctx]]);
  const fes = ctx.forceEntries();
  let units = 0, bad = 0;
  for (const fe of fes) {
    const opts = forceRootOptions(ctx, fe);
    for (const o of opts) {
      const roster: Roster = { uid: uid(), name: 't', repo: 'x', gameSystemId: gst.id, costLimit: 0, forces: [{ uid: uid(), forceEntryId: fe.id, catalogueId: cat.id, selections: [] }], created: 0, updated: 0 };
      try {
        const ev0 = new Evaluator(roster, contexts);
        const e0 = ev0.optionEff(o, null, ev0.forces[0]);
        if (e0.hidden || unavailable(e0)) continue;
        const prim = o.node.categoryLinks.find((c) => c.primary)?.targetId;
        const t0 = Date.now();
        const su = addSel(roster, contexts, roster.forces[0].uid, null, o, 1, prim);
        const ev = new Evaluator(roster, contexts);
        const dt = Date.now() - t0;
        units++;
        const rs = ev.find(su)!;
        const errs = ev.issues.filter((i) => i.selUid && i.level === 'error');
        const msgs: string[] = errs.map((e) => e.message);
        if (rs.total <= 0 && !/rite|allegiance|warlord|detachment|formation|legion|trait|faction|psychic|relic|config|lord of war|^\d|game type|unit|option/i.test(o.node.name)) msgs.push(`zero points`);
        if (dt > 1500) msgs.push(`slow add ${dt}ms`);
        if (msgs.length) { bad++; for (const x of msgs) { bump(x.replace(/[\d.]+/g, 'N').replace(/^.*›/, '›')); } if (process.env.V) console.log(`[${m.h.name}] ${fe.name} / ${o.node.name}: ${msgs.join(' | ')}`); }
      } catch (e) {
        bad++; bump('CRASH ' + (e as Error).message);
        console.log(`[${m.h.name}] ${fe.name} / ${o.node.name}: CRASH ${(e as Error).stack?.split('\n').slice(0, 3).join(' ')}`);
      }
    }
  }
  console.log(`${m.h.name}: forces ${fes.length}, units added ${units}, with problems ${bad}`);
}
console.log('\nTop problem kinds:');
Object.entries(summary).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(String(v).padStart(5), k));
