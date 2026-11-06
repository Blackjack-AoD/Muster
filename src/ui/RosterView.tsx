import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { go } from '../app';
import {
  addSavedUnit,
  addSel,
  displayName,
  duplicateSel,
  Evaluator,
  forceRootOptions,
  issuesOn,
  locate,
  removeSel,
  uid,
  unavailable,
  type AddSavedResult,
  type Issue,
  type RForce,
  type RSel,
  type Roster,
} from '../data/engine';
import type { Context, Opt } from '../data/catalog';
import type { SavedUnit } from '../data/db';
import { getContext, systemsOf } from '../data/library';
import {
  addRoster,
  deleteRoster,
  failureMessage,
  getState,
  toast,
  useRosterCtl,
  useStore,
  type RosterCtl,
} from '../store';
import { Loading, Pts, Sheet, TopBar, fmtN } from './common';
import { pick, setUpForce } from '../data/setup';
import { SWIPE, useSwipe } from './swipe';
import { Icon } from './Icon';
import { catalogueName } from './Lists';
import { rosterText, shareText } from './exporter';

export const cleanCat = (s: string) => s.replace(/[:\s]+$/, '');

/** Asks the player first, and returns whether the list has gone. */
async function deleteList(r: Roster): Promise<boolean> {
  if (!confirm(`Delete "${r.name}"? This can't be undone.`)) return false;
  try {
    await deleteRoster(r.uid);
    return true;
  } catch (e) {
    toast(failureMessage('delete this list', e));
    return false;
  }
}

export function RosterView({ uid: rid }: { uid: string }) {
  const roster = useStore((s) => s.rosters.find((r) => r.uid === rid));
  const { ctl, error, loading } = useRosterCtl(roster);
  if (loading)
    return (
      <div class="page">
        <TopBar title={roster?.name ?? 'List'} backTo="/" />
        <Loading label="Loading army data…" />
      </div>
    );
  if (!roster)
    return (
      <div class="page">
        <TopBar title="List" backTo="/" />
        <p class="muted pad">This list has been deleted.</p>
      </div>
    );
  if (!ctl)
    return (
      <div class="page">
        <TopBar title="List" backTo="/" />
        <p class="error-text pad">{error}</p>
        <div class="pad">
          <button
            class="btn danger wide"
            onClick={async () => {
              if (await deleteList(roster)) go('/', true);
            }}
          >
            <Icon name="trash" /> Delete list
          </button>
        </div>
      </div>
    );
  return <RosterBody ctl={ctl} />;
}

