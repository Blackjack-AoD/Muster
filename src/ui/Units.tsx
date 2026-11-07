// The Units tab: unique and preconfigured units are made, changed, duplicated and deleted here. Lists only use them.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { back, go } from '../app';
import type { Context, Opt } from '../data/catalog';
import type { SavedUnit } from '../data/db';
import { Evaluator, isUnique, matchesSaved, rootOptionsCached, type RSel, type Roster } from '../data/engine';
import { activeSystems, gameKey, getContext, systemsOf, type SystemInfo } from '../data/library';
import { failureReason } from '../data/sync';
import { newListLimit, newSavedUnit, savedFrom, unitList, type UnitList } from '../data/units';
import {
  addSavedUnitToStore,
  deleteSavedUnit,
  duplicateSavedUnit,
  failureMessage,
  getState,
  keepSavedUnit,
  toast,
  useRosterCtl,
  useStore,
  type RosterCtl,
} from '../store';
import { Empty, Link, Loading, TopBar, fmtN } from './common';
import { Icon } from './Icon';
import { catalogueName } from './Lists';
import { ChoiceRow, cleanCat, inlineChoice, isUnitLike, silentSetup, unitSummary } from './RosterView';
import { SWIPE, useSwipe } from './swipe';
import { UnitEditor } from './UnitEditor';

const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
const armyKey = (u: Pick<SavedUnit, 'repo' | 'catalogueId'>) => `${u.repo}|${u.catalogueId}`;

/** An army's data, loaded once the phone has read it. */
function useArmy(repoName: string, catId: string) {
  const repo = useStore((s) => s.repos.find((r) => r.repo === repoName));
  const [ctx, setCtx] = useState<Context>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    if (!repo) {
      setErr('That data is not on this phone');
      return;
    }
    let live = true;
    // let the spinner paint before parsing big files
    setTimeout(
      () =>
        getContext(repo, catId)
          .then((c) => live && setCtx(c))
          .catch((e: unknown) => live && setErr(failureReason(e))),
      30,
    );
    return () => void (live = false);
  }, [repoName, catId, repo?.commit]);
  const contexts = useMemo(() => (ctx ? new Map([[catId, ctx]]) : undefined), [ctx]);
  return { ctx, contexts, err };
}

