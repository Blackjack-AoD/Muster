// Compare default unit points between two engine copies (original vs current) for every unit in a data dir.
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync } from 'node:fs';
const [dir, oldSrc, newSrc] = process.argv.slice(2);
(async () => {
  const load = async (src: string) => ({
    parse: await import(`${src}/data/parse.ts`), cat: await import(`${src}/data/catalog.ts`), eng: await import(`${src}/data/engine.ts`),
  });
  const A = await load(oldSrc), B = await load(newSrc);
  const files = readdirSync(dir).filter((f) => /\.(gst|cat)$/.test(f));
  const run = (M: any) => {
    const byId = new Map<string, string>();
    for (const f of files) { const h = M.parse.readHeader(readFileSync(`${dir}/${f}`, 'utf8')); if (h) byId.set(h.id, f); }
    const P = new Map<string, any>();
    const ld = (id: string) => { if (!P.has(id)) P.set(id, M.parse.parseDataFile(new DOMParser().parseFromString(readFileSync(`${dir}/${byId.get(id)}`, 'utf8'), 'text/xml').documentElement)); return P.get(id); };
    const out = new Map<string, number>();
    for (const [id, f] of byId) {
      const cat = ld(id); if (cat.library || !f.endsWith('.cat')) continue;
      const gst = ld(cat.gameSystemId); const linked: any[] = []; const q = [cat];
      while (q.length) { const c = q.pop(); for (const l of c.catalogueLinks) if (byId.has(l.targetId) && !linked.find((x) => x.id === l.targetId)) { const lf = ld(l.targetId); linked.push(lf); q.push(lf); } }
      const ctx = new M.cat.Context(gst, cat, linked); const contexts = new Map([[cat.id, ctx]]);
      const fe = ctx.forceEntries()[0];
      for (const o of M.eng.forceRootOptions(ctx, fe)) {
        const r = { uid: 'r', name: 't', repo: 'x', gameSystemId: gst.id, costLimit: 0, forces: [{ uid: 'f', forceEntryId: fe.id, catalogueId: cat.id, selections: [] }], created: 0, updated: 0 };
        try { M.eng.addSel(r, contexts, 'f', null, o, 1, o.node.categoryLinks.find((c: any) => c.primary)?.targetId); out.set(`${cat.name} | ${o.node.name}`, new M.eng.Evaluator(r, contexts).total); } catch { out.set(`${cat.name} | ${o.node.name}`, NaN); }
      }
    }
    return out;
  };
  const a = run(A), b = run(B);
  let same = 0; const diffs: string[] = [];
  for (const [k, v] of a) { const w = b.get(k); if (v === w) same++; else diffs.push(`${k}: ${v} -> ${w}`); }
  console.log(`same ${same}, different ${diffs.length}`);
  diffs.forEach((d) => console.log(d));
})();