function RosterBody({ ctl }: { ctl: RosterCtl }) {
  const { roster, ev } = ctl;
  const repos = useStore((s) => s.repos);
  const [sheet, setSheet] = useState<null | 'menu' | 'issues' | 'force' | { forceUid: string; cat?: string }>(null);
  const errors = ev.issues.filter((i) => i.level === 'error');
  const warns = ev.issues.filter((i) => i.level === 'warn');
  const pct = roster.costLimit > 0 ? Math.min(100, (ev.total / roster.costLimit) * 100) : 0;
  // looked up on each render: a unit added with the sheet open has to count against the next one
  const adding = typeof sheet === 'object' ? sheet : null;
  const addTo = adding && ev.forces.find((f) => f.force.uid === adding.forceUid);

  return (
    <div class="page">
      <TopBar
        title={roster.name}
        sub={[...new Set(roster.forces.map((f) => catalogueName(repos, roster.repo, f.catalogueId)))].join(' · ')}
        backTo="/"
        right={
          <button class="icon-btn" aria-label="List options" onClick={() => setSheet('menu')}>
            <Icon name="more" />
          </button>
        }
      />
      <div class="sum-bar">
        <div class="sum-row">
          <Pts v={ev.total} limit={roster.costLimit} />
          <button
            class={'chip ' + (errors.length ? 'bad' : warns.length ? 'warn' : 'good')}
            onClick={() => setSheet('issues')}
          >
            <Icon name={errors.length || warns.length ? 'warn' : 'check'} size={16} />
            {errors.length
              ? `${errors.length} issue${errors.length > 1 ? 's' : ''}`
              : warns.length
                ? `${warns.length} note${warns.length > 1 ? 's' : ''}`
                : 'Valid'}
          </button>
        </div>
        {roster.costLimit > 0 && (
          <div class="meter">
            <div class={'meter-fill' + (ev.total > roster.costLimit ? ' over' : '')} style={{ width: pct + '%' }} />
          </div>
        )}
      </div>

      {ev.forces.map((rf) => (
        <ForceBlock key={rf.force.uid} ctl={ctl} rf={rf} onAdd={(cat) => setSheet({ forceUid: rf.force.uid, cat })} />
      ))}

      <div class="pad">
        <button class="btn ghost wide" onClick={() => setSheet('force')}>
          <Icon name="plus" /> Add detachment
        </button>
      </div>

      {sheet === 'issues' && <IssuesSheet issues={ev.issues} ctl={ctl} onClose={() => setSheet(null)} />}
      {sheet === 'menu' && <MenuSheet ctl={ctl} onClose={() => setSheet(null)} />}
      {sheet === 'force' && <AddForceSheet ctl={ctl} onClose={() => setSheet(null)} />}
      {adding && addTo && <AddUnitSheet ctl={ctl} rf={addTo} cat={adding.cat} onClose={() => setSheet(null)} />}
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
  // only offer "+" when something in the category can still be added (set-up entries are usually one-offs already taken)
  const canAdd = (c: string) => avail.some((o) => primaryOf(o) === c && roomFor(ctl.ev, o, rf));
  const setupOnly = (c: string) => avail.every((o) => primaryOf(o) !== c || !isUnitLike(o));

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
            const all = byCat.get(c) ?? [];
            const lim = catLimits(ctl, rf, c);
            // counting-only sections (e.g. Compulsory HQ / Troops) hold no units of their own: their problems show as issues
            if (!all.length && !catHasOptions(c)) return null;
            if (!all.length && lim.min === 0 && !catHasOptions(c)) return null;
            if (!all.length && lim.max === 0) return null;
            // set-up picks with nothing to choose (e.g. the Legion itself) stay in the list but out of sight
            const units = all.filter((u) => !silentSetup(ctl.ev, u));
            if (!units.length && all.length && !lim.bad && !canAdd(c)) return null;
            const plus = canAdd(c);
            const showCount = lim.bad || !setupOnly(c);
            return (
              <div class="cat" key={c}>
                <div class="cat-head">
                  <span class="cat-name">{cleanCat(rf.ctx.categoryName(c))}</span>
                  {showCount && (
                    <span class={'cat-count' + (lim.bad ? ' bad' : '')}>
                      {all.reduce((t, u) => t + u.sel.number, 0)}
                      {(lim.min > 0 || lim.max >= 0) && (
                        <small>
                          {' '}
                          ({lim.min}–{lim.max < 0 ? '∞' : lim.max})
                        </small>
                      )}
                    </span>
                  )}
                  {plus && (
                    <button
                      class="icon-btn sm"
                      aria-label={'Add ' + cleanCat(rf.ctx.categoryName(c))}
                      onClick={() => onAdd(c)}
                    >
                      <Icon name="plus" size={20} />
                    </button>
                  )}
                </div>
                {units.map((u) => {
                  const ch = inlineChoice(ctl.ev, u);
                  return ch ? (
                    <ChoiceRow key={u.sel.uid} ctl={ctl} u={u} choice={ch} />
                  ) : (
                    <UnitRow key={u.sel.uid} ctl={ctl} u={u} />
                  );
                })}
              </div>
            );
          })}
          {other.length > 0 && (
            <div class="cat">
              <div class="cat-head">
                <span class="cat-name">Other</span>
              </div>
              {other.map((u) => (
                <UnitRow key={u.sel.uid} ctl={ctl} u={u} />
              ))}
            </div>
          )}
          {rf.broken.length > 0 && (
            <p class="muted pad-x small">{rf.broken.length} unit(s) from an older data version couldn't be found.</p>
          )}
          <button class="btn ghost wide add-any" onClick={() => onAdd()}>
            <Icon name="plus" /> Add unit
          </button>
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
  return [...counts]
    .slice(0, 6)
    .map(([name, n]) => (n > 1 ? `${n}× ${name}` : name))
    .join(' · ');
}

