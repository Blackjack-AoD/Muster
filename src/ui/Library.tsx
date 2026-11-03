import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Context, Opt } from '../data/catalog';
import { addSel, rootOptionsCached, uid, type Roster } from '../data/engine';
import { getContext, systemsOf } from '../data/library';
import { useRosterCtl, useStore } from '../store';
import { Empty, Link, Loading, TopBar, fmtN } from './common';
import { Icon } from './Icon';
import { cleanCat } from './RosterView';
import { UnitEditor } from './UnitEditor';

const enc = (repo: string) => repo.split('/').map(encodeURIComponent).join('/');

export function Library({ repo, catId, unitKey }: { repo?: string; catId?: string; unitKey?: string }) {
  if (repo && catId && unitKey) return <UnitPreview repo={repo} catId={catId} unitKey={unitKey} />;
  if (repo && catId) return <UnitList repo={repo} catId={catId} />;
  return <Armies />;
}

function Armies() {
  const repos = useStore((s) => s.repos);
  const [q, setQ] = useState('');
  const systems = systemsOf(repos);
  if (!systems.length) {
    return (
      <div class="page">
        <TopBar title="Library" />
        <Empty title="No data yet"><p class="muted">Download army data on the <Link to="/data" replace>Data</Link> tab.</p></Empty>
      </div>
    );
  }
  return (
    <div class="page">
      <TopBar title="Library" sub="Browse units, wargear and rules" />
      <div class="search"><Icon name="search" size={18} /><input placeholder="Search armies" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
      {systems.map((s) => {
        const cats = s.catalogues.filter((c) => c.header!.name.toLowerCase().includes(q.toLowerCase()));
        if (!cats.length) return null;
        return (
          <div key={s.repo + s.gst.path}>
            <div class="list-label">{s.gst.header!.name} <small class="muted">· {s.repo}</small></div>
            <div class="pick-list">
              {cats.map((c) => (
                <Link class="pick" to={`/lib/${enc(s.repo)}/${encodeURIComponent(c.header!.id)}`}>
                  <span><b>{c.header!.name.replace(/^\d{4}\s*-\s*/, '')}</b></span>
                  <Icon name="chev" />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function useCtx(repoName: string, catId: string) {
  const repos = useStore((s) => s.repos);
  const repo = repos.find((r) => r.repo === repoName);
  const [ctx, setCtx] = useState<Context>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (!repo) { setErr('That data is not on this phone'); return; }
    setTimeout(() => getContext(repo, catId).then(setCtx).catch((e) => setErr((e as Error).message)), 30);
  }, [repoName, catId, repo?.commit]);
  return { ctx, err };
}

function UnitList({ repo, catId }: { repo: string; catId: string }) {
  const { ctx, err } = useCtx(repo, catId);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    if (!ctx) return [];
    const pts = ctx.pointsType()?.id ?? '';
    const map = new Map<string, { o: Opt; cost: number }[]>();
    for (const o of rootOptionsCached(ctx)) {
      if (o.node.hidden) continue;
      const c = (o.node.categoryLinks.find((l) => l.primary) ?? o.node.categoryLinks[0])?.targetId ?? '';
      map.set(c, [...(map.get(c) ?? []), { o, cost: o.node.costs.find((x) => x.typeId === pts)?.value ?? 0 }]);
    }
    return [...map].map(([c, items]) => ({ name: cleanCat(ctx.categoryName(c)) || 'Other', items: items.sort((a, b) => a.o.node.name.localeCompare(b.o.node.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ctx]);
  const title = ctx?.cat.name.replace(/^\d{4}\s*-\s*/, '') ?? 'Army';
  if (err) return <div class="page"><TopBar title="Army" backTo="/lib" /><p class="error-text pad">{err}</p></div>;
  if (!ctx) return <div class="page"><TopBar title={title} backTo="/lib" /><Loading label="Reading army data…" /></div>;
  const ql = q.toLowerCase();
  return (
    <div class="page">
      <TopBar title={title} sub={ctx.gst.name} backTo="/lib" />
      <div class="search"><Icon name="search" size={18} /><input placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
      {groups.map((g) => {
        const items = g.items.filter((x) => x.o.node.name.toLowerCase().includes(ql));
        if (!items.length) return null;
        return (
          <div key={g.name}>
            <div class="list-label">{g.name}</div>
            <div class="pick-list">
              {items.map(({ o, cost }) => (
                <Link class="pick" to={`/lib/${enc(repo)}/${encodeURIComponent(catId)}/${encodeURIComponent(o.key)}`}>
                  <span><b>{o.node.name}</b></span>
                  {cost ? <span class="pick-pts">{fmtN(cost)}</span> : <Icon name="chev" />}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A throwaway one-unit list so options and points can be explored without saving. */
function UnitPreview({ repo, catId, unitKey }: { repo: string; catId: string; unitKey: string }) {
  const { ctx, err } = useCtx(repo, catId);
  const scratch = useMemo<Roster | undefined>(() => {
    if (!ctx) return undefined;
    const opt = rootOptionsCached(ctx).find((o) => o.key === unitKey);
    const prim = opt && (opt.node.categoryLinks.find((l) => l.primary) ?? opt.node.categoryLinks[0])?.targetId;
    const forces = ctx.forceEntries();
    const fe = forces.find((f) => f.categoryLinks.some((c) => c.targetId === prim)) ?? forces[0];
    return {
      uid: 'preview-' + uid(), name: 'Preview', repo, gameSystemId: ctx.gst.id, costLimit: 0,
      forces: [{ uid: 'pf', forceEntryId: fe?.id ?? '', catalogueId: catId, selections: [] }], created: 0, updated: 0,
    };
  }, [ctx, unitKey]);
  const { ctl, error } = useRosterCtl(scratch, true);
  const [selUid, setSelUid] = useState<string>();
  useEffect(() => {
    if (!ctl || selUid) return;
    const opt = rootOptionsCached(ctl.contexts.get(catId)!).find((o) => o.key === unitKey);
    if (!opt) return;
    const prim = (opt.node.categoryLinks.find((l) => l.primary) ?? opt.node.categoryLinks[0])?.targetId;
    let id = '';
    ctl.mutate((r) => { id = addSel(r, ctl.contexts, 'pf', null, opt, 1, prim); });
    setSelUid(id);
  }, [ctl]);
  const backTo = `/lib/${enc(repo)}/${encodeURIComponent(catId)}`;
  if (err || error) return <div class="page"><TopBar title="Unit" backTo={backTo} /><p class="error-text pad">{err || error}</p></div>;
  if (!ctl || !selUid) return <div class="page"><TopBar title="Unit" backTo={backTo} /><Loading /></div>;
  return (
    <>
      <UnitEditor ctl={ctl} selUid={selUid} backTo={backTo} />
      <p class="muted small pad-x preview-note">Preview only: changes here aren't saved. Add units to a list from the Lists tab.</p>
    </>
  );
}
