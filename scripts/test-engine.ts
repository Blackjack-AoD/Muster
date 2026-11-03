import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync } from 'node:fs';
import { parseDataFile, readHeader } from '../src/data/parse';
import { Context } from '../src/data/catalog';
import { Evaluator, addSel, rootOptionsCached, uid, type Roster } from '../src/data/engine';

const dir = process.argv[2];
const catName = process.argv[3];
const files = readdirSync(dir).filter(f => /\.(gst|cat)$/.test(f));
const byId = new Map<string,string>();
for (const f of files) { const h = readHeader(readFileSync(`${dir}/${f}`,'utf8')); if (h) byId.set(h.id, f); }
const parsed = new Map<string, any>();
const load = (id: string) => { if (!parsed.has(id)) { const t0=Date.now(); const doc = new DOMParser().parseFromString(readFileSync(`${dir}/${byId.get(id)}`,'utf8'),'text/xml'); parsed.set(id, parseDataFile(doc.documentElement as any)); console.log('parsed', byId.get(id), Date.now()-t0,'ms'); } return parsed.get(id); };
const gstFile = files.find(f=>f.endsWith('.gst'))!;
const gst = load(readHeader(readFileSync(`${dir}/${gstFile}`,'utf8'))!.id);
const catId = [...byId].find(([,f])=>f.includes(catName))![0];
const cat = load(catId);
const linked: any[] = []; const q=[cat];
while (q.length) { const c=q.pop(); for (const l of c.catalogueLinks) if (byId.has(l.targetId) && !linked.find(x=>x.id===l.targetId)) { const lf=load(l.targetId); linked.push(lf); q.push(lf);} }
const ctx = new Context(gst, cat, linked);
const contexts = new Map([[cat.id, ctx]]);
console.log('forces:', ctx.forceEntries().map(f=>f.name));
const roots = rootOptionsCached(ctx);
console.log('root options', roots.length, roots.slice(0,8).map(o=>o.node.name));
const fe = ctx.forceEntries()[0];
const roster: Roster = { uid: uid(), name:'t', repo:'x', gameSystemId: gst.id, costLimit: 3000, forces:[{uid:uid(), forceEntryId: fe.id, catalogueId: cat.id, selections: []}], created:0, updated:0};
const fu = roster.forces[0].uid;
for (const want of process.argv.slice(4)) {
  const o = roots.find(o=>o.node.name.toLowerCase()===want.toLowerCase()) || roots.find(o=>o.node.name.toLowerCase().includes(want.toLowerCase()));
  if (!o) { console.log('no unit', want); continue; }
  const prim = o.node.categoryLinks.find(c=>c.primary)?.targetId;
  addSel(roster, contexts, fu, null, o, 1, prim);
}
const t0=Date.now(); const ev = new Evaluator(roster, contexts); console.log('eval ms', Date.now()-t0);
const show = (rs:any, d=0) => { console.log('  '.repeat(d)+`${rs.sel.number}x ${rs.eff.name} [${rs.total}]${rs.eff.hidden?' (hidden)':''}`); rs.children.forEach((c:any)=>show(c,d+1)); };
for (const f of ev.forces) { console.log('FORCE', f.entry.name, f.total); f.roots.forEach(r=>show(r,1)); }
console.log('TOTAL', ev.total);
console.log('ISSUES'); ev.issues.slice(0,25).forEach(i=>console.log(' -', i.level, i.message));