const isUnitLike = (o: Opt) => o.node.type === 'unit' || o.node.type === 'model';

function visibleOpts(ev: Evaluator, rs: RSel) {
  return rs.force.ctx.options(rs.node).filter((o) => {
    const e = ev.optionEff(o, rs, rs.force);
    return !e.hidden && !unavailable(e);
  });
}

/** a set-up entry (not a unit) with no choices in it at all, e.g. the Legion picked when the list was made */
function silentSetup(_ev: Evaluator, rs: RSel) {
  return !isUnitLike(rs.opt) && !rs.total && rs.force.ctx.options(rs.node).length === 0;
}

/** room for another of this root option in the force (its own max, ignoring category limits) */
function roomFor(ev: Evaluator, o: Opt, rf: RForce) {
  const e = ev.optionEff(o, null, rf);
  if (e.hidden || unavailable(e)) return false;
  const have = rf.roots.filter((r) => r.opt.key === o.key).reduce((t, r) => t + r.sel.number, 0);
  for (const c of e.constraints) {
    if (c.type !== 'max' || c.field !== 'selections' || c.value < 0) continue;
    if ((c.scope === 'parent' || c.scope === 'force') && have >= c.value) return false;
  }
  return ev.roomBeyondParent(o, null, rf, e);
}

/**
 * A set-up entry that is just "pick one of a few" (e.g. Allegiance: Loyalist / Traitor) is shown as buttons
 * right on the list, instead of a row that opens a page.
 */
function inlineChoice(ev: Evaluator, rs: RSel): { g: Opt; members: Opt[] } | null {
  if (isUnitLike(rs.opt) || rs.total) return null;
  const opts = visibleOpts(ev, rs);
  if (opts.length !== 1 || opts[0].kind !== 'group') return null;
  const g = opts[0];
  if (ev.limits(g, rs, rs.force).max !== 1) return null;
  const members = g.members.filter((m) => {
    const e = ev.optionEff(m, rs, rs.force);
    return !e.hidden && !unavailable(e);
  });
  if (members.length < 2 || members.length > 4) return null;
  if (members.some((m) => m.kind !== 'entry' || rs.force.ctx.options(m.node).length > 0)) return null;
  return { g, members };
}

function ChoiceRow({ ctl, u, choice }: { ctl: RosterCtl; u: RSel; choice: { g: Opt; members: Opt[] } }) {
  return (
    <div class="choice-row" role="radiogroup" aria-label={u.eff.name}>
      {choice.members.map((m) => {
        const on = u.children.some((c) => c.opt.key === m.key);
        return (
          <button
            role="radio"
            aria-checked={on}
            class={on ? 'on' : ''}
            onClick={() => {
              if (on) return;
              ctl.mutate((r) => pick(r, ctl.contexts, u, choice.g, m));
            }}
          >
            {ctl.ev.optionEff(m, u, u.force).name}
          </button>
        );
      })}
    </div>
  );
}

