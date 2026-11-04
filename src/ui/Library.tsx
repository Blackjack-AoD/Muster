import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { go } from '../app';
import type { Context, Opt } from '../data/catalog';
import { addSel, rootOptionsCached, uid, unavailable, type Roster, type RSel } from '../data/engine';
import { activeSystems, gameKey, getContext } from '../data/library';
import { compendium, type CompRule } from '../data/rules';
import { useRosterCtl, useStore, type RosterCtl } from '../store';
import { Empty, Link, Loading, Pts, TopBar, fmtN } from './common';
import { Icon } from './Icon';
import { cleanCat } from './RosterView';
import { ProfileTable, Profiles, Rules, limitText } from './UnitEditor';

const enc = (repo: string) => repo.split('/').map(encodeURIComponent).join('/');

export function Library({ repo, catId, unitKey }: { repo?: string; catId?: string; unitKey?: string }) {
  if (repo && catId && unitKey) return <UnitPreview repo={repo} catId={catId} unitKey={unitKey} />;
  if (repo && catId) return <UnitList repo={repo} catId={catId} />;
  return <Armies />;
}

/** Armies / Rules switch at the top of the Library */
function LibTabs({ on }: { on: 'armies' | 'rules' }) {
  return (
    <div class="tabs lib-tabs" role="tablist">
      <button role="tab" aria-selected={on === 'armies'} class={on === 'armies' ? 'on' : ''} onClick={() => on !== 'armies' && go('/lib', true)}>Armies</button>
      <button role="tab" aria-selected={on === 'rules'} class={on === 'rules' ? 'on' : ''} onClick={() => on !== 'rules' && go('/lib-rules', true)}>Rules</button>
    </div>
  );
}

function NoData({ title }: { title: string }) {
  return (
    <div class="page">
      <TopBar title={title} />
      <Empty title="No data yet"><p class="muted">Download army data on the <Link to="/data" replace>Data</Link> tab.</p></Empty>
    </div>
  );
}