/** The saved units of the chosen game, by army. */
export function Units() {
  const repos = useStore((s) => s.repos);
  const game = useStore((s) => s.game);
  const savedUnits = useStore((s) => s.savedUnits);
  const [q, setQ] = useState('');
  const { active } = activeSystems(repos, game);
  const filterKey = active && systemsOf(repos).length > 1 ? gameKey(active) : undefined;
  const shown = savedUnits.filter((u) => !filterKey || `${u.repo}|${u.gameSystemId}` === filterKey);
  const armies = [...new Set(shown.map(armyKey))]
    .map((k) => {
      const units = shown.filter((u) => armyKey(u) === k);
      const first = units[0];
      return { k, units, name: first ? catalogueName(repos, first.repo, first.catalogueId) : '' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const hasData = systemsOf(repos).length > 0;
  return (
    <div class="page">
      <TopBar title="Units" sub={active ? active.gst.header.name : 'Saved units · all games'} />
      {!shown.length ? (
        <Empty title="No saved units yet">
          <p class="muted">
            Build a unit once, such as a named squad or a favourite loadout, and add it to any list of its army.
          </p>
          {hasData && (
            <button class="btn primary" onClick={() => go('/units/new')}>
              <Icon name="plus" /> New unit
            </button>
          )}
        </Empty>
      ) : (
        <>
          <div class="search">
            <Icon name="search" size={18} />
            <input placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
          <p class="muted small pad-x pick-hint">Tap a unit to change it. Swipe left to delete it.</p>
          {armies.map(({ k, units, name }) => (
            <ArmyUnits key={k} name={name} units={units} q={q} />
          ))}
        </>
      )}
      {hasData && shown.length > 0 && (
        <button class="fab" aria-label="New unit" onClick={() => go('/units/new')}>
          <Icon name="plus" size={26} />
        </button>
      )}
    </div>
  );
}

interface Row {
  unit: SavedUnit;
  name: string;
  sub: string;
  pts: number;
  cat: string;
}

/** One army's saved units, by category. */
function ArmyUnits({ name, units, q }: { name: string; units: SavedUnit[]; q: string }) {
  const first = units[0];
  const { ctx, contexts, err } = useArmy(first?.repo ?? '', first?.catalogueId ?? '');
  const rows = useMemo(() => {
    if (!ctx || !contexts) return [];
    const limit = newListLimit(ctx);
    return units
      .flatMap((unit): Row[] => {
        const list = unitList(unit, contexts, name, limit);
        const rs = new Evaluator(list.roster, contexts).find(list.unitUid);
        if (!rs) return [];
        return [
          {
            unit,
            name: isUnique(unit) ? unit.name : rs.eff.name,
            sub: unitSummary(rs),
            pts: rs.total,
            cat: cleanCat(ctx.categoryName(unit.categoryId)) || 'Other',
          },
        ];
      })
      .sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  }, [units, contexts]);
  const ql = q.trim().toLowerCase();
  const shown = rows.filter((r) => r.name.toLowerCase().includes(ql));
  if (ql && ctx && !shown.length) return null;
  const cats = [...new Set(shown.map((r) => r.cat))];
  return (
    <section class="army-units">
      <h2 class="army-head">{name.replace(/^\d{4}\s*-\s*/, '')}</h2>
      {err && <p class="error-text pad-x">{err}</p>}
      {!ctx && !err && <Loading label="Reading army data…" />}
      {cats.map((c) => (
        <div key={c}>
          <div class="list-label">{c}</div>
          <div class="pick-list" role="group" aria-label={c}>
            {shown
              .filter((r) => r.cat === c)
              .map((r) => (
                <SavedRow key={r.unit.id} row={r} />
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Asks, then deletes a saved unit. Its copies in lists become normal units. Returns whether it did. */
async function confirmDelete(unit: SavedUnit, name: string): Promise<boolean> {
  const question = isUnique(unit)
    ? `Delete "${name}"? Lists that hold it keep it as a normal unit, without the name.`
    : `Delete this preconfigured ${name}? Lists that hold it keep it as a normal unit.`;
  if (!confirm(question)) return false;
  try {
    await deleteSavedUnit(unit.id);
    return true;
  } catch (e) {
    toast(failureMessage('delete this saved unit', e));
    return false;
  }
}

function SavedRow({ row }: { row: Row }) {
  const { dx, handlers, tap } = useSwipe({ onLeft: () => void confirmDelete(row.unit, row.name) });
  return (
    <div class={'pick-swipe' + (dx ? ' active left' : '')}>
      {dx < 0 && (
        <div class={'ps-bg del' + (dx <= -SWIPE ? ' armed' : '')} aria-hidden="true">
          Delete <Icon name="trash" size={18} />
        </div>
      )}
      <button
        class={'pick' + (dx ? ' dragging' : '')}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onClick={tap(() => go(`/units/${encodeURIComponent(row.unit.id)}`))}
        {...handlers}
      >
        <span>
          <b>{row.name}</b>
          {row.sub && <small class="pick-sub">{row.sub}</small>}
        </span>
        <span class="pick-pts">{fmtN(row.pts)}</span>
      </button>
    </div>
  );
}

// ---------- a new unit ----------

/** + on the Units tab: the army (unless the game has one), then one of its units. */
export function NewUnit({ repo, catId }: { repo?: string; catId?: string }) {
  if (repo && catId) return <PickDataUnit repo={repo} catId={catId} />;
  return <PickArmy />;
}

function PickArmy() {
  const repos = useStore((s) => s.repos);
  const game = useStore((s) => s.game);
  const [sys, setSys] = useState<SystemInfo | undefined>(activeSystems(repos, game).active);
  const [q, setQ] = useState('');
  const only = sys?.catalogues.length === 1 ? sys.catalogues[0] : undefined;
  useEffect(() => {
    if (sys && only) go(`/units/new/${enc(sys.repo)}/${encodeURIComponent(only.header.id)}`, true);
  }, [sys, only]);
  if (!sys)
    return (
      <div class="page">
        <TopBar title="New unit" sub="Which game?" backTo="/units" />
        <div class="pick-list">
          {systemsOf(repos).map((s) => (
            <button class="pick" onClick={() => setSys(s)}>
              <span>
                <b>{s.gst.header.name}</b>
                <small>
                  {s.repo} · {s.catalogues.length} armies
                </small>
              </span>
              <Icon name="chev" />
            </button>
          ))}
        </div>
      </div>
    );
  const list = sys.catalogues.filter((c) => c.header.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div class="page">
      <TopBar title="New unit" sub="Pick an army" backTo="/units" />
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search armies" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div class="pick-list">
        {list.map((c) => (
          <Link class="pick" to={`/units/new/${enc(sys.repo)}/${encodeURIComponent(c.header.id)}`}>
            <span>
              <b>{c.header.name}</b>
            </span>
            <Icon name="chev" />
          </Link>
        ))}
      </div>
    </div>
  );
}

const primaryOf = (o: Opt) => (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId ?? '';

/** The army's units by category, with a search. Tapping one makes it a saved unit and opens it. */
function PickDataUnit({ repo, catId }: { repo: string; catId: string }) {
  const repos = useStore((s) => s.repos);
  const { ctx, contexts, err } = useArmy(repo, catId);
  const [q, setQ] = useState('');
  const armyName = catalogueName(repos, repo, catId);
  const groups = useMemo(() => {
    if (!ctx) return [];
    const pts = ctx.pointsType()?.id ?? '';
    const map = new Map<string, { o: Opt; cost: number }[]>();
    for (const o of rootOptionsCached(ctx)) {
      if (o.node.hidden || !isUnitLike(o)) continue;
      const c = primaryOf(o);
      map.set(c, [...(map.get(c) ?? []), { o, cost: ctx.startCost(o.node, pts) }]);
    }
    return [...map]
      .map(([c, items]) => ({
        name: cleanCat(ctx.categoryName(c)) || 'Other',
        items: items.sort((a, b) => a.o.node.name.localeCompare(b.o.node.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ctx]);
  const make = async (o: Opt) => {
    if (!ctx || !contexts) return;
    const place = { repo, catalogueId: catId, armyName, costLimit: newListLimit(ctx) };
    const unit = newSavedUnit(contexts, place, o, Date.now());
    if (!unit) {
      toast("Couldn't set up this unit");
      return;
    }
    try {
      await addSavedUnitToStore(unit);
      go(`/units/${encodeURIComponent(unit.id)}`, true);
    } catch (e) {
      toast(failureMessage('save this unit', e));
    }
  };
  const title = armyName.replace(/^\d{4}\s*-\s*/, '');
  if (err)
    return (
      <div class="page">
        <TopBar title="New unit" backTo="/units" />
        <p class="error-text pad">{err}</p>
      </div>
    );
  if (!ctx)
    return (
      <div class="page">
        <TopBar title="New unit" sub={title} backTo="/units" />
        <Loading label="Reading army data…" />
      </div>
    );
  const ql = q.toLowerCase();
  return (
    <div class="page">
      <TopBar title="New unit" sub={title} backTo="/units" />
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <p class="muted small pad-x pick-hint">Tap a unit to set it up. Name it to make it a unique unit.</p>
      {groups.map((g) => {
        const items = g.items.filter((x) => x.o.node.name.toLowerCase().includes(ql));
        if (!items.length) return null;
        return (
          <div key={g.name}>
            <div class="list-label">{g.name}</div>
            <div class="pick-list">
              {items.map(({ o, cost }) => (
                <button class="pick" key={o.key} onClick={() => void make(o)}>
                  <span>
                    <b>{o.node.name}</b>
                  </span>
                  {cost ? <span class="pick-pts">{fmtN(cost)}</span> : <Icon name="chev" />}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- a saved unit's page ----------

/** A saved unit's page, or with `setUpUid` the page of one of its set-up picks. Every edit keeps the saved unit. */
export function SavedUnitPage({ id, setUpUid }: { id: string; setUpUid?: string }) {
  const unit = useStore((s) => s.savedUnits.find((u) => u.id === id));
  const repos = useStore((s) => s.repos);
  const { ctx, contexts, err } = useArmy(unit?.repo ?? '', unit?.catalogueId ?? '');
  // built once: after that the page's own list holds every edit
  const list = useMemo<UnitList | undefined>(
    () =>
      unit && ctx && contexts
        ? unitList(unit, contexts, catalogueName(repos, unit.repo, unit.catalogueId), newListLimit(ctx))
        : undefined,
    [id, contexts],
  );
  const keep = (r: Roster) => {
    const before = getState().savedUnits.find((u) => u.id === id);
    if (!before || !list) return;
    keepSavedUnit(before, savedFrom(before, { roster: r, unitUid: list.unitUid }, Date.now())).catch((e: unknown) =>
      toast(failureMessage('keep this change', e)),
    );
  };
  // a unit saved before set-ups were kept gets the one it's shown with, so its set-up picks keep their uids
  useEffect(() => {
    if (list && unit && !unit.setUp) keep(list.roster);
  }, [list]);
  const { ctl, error } = useRosterCtl(list?.roster, true, keep);
  const backTo = setUpUid ? `/units/${encodeURIComponent(id)}` : '/units';
  if (!unit)
    return (
      <div class="page">
        <TopBar title="Unit" backTo="/units" />
        <p class="muted pad">This saved unit isn't on this phone any more.</p>
      </div>
    );
  if (err || (list && error))
    return (
      <div class="page">
        <TopBar title="Unit" backTo="/units" />
        <p class="error-text pad">{err ?? error}</p>
      </div>
    );
  if (!ctl || !list)
    return (
      <div class="page">
        <TopBar title="Unit" backTo="/units" />
        <Loading label="Reading army data…" />
      </div>
    );
  if (setUpUid) return <UnitEditor ctl={ctl} selUid={setUpUid} backTo={backTo} />;
  return (
    <UnitEditor
      ctl={ctl}
      selUid={list.unitUid}
      backTo={backTo}
      head={<SetUpSection ctl={ctl} id={id} />}
      foot={<SavedUnitFoot ctl={ctl} unit={unit} unitUid={list.unitUid} />}
    />
  );
}

/** The army set-up the saved unit is built with: quick choices in place, and rows that open the rest. */
function SetUpSection({ ctl, id }: { ctl: RosterCtl; id: string }) {
  const [open, setOpen] = useState(false);
  const picks = (ctl.ev.forces[0]?.roots ?? []).filter((r) => !isUnitLike(r.opt) && !silentSetup(ctl.ev, r));
  if (!picks.length) return null;
  return (
    <section class="unit-setup">
      <button class="group-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="g-name">Army set-up</span>
        <span class="g-lim">{open ? '' : setUpSummary(ctl, picks)}</span>
        <Icon name={open ? 'down' : 'chev'} size={16} />
      </button>
      {open && (
        <div class="opts">
          <p class="muted small pad-x">Built with this set-up. Lists use their own set-up when they add it.</p>
          {picks.map((u) => {
            const ch = inlineChoice(ctl.ev, u);
            return ch ? (
              <div key={u.sel.uid} class="setup-pick">
                <span class="o-name">{u.eff.name}</span>
                <ChoiceRow ctl={ctl} u={u} choice={ch} />
              </div>
            ) : (
              <Link
                key={u.sel.uid}
                class="pick"
                to={`/units/${encodeURIComponent(id)}/s/${encodeURIComponent(u.sel.uid)}`}
              >
                <span>
                  <b>{u.eff.name}</b>
                  {unitSummary(u) && <small class="pick-sub">{unitSummary(u)}</small>}
                </span>
                <Icon name="chev" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The quick choices made in the set-up, such as "Traitor", for the closed heading. */
function setUpSummary(ctl: RosterCtl, picks: RSel[]): string {
  return picks.flatMap((u) => (inlineChoice(ctl.ev, u) ? u.children.map((c) => c.eff.name) : [])).join(' · ');
}

/** Duplicate, delete, and the lists that hold a copy. */
function SavedUnitFoot({ ctl, unit, unitUid }: { ctl: RosterCtl; unit: SavedUnit; unitUid: string }) {
  const rosters = useStore((s) => s.rosters);
  const repos = useStore((s) => s.repos);
  const holding = rosters
    .map((r) => {
      const copies = r.forces.flatMap((f) => f.selections.filter((s) => s.saved === unit.id));
      return { r, copies, own: copies.filter((c) => !matchesSaved(c, unit)).length };
    })
    .filter((x) => x.copies.length > 0);
  const name = ctl.ev.find(unitUid)?.eff.name ?? 'unit';
  return (
    <>
      <div class="unit-actions">
        <button
          class="btn"
          onClick={() =>
            void duplicateSavedUnit(unit.id)
              .then((copy) => go(`/units/${encodeURIComponent(copy.id)}`, true))
              .catch((e: unknown) => toast(failureMessage('duplicate this unit', e)))
          }
        >
          <Icon name="copy" /> Duplicate
        </button>
        <button
          class="btn danger"
          onClick={() =>
            void confirmDelete(unit, isUnique(unit) ? unit.name : name).then((gone) => gone && back('/units'))
          }
        >
          <Icon name="trash" /> Delete
        </button>
      </div>
      <section class="held-in">
        <div class="list-label">In lists</div>
        {!holding.length && <p class="muted small pad-x">No list holds this unit yet.</p>}
        <div class="pick-list">
          {holding.map(({ r, copies, own }) => (
            <Link key={r.uid} class="pick" to={`/r/${encodeURIComponent(r.uid)}`}>
              <span>
                <b>{r.name}</b>
                <small class="pick-sub">
                  {catalogueName(repos, r.repo, r.forces[0]?.catalogueId ?? '')}
                  {own ? ` · ${own === copies.length ? 'changed in this list' : `${own} changed in this list`}` : ''}
                </small>
              </span>
              <span class="pick-pts">{copies.length > 1 ? `×${copies.length}` : ''}</span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
