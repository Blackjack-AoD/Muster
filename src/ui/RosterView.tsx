import { useEffect, useMemo, useState } from 'preact/hooks';
import { back, go } from '../app';
import { addSel, forceRootOptions, removeSel, uid, unavailable, type Issue, type RForce, type RSel, type Roster } from '../data/engine';
import type { Opt } from '../data/catalog';
import { getContext, systemsOf } from '../data/library';
import { deleteRoster, saveRoster, toast, useRosterCtl, useStore, type RosterCtl } from '../store';
import { Link, Loading, Pts, Sheet, TopBar, fmtN } from './common';
import { Icon } from './Icon';
import { catalogueName } from './Lists';
import { rosterText, shareText } from './exporter';

export const cleanCat = (s: string) => s.replace(/[:\s]+$/, '');

export function RosterView({ uid: rid }: { uid: string }) {
  const roster = useStore((s) => s.rosters.find((r) => r.uid === rid));
  const { ctl, error, loading } = useRosterCtl(roster);
  if (loading) return <div class="page"><TopBar title={roster?.name ?? 'List'} backTo="/" /><Loading label="Loading army data…" /></div>;
  if (!ctl) return <div class="page"><TopBar title="List" backTo="/" /><p class="error-text pad">{error}</p></div>;
  return <RosterBody ctl={ctl} />;
}

function RosterBody({ ctl }: { ctl: RosterCtl }) {
  const { roster, ev } = ctl;
  const repos = useStore((s) => s.repos);
  const [sheet, setSheet] = useState<null | 'menu' | 'issues' | 'force' | { add: RForce; cat?: string }>(null);
  const errors = ev.issues.filter((i) => i.level === 'error');
  const warns = ev.issues.filter((i) => i.level === 'warn');
  const pct = roster.costLimit > 0 ? Math.min(100, (ev.total / roster.costLimit) * 100) : 0;

  return (
    <div class="page">
      <TopBar
        title={roster.name}
        sub={[...new Set(roster.forces.map((f) => catalogueName(repos, roster.repo, f.catalogueId)))].join(' · ')}
        backTo="/"
        right={<button class="icon-btn" aria-label="List options" onClick={() => setSheet('menu')}><Icon name="more" /></button>}
      />
      <div class="sum-bar">
        <div class="sum-row">
          <Pts v={ev.total} limit={roster.costLimit} />
          <button class={'chip ' + (errors.length ? 'bad' : warns.length ? 'warn' : 'good')} onClick={() => setSheet('issues')}>
            <Icon name={errors.length || warns.length ? 'warn' : 'check'} size={16} />
            {errors.length ? `${errors.length} issue${errors.length > 1 ? 's' : ''}` : warns.length ? `${warns.length} note${warns.length > 1 ? 's' : ''}` : 'Valid'}
          </button>
        </div>
        {roster.costLimit > 0 && <div class="meter"><div class={'meter-fill' + (ev.total > roster.costLimit ? ' over' : '')} style={{ width: pct + '%' }} /></div>}
      </div>

      {ev.forces.map((rf) => <ForceBlock key={rf.force.uid} ctl={ctl} rf={rf} onAdd={(cat) => setSheet({ add: rf, cat })} />)}

      <div class="pad">
        <button class="btn ghost wide" onClick={() => setSheet('force')}><Icon name="plus" /> Add detachment</button>
      </div>

      {sheet === 'issues' && <IssuesSheet issues={ev.issues} ctl={ctl} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && <MenuSheet ctl={ctl} onClose={() => setSheet(null)} />}
      {sheet === 'force' && <AddForceSheet ctl={ctl} onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === 'object' && <AddUnitSheet ctl={ctl} rf={sheet.add} cat={sheet.cat} onClose={() => setSheet(null)} />}
    </div>
  );
}

function catLimits(ctl: RosterCtl, rf: RForce, catId: string) {
  return ctl.ev.categoryLimits(rf, catId);
}