function Armies() {
  const repos = useStore((s) => s.repos);
  const game = useStore((s) => s.game);
  const [q, setQ] = useState('');
  const { systems, active } = activeSystems(repos, game);
  if (!systems.length) return <NoData title="Library" />;
  return (
    <div class="page">
      <TopBar title="Library" sub={active ? active.gst.header!.name : 'All games'} right={<Link class="icon-btn sm" to="/games"><Icon name="dice" /></Link>} />
      <LibTabs on="armies" />
      <div class="search"><Icon name="search" size={18} /><input placeholder="Search armies" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
      {systems.map((s) => {
        const cats = s.catalogues.filter((c) => c.header!.name.toLowerCase().includes(q.toLowerCase()));
        if (!cats.length) return null;
        return (
          <div key={s.repo + s.gst.path}>
            {!active && <div class="list-label">{s.gst.header!.name} <small class="muted">· {s.repo}</small></div>}
            <div class={'pick-list' + (active ? ' first' : '')}>
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

const PAGE = 60;

/** Every rule in the chosen game's data files, searchable. */
export function Compendium() {
  const repos = useStore((s) => s.repos);
  const game = useStore((s) => s.game);
  const { systems, active } = activeSystems(repos, game);
  const [rules, setRules] = useState<CompRule[]>();
  const [err, setErr] = useState<string>();
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    setRules(undefined);
    if (!active) return;
    setTimeout(() => compendium(active.repo, active).then(setRules).catch((e) => setErr((e as Error).message)), 30);
  }, [active && gameKey(active), active?.gst.sha]);
  useEffect(() => setShown(PAGE), [q]);

  if (!systems.length) return <NoData title="Rules" />;
  const head = (
    <>
      <TopBar title="Library" sub={active ? active.gst.header!.name : 'All games'} right={<Link class="icon-btn sm" to="/games"><Icon name="dice" /></Link>} />
      <LibTabs on="rules" />
    </>
  );
  if (!active) {
    return (
      <div class="page">
        {head}
        <Empty title="Pick a game"><p class="muted">The rules list covers one game at a time. Choose it on the <Link to="/games">Games</Link> tab.</p></Empty>
      </div>
    );
  }
  if (err) return <div class="page">{head}<p class="error-text pad">{err}</p></div>;
  if (!rules) return <div class="page">{head}<Loading label="Gathering rules…" /></div>;
  // every word must appear; rules whose name matches come first
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? rules.filter((r) => words.every((w) => r.hay.includes(w)))
      .sort((a, b) => Number(words.every((w) => b.name.toLowerCase().includes(w))) - Number(words.every((w) => a.name.toLowerCase().includes(w))))
    : rules;
  return (
    <div class="page">
      {head}
      <div class="search sticky-search"><Icon name="search" size={18} />
        <input placeholder={`Search ${rules.length.toLocaleString('en-GB')} rules`} value={q} onInput={(e) => setQ(e.currentTarget.value)} autocapitalize="off" />
        {q && <button class="icon-btn sm" aria-label="Clear search" onClick={() => setQ('')}><Icon name="x" size={18} /></button>}
      </div>
      {q && <p class="muted small pad-x">{hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No rules match that.'}</p>}
      <div class="rules">
        {hits.slice(0, shown).map((r) => (
          <details class="rule" key={r.name} open={hits.length === 1}>
            <summary>{r.name}{r.versions.length > 1 && <small class="muted"> · {r.versions.length} versions</small>}</summary>
            {r.versions.map((v) => (
              <div class="rule-ver">
                <p>{v.description || <span class="muted">No description in the data.</span>}</p>
                <p class="rule-src">{v.sources.length > 3 ? `${v.sources.slice(0, 3).join(', ')} +${v.sources.length - 3} more` : v.sources.join(', ')}</p>
              </div>
            ))}
          </details>
        ))}
        {hits.length > shown && (
          <div class="pad-x"><button class="btn wide" onClick={() => setShown(shown + PAGE * 2)}>Show more ({hits.length - shown} left)</button></div>
        )}
      </div>
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

/** Read-only look at a unit: stats, standard loadout, what it can take, rules. Building happens in Lists. */
function UnitPreview({ repo, catId, unitKey }: { repo: string; catId: string; unitKey: string }) {
  const { ctx, err } = useCtx(repo, catId);
  // a throwaway one-unit list, filled with the unit's mandatory picks, so profiles and points are the real ones
  const scratch = useMemo<Roster | undefined>(() => {
    if (!ctx) return undefined;
    const opt = rootOptionsCached(ctx).find((o) => o.key === unitKey);
    if (!opt) return undefined;
    const prim = (opt.node.categoryLinks.find((l) => l.primary) ?? opt.node.categoryLinks[0])?.targetId;
    const forces = ctx.forceEntries();
    const fe = forces.find((f) => f.categoryLinks.some((c) => c.targetId === prim)) ?? forces[0];
    const r: Roster = {
      uid: 'preview-' + uid(), name: 'Preview', repo, gameSystemId: ctx.gst.id, costLimit: 0,
      forces: [{ uid: 'pf', forceEntryId: fe?.id ?? '', catalogueId: catId, selections: [] }], created: 0, updated: 0,
    };
    addSel(r, new Map([[catId, ctx]]), 'pf', null, opt, 1, prim);
    return r;
  }, [ctx, unitKey]);
  const { ctl, error } = useRosterCtl(scratch, true);
  const [tab, setTab] = useState<'overview' | 'profiles' | 'rules'>('overview');
  const backTo = `/lib/${enc(repo)}/${encodeURIComponent(catId)}`;
  if (err || error) return <div class="page"><TopBar title="Unit" backTo={backTo} /><p class="error-text pad">{err || error}</p></div>;
  if (ctx && !scratch) return <div class="page"><TopBar title="Unit" backTo={backTo} /><p class="muted pad">This unit isn't in the data any more.</p></div>;
  const rs = ctl?.ev.forces[0]?.roots[0];
  if (!ctl || !rs) return <div class="page"><TopBar title="Unit" backTo={backTo} /><Loading /></div>;
  const cat = rs.eff.primary ? cleanCat(rs.force.ctx.categoryName(rs.eff.primary)) : '';
  return (
    <div class="page unit-page">
      <TopBar title={rs.eff.name} sub={cat} backTo={backTo} right={rs.total ? <Pts v={rs.total} /> : null} />
      <div class="tabs" role="tablist">
        {(['overview', 'profiles', 'rules'] as const).map((t) => (
          <button role="tab" aria-selected={tab === t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'profiles' ? 'Profiles' : 'Rules'}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview ctl={ctl} rs={rs} />}
      {tab === 'profiles' && <Profiles ctl={ctl} profiles={ctl.ev.profilesFor(rs)} />}
      {tab === 'rules' && <Rules ctl={ctl} rs={rs} />}
    </div>
  );
}

function Overview({ ctl, rs }: { ctl: RosterCtl; rs: RSel }) {
  const all = ctl.ev.profilesFor(rs);
  const types = [...new Set(all.map((p) => p.typeName))];
  const main = types.find((t) => /unit|model|vehicle|knight|titan|walker|infantry|primarch/i.test(t)) ?? types[0];
  const stats = all.filter((p) => p.typeName === main && p.characteristics.every((c) => c.value.length < 30));
  return (
    <div class="overview">
      {stats.length > 0 && <div class="strip"><ProfileTable profiles={stats} /></div>}
      <section class="ov-sec">
        <h3>Standard loadout</h3>
        <Loadout rs={rs} />
      </section>
      <section class="ov-sec">
        <h3>Options</h3>
        <OptionsInfo ctl={ctl} rs={rs} depth={0} />
      </section>
      <p class="muted small pad-x">To change squad size or wargear, add this unit to a list on the Lists tab.</p>
    </div>
  );
}

/** what the unit comes with by default, as totals (5 models with a bolter = 5× Bolter) */
function Loadout({ rs }: { rs: RSel }) {
  const lines: { depth: number; text: string; pts: number }[] = [];
  const walk = (r: RSel, depth: number, mult: number) => {
    for (const c of r.children) {
      const k = c.sel.number * mult;
      lines.push({ depth, text: `${k > 1 ? k + '× ' : ''}${c.eff.name}`, pts: c.total * mult });
      walk(c, depth + 1, k);
    }
  };
  walk(rs, 0, rs.sel.number);
  if (!lines.length) return <p class="muted small">Nothing beyond the unit itself.</p>;
  return (
    <ul class="loadout">
      {lines.map((l) => <li style={{ paddingLeft: `${l.depth * 16}px` }}>{l.text}{l.pts ? <span class="o-pts">{fmtN(l.pts)}</span> : null}</li>)}
    </ul>
  );
}

/** the choices a unit offers, as plain text: groups with their limits, options with their cost */
function OptionsInfo({ ctl, rs, depth }: { ctl: RosterCtl; rs: RSel; depth: number }) {
  const { ev } = ctl;
  const visible = (o: Opt) => {
    const e = ev.optionEff(o, rs, rs.force);
    return !e.hidden && !unavailable(e);
  };
  const row = (o: Opt): ComponentChildren => {
    const e = ev.optionEff(o, rs, rs.force);
    const { min, max } = ev.limits(o, rs, rs.force, e);
    const lim = limitText(min, max);
    if (o.kind === 'group') {
      const members = o.members.filter(visible);
      if (!members.length) return null;
      return (
        <li class="oi-group">
          <div class="oi-head"><b>{e.name}</b>{lim && <span class="muted"> · {lim}</span>}</div>
          <ul>{members.map(row)}</ul>
        </li>
      );
    }
    const cost = e.costs.get(ev.pointsTypeId);
    return (
      <li>
        <span>{e.name}{lim && lim !== 'up to 1' && lim !== 'pick 1' ? <span class="muted"> ({lim})</span> : null}</span>
        {cost ? <span class="o-pts">{cost > 0 ? '+' : ''}{fmtN(cost)}{rs.sel.number > 1 ? <small> ea</small> : null}</span> : null}
      </li>
    );
  };
  const opts = rs.force.ctx.options(rs.node).filter(visible);
  // the unit's models carry their own choices (weapons per model)
  const kids = depth < 3 ? rs.children.filter((c) => rs.force.ctx.options(c.node).some((o) => {
    const e = ev.optionEff(o, c, c.force);
    return !e.hidden && !unavailable(e);
  })) : [];
  const seen = new Set<string>();
  if (!opts.length && !kids.length) return depth ? null : <p class="muted small">No options.</p>;
  return (
    <>
      {opts.length > 0 && <ul class="opt-info">{opts.map(row)}</ul>}
      {kids.filter((c) => !seen.has(c.opt.key) && seen.add(c.opt.key)).map((c) => (
        <div class="oi-sub">
          <div class="oi-subhead">{c.eff.name}</div>
          <OptionsInfo ctl={ctl} rs={c} depth={depth + 1} />
        </div>
      ))}
    </>
  );
}