/** Tap to open. Swipe left to delete (with Undo), swipe right to duplicate. */
function UnitRow({ ctl, u }: { ctl: RosterCtl; u: RSel }) {
  const issues = issuesOn(ctl.ev, u);
  const bad = issues.some((i) => i.level === 'error');
  const noted = !bad && issues.length > 0;
  const summary = unitSummary(u);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; id: number; swiping: boolean; moved: boolean } | null>(null);
  const to = `/r/${ctl.roster.uid}/u/${u.sel.uid}`;
  const swipeable = isUnitLike(u.opt);

  const remove = () => {
    const loc = locate(ctl.roster, u.sel.uid);
    if (!loc) return;
    const idx = loc.list.indexOf(loc.sel);
    const saved = structuredClone(loc.sel);
    const forceUid = loc.force.uid;
    ctl.mutate((r) => removeSel(r, u.sel.uid));
    toast(`Removed ${displayName(u)}`, {
      label: 'Undo',
      run: () =>
        ctl.mutate((r) => {
          const f = r.forces.find((x) => x.uid === forceUid);
          if (f) f.selections.splice(Math.min(idx, f.selections.length), 0, saved);
        }),
    });
  };
  const duplicate = () => {
    ctl.mutate((r) => duplicateSel(r, u.sel.uid));
    toast(`Duplicated ${u.eff.name}`);
  };

  const onDown = (e: PointerEvent) => {
    if (!swipeable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, swiping: false, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.swiping) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
        drag.current = null;
        return;
      } // scrolling
      if (Math.abs(mx) < 12) return;
      d.swiping = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    d.moved = true;
    setDx(Math.max(-160, Math.min(160, mx)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.swiping) return;
    const x = dx;
    setDx(0);
    if (x <= -SWIPE) remove();
    else if (x >= SWIPE) duplicate();
    // swallow the click that follows a swipe
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 50);
  };
  const suppressClick = useRef(false);

  return (
    <div class={'swipe' + (dx > 0 ? ' dup' : dx < 0 ? ' del' : '')}>
      {swipeable && (
        <div class="swipe-bg" aria-hidden="true">
          <span class={'sb-dup' + (dx >= SWIPE ? ' armed' : '')}>
            <Icon name="copy" size={18} /> Duplicate
          </span>
          <span class={'sb-del' + (dx <= -SWIPE ? ' armed' : '')}>
            Delete <Icon name="trash" size={18} />
          </span>
        </div>
      )}
      <a
        class={'unit-row' + (bad ? ' bad' : noted ? ' warn' : '') + (dx ? ' dragging' : '')}
        href={'#' + to}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onClick={(e) => {
          e.preventDefault();
          if (!suppressClick.current) go(to);
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          setDx(0);
        }}
      >
        <div class="ur-main">
          <div class="ur-name">
            {u.sel.number > 1 ? `${u.sel.number}× ` : ''}
            {displayName(u)}
          </div>
          {u.sel.name !== undefined && <div class="ur-sub ur-data">{u.eff.name}</div>}
          {summary && <div class="ur-sub">{summary}</div>}
        </div>
        {noted && (
          <span class="ur-note">
            <Icon name="warn" size={14} />
            note
          </span>
        )}
        {u.total || swipeable ? <span class="ur-pts">{fmtN(u.total)}</span> : <Icon name="chev" size={18} />}
      </a>
    </div>
  );
}

/** price shown before adding: the unit with its standard models and gear (own cost after modifiers) */
function startPts(rf: RForce, o: Opt, eff: { costs: Map<string, number> }, pt: string) {
  const base = o.node.costs.find((c) => c.typeId === pt)?.value ?? 0;
  return rf.ctx.startCost(o.node, pt) - base + (eff.costs.get(pt) ?? 0);
}

/**
 * What adding a saved unit to this detachment would do, tried on a copy of the list:
 * its price, why its row can't add it, or null when it isn't offered here at all.
 */
function trySaved(ctl: RosterCtl, rf: RForce, unit: SavedUnit): { pts: number } | { refused: string } | null {
  const copy = structuredClone(ctl.roster);
  const res = addSavedUnit(copy, ctl.contexts, rf.force.uid, unit);
  if (res.added) return { pts: new Evaluator(copy, ctl.contexts).find(res.uid)?.total ?? 0 };
  switch (res.reason) {
    case 'already-in-list':
      return { refused: 'Added' };
    case 'unit-gone':
      return { refused: 'No longer in the data' };
    case 'no-detachment':
    case 'other-army-file':
      return null;
    default:
      return res.reason satisfies never;
  }
}

const droppedMessage = (n: number) =>
  n === 1 ? '1 option is no longer in the data' : `${n} options are no longer in the data`;