function ForceBlock({ ctl, rf, onAdd }: { ctl: RosterCtl; rf: RForce; onAdd: (cat?: string) => void }) {
  const repos = useStore((s) => s.repos);
  const [open, setOpen] = useState(true);
  const avail = useMemo(() => forceRootOptions(rf.ctx, rf.entry), [rf.ctx, rf.entry]);
  const cats = rf.entry.categoryLinks.map((c) => c.targetId);
  const byCat = new Map<string, RSel[]>();
  const other: RSel[] = [];
  for (const r of rf.roots) {
    const c = r.eff.primary && cats.includes(r.eff.primary) ? r.eff.primary : cats.find((x) => r.eff.categories.has(x));
    if (c) byCat.set(c, [...(byCat.get(c) ?? []), r]);
    else other.push(r);
  }
  const primaryOf = (o: Opt) => (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId;
  const catHasOptions = (c: string) => avail.some((o) => primaryOf(o) === c);

  return (
    <section class="force">
      <button class="force-head" onClick={() => setOpen(!open)}>
        <div>
          <div class="force-name">{rf.entry.name.replace(/^\d+\.\s*/, '')}</div>
          <div class="force-sub">{catalogueName(repos, ctl.roster.repo, rf.force.catalogueId)}</div>
        </div>
        <span class="force-pts">{fmtN(rf.total)}</span>
        <Icon name={open ? 'down' : 'chev'} size={18} />
      </button>
      {open && (
        <div class="cats">
          {cats.map((c) => {
            const units = byCat.get(c) ?? [];
            const lim = catLimits(ctl, rf, c);
            if (!units.length && lim.min === 0 && !catHasOptions(c)) return null;
            if (!units.length && lim.max === 0) return null;
            return (
              <div class="cat" key={c}>
                <div class="cat-head">
                  <span class="cat-name">{cleanCat(rf.ctx.categoryName(c))}</span>
                  <span class={'cat-count' + (lim.bad ? ' bad' : '')}>
                    {units.reduce((t, u) => t + u.sel.number, 0)}
                    {(lim.min > 0 || lim.max >= 0) && <small> ({lim.min}–{lim.max < 0 ? '∞' : lim.max})</small>}
                  </span>
                  {catHasOptions(c) && <button class="icon-btn sm" aria-label={'Add ' + cleanCat(rf.ctx.categoryName(c))} onClick={() => onAdd(c)}><Icon name="plus" size={20} /></button>}
                </div>
                {units.map((u) => <UnitRow key={u.sel.uid} ctl={ctl} u={u} />)}
              </div>
            );
          })}
          {other.length > 0 && (
            <div class="cat">
              <div class="cat-head"><span class="cat-name">Other</span></div>
              {other.map((u) => <UnitRow key={u.sel.uid} ctl={ctl} u={u} />)}
            </div>
          )}
          {rf.broken.length > 0 && <p class="muted pad-x small">{rf.broken.length} unit(s) from an older data version couldn't be found.</p>}
          <button class="btn ghost wide add-any" onClick={() => onAdd()}><Icon name="plus" /> Add unit</button>
        </div>
      )}
    </section>
  );
}

export function unitSummary(u: RSel): string {
  // totals across the unit: a group of 5 models each with a plasma gun counts as 5 plasma guns
  const counts = new Map<string, number>();
  const walk = (r: RSel, depth: number, mult: number) => {
    for (const c of r.children) {
      const n = c.sel.number * mult;
      const isModel = c.node.type === 'model';
      const paid = depth < 3 && c.eff.costs.size > 0 && [...c.eff.costs.values()].some((v) => v > 0);
      if ((isModel && n > 0) || paid) counts.set(c.eff.name, (counts.get(c.eff.name) ?? 0) + n);
      walk(c, depth + 1, n);
    }
  };
  walk(u, 0, u.sel.number);
  return [...counts].slice(0, 6).map(([name, n]) => (n > 1 ? `${n}× ${name}` : name)).join(' · ');
}

function UnitRow({ ctl, u }: { ctl: RosterCtl; u: RSel }) {
  const bad = ctl.ev.issues.some((i) => i.level === 'error' && i.selUid && (i.selUid === u.sel.uid || isDescendant(u, i.selUid)));
  const summary = unitSummary(u);
  return (
    <Link class={'unit-row' + (bad ? ' bad' : '')} to={`/r/${ctl.roster.uid}/u/${u.sel.uid}`}>
      <div class="ur-main">
        <div class="ur-name">{u.sel.number > 1 ? `${u.sel.number}× ` : ''}{u.eff.name}</div>
        {summary && <div class="ur-sub">{summary}</div>}
      </div>
      <span class="ur-pts">{fmtN(u.total)}</span>
    </Link>
  );
}

function isDescendant(r: RSel, selUid: string): boolean {
  return r.children.some((c) => c.sel.uid === selUid || isDescendant(c, selUid));
}

function AddUnitSheet({ ctl, rf, cat, onClose }: { ctl: RosterCtl; rf: RForce; cat?: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const list = forceRootOptions(rf.ctx, rf.entry);
    const prim = (o: Opt) => (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId;
    return list
      .filter((o) => !cat || prim(o) === cat)
      .map((o) => ({ o, eff: ctl.ev.optionEff(o, null, rf), cat: prim(o) }))
      .filter((x) => !x.eff.hidden && !unavailable(x.eff));
  }, [rf, cat, ctl.ev]);
  const pt = ctl.ev.pointsTypeId;
  const shown = options.filter((x) => x.eff.name.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, typeof shown>();
  for (const x of shown) groups.set(x.cat ?? '', [...(groups.get(x.cat ?? '') ?? []), x]);

  const add = (o: Opt, catId?: string) => {
    let newUid = '';
    ctl.mutate((r) => { newUid = addSel(r, ctl.contexts, rf.force.uid, null, o, 1, catId); });
    onClose();
    go(`/r/${ctl.roster.uid}/u/${newUid}`);
  };

  return (
    <Sheet title={cat ? `Add ${cleanCat(rf.ctx.categoryName(cat))}` : 'Add unit'} onClose={onClose} full>
      <div class="search"><Icon name="search" size={18} /><input autoFocus placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
      {!shown.length && <p class="muted pad">Nothing available{q ? ' matching that' : ''}.</p>}
      {[...groups].map(([c, items]) => (
        <div key={c}>
          {!cat && <div class="list-label">{cleanCat(rf.ctx.categoryName(c)) || 'Other'}</div>}
          <div class="pick-list">
            {items.map(({ o, eff, cat: oc }) => (
              <button class="pick" onClick={() => add(o, oc)}>
                <span><b>{eff.name}</b></span>
                <span class="pick-pts">{fmtN(eff.costs.get(pt) ?? 0)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

function IssuesSheet({ issues, ctl, onClose }: { issues: Issue[]; ctl: RosterCtl; onClose: () => void }) {
  return (
    <Sheet title="List check" onClose={onClose}>
      {!issues.length && <p class="good-text">No problems found. Remember the app checks points and limits, not every special rule.</p>}
      <ul class="issues">
        {issues.map((i) => (
          <li class={i.level}>
            <Icon name="warn" size={16} />
            {i.selUid ? (
              <a href={`#/r/${ctl.roster.uid}/u/${i.selUid}`} onClick={(e) => { e.preventDefault(); onClose(); go(`/r/${ctl.roster.uid}/u/${i.selUid}`); }}>{i.message}</a>
            ) : <span>{i.message}</span>}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function MenuSheet({ ctl, onClose }: { ctl: RosterCtl; onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  const [name, setName] = useState(ctl.roster.name);
  const [limit, setLimit] = useState(String(ctl.roster.costLimit || ''));
  const save = () => ctl.mutate((r) => { r.name = name.trim() || r.name; r.costLimit = Number(limit) || 0; });
  return (
    <Sheet title="List" onClose={() => { save(); onClose(); }}>
      <div class="form">
        <label>Name<input value={name} onInput={(e) => setName(e.currentTarget.value)} onBlur={save} /></label>
        <label>Points limit<input type="number" inputMode="numeric" value={limit} onInput={(e) => setLimit(e.currentTarget.value)} onBlur={save} /></label>
      </div>
      <div class="menu">
        <button onClick={() => { save(); shareText(rosterText(ctl, repos), ctl.roster.name); }}><Icon name="share" /> Share as text</button>
        <button onClick={async () => {
          save();
          const copy: Roster = { ...structuredClone(ctl.roster), uid: uid(), name: ctl.roster.name + ' (copy)', created: Date.now() };
          await saveRoster(copy);
          onClose();
          go(`/r/${copy.uid}`, true);
          toast('List duplicated');
        }}><Icon name="copy" /> Duplicate list</button>
        <button class="danger" onClick={async () => {
          if (!confirm(`Delete "${ctl.roster.name}"? This can't be undone.`)) return;
          await deleteRoster(ctl.roster.uid);
          onClose();
          back('/');
        }}><Icon name="trash" /> Delete list</button>
      </div>
    </Sheet>
  );
}

function AddForceSheet({ ctl, onClose }: { ctl: RosterCtl; onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  const sys = systemsOf(repos).find((s) => s.repo === ctl.roster.repo && s.gst.header!.id === ctl.roster.gameSystemId);
  const [catId, setCatId] = useState(ctl.roster.forces[0]?.catalogueId);
  const [forces, setForces] = useState<{ id: string; name: string }[]>();
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const repo = repos.find((r) => r.repo === ctl.roster.repo);

  useEffect(() => {
    if (!repo || !catId) return;
    setForces(undefined);
    getContext(repo, catId).then((c) => setForces(c.forceEntries().filter((f) => !f.hidden).map((f) => ({ id: f.id, name: f.name }))));
  }, [catId]);

  if (!sys || !repo) return <Sheet title="Add detachment" onClose={onClose}><p class="error-text">This list's data isn't on the phone.</p></Sheet>;
  if (picking) {
    return (
      <Sheet title="Army" onClose={() => setPicking(false)} full>
        <div class="search"><Icon name="search" size={18} /><input placeholder="Search armies" value={q} onInput={(e) => setQ(e.currentTarget.value)} /></div>
        <div class="pick-list">
          {sys.catalogues.filter((c) => c.header!.name.toLowerCase().includes(q.toLowerCase())).map((c) => (
            <button class="pick" onClick={() => { setCatId(c.header!.id); setPicking(false); }}><span><b>{c.header!.name}</b></span></button>
          ))}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Add detachment" onClose={onClose}>
      <div class="label">Army</div>
      <button class="pick" onClick={() => setPicking(true)}>
        <span><b>{catalogueName(repos, ctl.roster.repo, catId!)}</b><small>Tap to change</small></span><Icon name="chev" />
      </button>
      <div class="label">Detachment</div>
      {!forces ? <Loading /> : (
        <div class="pick-list compact">
          {forces.map((f) => (
            <button class="pick" onClick={() => {
              ctl.mutate((r) => r.forces.push({ uid: uid(), forceEntryId: f.id, catalogueId: catId!, selections: [] }));
              onClose();
            }}><span><b>{f.name}</b></span><Icon name="plus" /></button>
          ))}
        </div>
      )}
      {ctl.roster.forces.length > 1 && (
        <>
          <div class="label">Remove a detachment</div>
          <div class="menu">
            {ctl.ev.forces.map((rf) => (
              <button class="danger" onClick={() => {
                if (!confirm(`Remove ${rf.entry.name} and its ${rf.roots.length} unit(s)?`)) return;
                ctl.mutate((r) => { r.forces = r.forces.filter((f) => f.uid !== rf.force.uid); });
                onClose();
              }}><Icon name="trash" /> {rf.entry.name} · {catalogueName(repos, ctl.roster.repo, rf.force.catalogueId)}</button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

export { removeSel };