function PickRow({
  name,
  pts,
  refused,
  added,
  swipeLabel,
  onTap,
  onSwipe,
}: {
  name: string;
  pts: number;
  /** why it can't be added, shown in place of the price */
  refused?: string;
  added: number;
  swipeLabel: string;
  onTap: () => void;
  onSwipe: () => void;
}) {
  const { dx, handlers, tap } = useSwipe({ onRight: onSwipe });
  return (
    <div class={'pick-swipe' + (dx ? ' active' : '')}>
      <div class={'ps-bg' + (dx >= SWIPE ? ' armed' : '')} aria-hidden="true">
        <Icon name="plus" size={18} /> {swipeLabel}
      </div>
      <button
        class={'pick' + (dx ? ' dragging' : '')}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onClick={tap(onTap)}
        {...handlers}
      >
        <span>
          <b>{name}</b>
        </span>
        <span class="pick-pts">
          {refused ?? fmtN(pts)}
          {added > 0 && (
            <small class="pick-added" aria-label={`${added} added`}>
              {' '}
              ×{added}
            </small>
          )}
        </span>
      </button>
    </div>
  );
}

function AddUnitSheet({ ctl, rf, cat, onClose }: { ctl: RosterCtl; rf: RForce; cat?: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const list = forceRootOptions(rf.ctx, rf.entry);
    const prim = (o: Opt) => (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId;
    return list
      .filter((o) => (!cat || prim(o) === cat) && roomFor(ctl.ev, o, rf))
      .map((o) => ({ o, eff: ctl.ev.optionEff(o, null, rf), cat: prim(o) }));
  }, [rf, cat, ctl.ev]);
  const pt = ctl.ev.pointsTypeId;
  const shown = options.filter((x) => x.eff.name.toLowerCase().includes(q.toLowerCase()));
  const savedUnits = useStore((s) => s.savedUnits);
  const saved = useMemo(
    () =>
      savedUnits
        .filter((u) => !cat || u.categoryId === cat)
        .flatMap((unit) => {
          const tried = trySaved(ctl, rf, unit);
          return tried ? [{ unit, tried }] : [];
        }),
    [savedUnits, rf, cat, ctl.ev],
  );
  const savedShown = saved.filter(({ unit }) => unit.name.toLowerCase().includes(q.toLowerCase()));
  const groups = new Map<string, typeof shown>();
  for (const x of shown) groups.set(x.cat ?? '', [...(groups.get(x.cat ?? '') ?? []), x]);

  const add = (o: Opt, catId?: string) => {
    let newUid = '';
    ctl.mutate((r) => {
      newUid = addSel(r, ctl.contexts, rf.force.uid, null, o, 1, catId) ?? '';
    });
    onClose();
    if (newUid) go(`/r/${ctl.roster.uid}/u/${newUid}`, true);
  };
  /** Returns the new copy's uid, or null when the list refused it. */
  const addSaved = (unit: SavedUnit): string | null => {
    const out: { res?: AddSavedResult } = {};
    ctl.mutate((r) => {
      out.res = addSavedUnit(r, ctl.contexts, rf.force.uid, unit);
    });
    if (!out.res?.added) return null;
    if (out.res.dropped > 0) toast(droppedMessage(out.res.dropped));
    return out.res.uid;
  };
  const openSaved = (unit: SavedUnit) => {
    const newUid = addSaved(unit);
    if (!newUid) return;
    onClose();
    go(`/r/${ctl.roster.uid}/u/${newUid}`, true);
  };
  // swipe right: add with standard options and stay here; counts shown only while this list is open
  const [quick, setQuick] = useState<Record<string, number>>({});
  const quickAdd = (o: Opt, catId?: string) => {
    ctl.mutate((r) => {
      addSel(r, ctl.contexts, rf.force.uid, null, o, 1, catId);
    });
    setQuick((m) => ({ ...m, [o.key]: (m[o.key] ?? 0) + 1 }));
  };

  return (
    <Sheet title={cat ? `Add ${cleanCat(rf.ctx.categoryName(cat))}` : 'Add unit'} onClose={onClose} full>
      <div class="search">
        <Icon name="search" size={18} />
        <input autoFocus placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      {savedShown.length > 0 && (
        <>
          <div class="list-label">Saved</div>
          <div class="pick-list" role="group" aria-label="Saved units">
            {savedShown.map(({ unit, tried }) =>
              'pts' in tried ? (
                <PickRow
                  key={unit.id}
                  name={unit.name}
                  pts={tried.pts}
                  added={0}
                  swipeLabel="Add saved build"
                  onTap={() => openSaved(unit)}
                  onSwipe={() => addSaved(unit)}
                />
              ) : (
                <PickRow
                  key={unit.id}
                  name={unit.name}
                  pts={0}
                  refused={tried.refused}
                  added={0}
                  swipeLabel="Add saved build"
                  onTap={() => {}}
                  onSwipe={() => {}}
                />
              ),
            )}
          </div>
        </>
      )}
      {!shown.length && !savedShown.length && <p class="muted pad">Nothing available{q ? ' matching that' : ''}.</p>}
      {shown.length + savedShown.length > 0 && (
        <p class="muted small pad-x pick-hint">Tap to add and open a unit. Swipe right to add it and stay here.</p>
      )}
      {[...groups].map(([c, items]) => (
        <div key={c}>
          {!cat && <div class="list-label">{cleanCat(rf.ctx.categoryName(c)) || 'Other'}</div>}
          <div class="pick-list">
            {items.map(({ o, eff, cat: oc }) => (
              <PickRow
                key={o.key}
                name={eff.name}
                pts={startPts(rf, o, eff, pt)}
                added={quick[o.key] ?? 0}
                swipeLabel="Add with standard options"
                onTap={() => add(o, oc)}
                onSwipe={() => quickAdd(o, oc)}
              />
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
      {!issues.length && (
        <p class="good-text">No problems found. Remember the app checks points and limits, not every special rule.</p>
      )}
      <ul class="issues">
        {issues.map((i) => (
          <li class={i.level}>
            <Icon name="warn" size={16} />
            {i.selUid ? (
              <a
                href={`#/r/${ctl.roster.uid}/u/${i.selUid}`}
                onClick={(e) => {
                  e.preventDefault();
                  onClose();
                  go(`/r/${ctl.roster.uid}/u/${i.selUid}`, true);
                }}
              >
                {i.message}
              </a>
            ) : (
              <span>{i.message}</span>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

/** Saves a copy and returns its uid, or tells the player why it couldn't. */
async function duplicateList(ctl: RosterCtl): Promise<string | undefined> {
  const copy: Roster = {
    ...structuredClone(ctl.roster),
    uid: uid(),
    name: ctl.roster.name + ' (copy)',
    created: Date.now(),
  };
  try {
    await addRoster(copy);
    return copy.uid;
  } catch (e) {
    // the Retry toast from a failed save is the only way left to save this list's edit
    if (!getState().toastAction?.failedSave) toast(failureMessage('copy this list', e));
    return undefined;
  }
}

function MenuSheet({ ctl, onClose }: { ctl: RosterCtl; onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  const [name, setName] = useState(ctl.roster.name);
  const [limit, setLimit] = useState(String(ctl.roster.costLimit || ''));
  const save = () =>
    ctl.mutate((r) => {
      r.name = name.trim() || r.name;
      r.costLimit = Number(limit) || 0;
    });
  return (
    <Sheet
      title="List"
      onClose={() => {
        save();
        onClose();
      }}
    >
      <div class="form">
        <label>
          Name
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} onBlur={save} />
        </label>
        <label>
          Points limit
          <input
            type="number"
            inputMode="numeric"
            value={limit}
            onInput={(e) => setLimit(e.currentTarget.value)}
            onBlur={save}
          />
        </label>
      </div>
      <div class="menu">
        <button
          onClick={() => {
            save();
            onClose();
            go(`/r/${ctl.roster.uid}/sheet`, true);
          }}
        >
          <Icon name="book" /> Army sheet: print, PDF or share link
        </button>
        <button
          onClick={async () => {
            save();
            await shareText(rosterText(ctl, repos), ctl.roster.name);
          }}
        >
          <Icon name="share" /> Share as text
        </button>
        <button
          onClick={async () => {
            save();
            const copyUid = await duplicateList(ctl);
            if (!copyUid) return;
            onClose();
            go(`/r/${copyUid}`, true);
            toast('List duplicated');
          }}
        >
          <Icon name="copy" /> Duplicate list
        </button>
        <button
          class="danger"
          onClick={async () => {
            if (!(await deleteList(ctl.roster))) return;
            onClose();
            go('/', true);
          }}
        >
          <Icon name="trash" /> Delete list
        </button>
      </div>
    </Sheet>
  );
}

function AddForceSheet({ ctl, onClose }: { ctl: RosterCtl; onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  const sys = systemsOf(repos).find((s) => s.repo === ctl.roster.repo && s.gst.header.id === ctl.roster.gameSystemId);
  const [catId, setCatId] = useState(ctl.roster.forces[0]?.catalogueId);
  const [forces, setForces] = useState<{ id: string; name: string }[]>();
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState(false);
  const repo = repos.find((r) => r.repo === ctl.roster.repo);

  useEffect(() => {
    if (!repo || !catId) return;
    setForces(undefined);
    getContext(repo, catId)
      .then((c) =>
        setForces(
          c
            .forceEntries()
            .filter((f) => !f.hidden)
            .map((f) => ({ id: f.id, name: f.name })),
        ),
      )
      .catch((e: unknown) => toast(failureMessage('load this army', e)));
  }, [catId]);

  if (!sys || !repo)
    return (
      <Sheet title="Add detachment" onClose={onClose}>
        <p class="error-text">This list's data isn't on the phone.</p>
      </Sheet>
    );
  if (picking) {
    return (
      <Sheet title="Army" onClose={() => setPicking(false)} full>
        <div class="search">
          <Icon name="search" size={18} />
          <input placeholder="Search armies" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </div>
        <div class="pick-list">
          {sys.catalogues
            .filter((c) => c.header.name.toLowerCase().includes(q.toLowerCase()))
            .map((c) => (
              <button
                class="pick"
                onClick={() => {
                  setCatId(c.header.id);
                  setPicking(false);
                }}
              >
                <span>
                  <b>{c.header.name}</b>
                </span>
              </button>
            ))}
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet title="Add detachment" onClose={onClose}>
      <div class="label">Army</div>
      <button class="pick" onClick={() => setPicking(true)}>
        <span>
          <b>{catalogueName(repos, ctl.roster.repo, catId)}</b>
          <small>Tap to change</small>
        </span>
        <Icon name="chev" />
      </button>
      <div class="label">Detachment</div>
      {!forces ? (
        <Loading />
      ) : (
        <div class="pick-list compact">
          {forces.map((f) => (
            <button
              class="pick"
              onClick={async () => {
                let ctx: Context;
                try {
                  ctx = await getContext(repo, catId);
                } catch (e) {
                  toast(failureMessage('load this army', e));
                  return;
                }
                const contexts = new Map(ctl.contexts).set(catId, ctx);
                ctl.mutate((r) => {
                  const fu = uid();
                  r.forces.push({ uid: fu, forceEntryId: f.id, catalogueId: catId, selections: [] });
                  try {
                    setUpForce(r, contexts, fu, catalogueName(repos, r.repo, catId));
                  } catch (e) {
                    console.warn('set-up skipped', e);
                  }
                });
                onClose();
              }}
            >
              <span>
                <b>{f.name}</b>
              </span>
              <Icon name="plus" />
            </button>
          ))}
        </div>
      )}
      {ctl.roster.forces.length > 1 && (
        <>
          <div class="label">Remove a detachment</div>
          <div class="menu">
            {ctl.ev.forces.map((rf) => (
              <button
                class="danger"
                onClick={() => {
                  if (!confirm(`Remove ${rf.entry.name} and its ${rf.roots.length} unit(s)?`)) return;
                  ctl.mutate((r) => {
                    r.forces = r.forces.filter((f) => f.uid !== rf.force.uid);
                  });
                  onClose();
                }}
              >
                <Icon name="trash" /> {rf.entry.name} · {catalogueName(repos, ctl.roster.repo, rf.force.catalogueId)}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

export { removeSel };
