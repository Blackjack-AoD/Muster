// The army-wide Preconfigured page: every saved unit of the list's armies, added straight into the force org
// without showing it, and a search of the data for new units to set up and save.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { go } from '../app';
import type { Opt } from '../data/catalog';
import type { SavedUnit } from '../data/db';
import {
  addSavedUnit,
  addSel,
  forceRootOptions,
  isUnique,
  savedUnitIsFor,
  tryAddSaved,
  unlinkCopy,
  type RForce,
} from '../data/engine';
import { deleteSavedUnit, failureMessage, toast, useRosterCtl, useStore, type RosterCtl } from '../store';
import { Loading, Sheet, TopBar } from './common';
import { UnitEditor } from './UnitEditor';
import { Icon } from './Icon';
import { catalogueName } from './Lists';
import { PickRow, REFUSED, cleanCat, droppedMessage, heldCopy, isUnitLike, roomFor, unitSummary } from './RosterView';

const primaryOf = (o: Opt) => (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId ?? '';

/** Whether detachment `rf` has a slot for a unit of entry `key` in category `catId`. */
function hasRoom(ctl: RosterCtl, rf: RForce, key: string, catId: string): boolean {
  if (catId && !rf.entry.categoryLinks.some((c) => c.targetId === catId)) return false;
  const opt = forceRootOptions(rf.ctx, rf.entry).find((o) => o.key === key);
  if (!opt || !roomFor(ctl.ev, opt, rf)) return false;
  const lim = ctl.ev.categoryLimits(rf, catId);
  return lim.max < 0 || lim.n < lim.max;
}

/** A detachment's name, with its army when the list has more than one. */
const forceLabel = (rf: RForce) => rf.entry.name.replace(/^\d+\.\s*/, '');

/** Adds the unit to detachment `rf`; `fromSheet` when a sheet closed first, so the unit page replaces it. */
type Add = (rf: RForce, fromSheet: boolean) => void;
type Placing = { title: string; forces: RForce[]; add: Add };

export function PreconfiguredView({ ctl }: { ctl: RosterCtl }) {
  const savedUnits = useStore((s) => s.savedUnits);
  const [q, setQ] = useState('');
  const [placing, setPlacing] = useState<Placing | null>(null);

  const rows = useMemo(
    () =>
      savedUnits
        .flatMap((unit) => {
          const own = ctl.ev.forces.filter((rf) => savedUnitIsFor(unit, ctl.roster.repo, rf.force.catalogueId));
          if (!own.length) return [];
          const fits = own.filter((rf) => hasRoom(ctl, rf, unit.key, unit.categoryId));
          const tried = tryAddSaved(ctl.roster, ctl.contexts, (fits[0] ?? own[0]).force.uid, unit);
          if (!tried) return [];
          const rs = tried.added ? tried.rs : ctl.ev.find(heldCopy(ctl.roster, unit.id) ?? '');
          const name = isUnique(unit) ? unit.name : (rs?.eff.name ?? 'Preconfigured unit');
          const pts = !tried.added ? REFUSED[tried.reason] : fits.length ? tried.pts : 'No room';
          return [{ unit, name, sub: rs ? unitSummary(rs) : undefined, pts, fits }];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [savedUnits, ctl.ev],
  );
  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  const copiesOf = (id: string) =>
    ctl.roster.forces.reduce((t, f) => t + f.selections.filter((s) => s.saved === id).length, 0);

  /** Runs `add` on the only detachment with room, or asks which one when more than 1 has room. */
  const place = (title: string, forces: RForce[], add: Add) => {
    if (forces.length === 1 && forces[0]) add(forces[0], false);
    else if (forces.length > 1) setPlacing({ title, forces, add });
  };
  const addSaved =
    (unit: SavedUnit, open: boolean): Add =>
    (rf, fromSheet) => {
      const out: { uid?: string; dropped: number } = { dropped: 0 };
      ctl.mutate((r) => {
        const res = addSavedUnit(r, ctl.contexts, rf.force.uid, unit);
        if (res.added) Object.assign(out, { uid: res.uid, dropped: res.dropped });
      });
      if (out.dropped > 0) toast(droppedMessage(out.dropped));
      if (open && out.uid) go(`/r/${ctl.roster.uid}/u/${out.uid}`, fromSheet);
    };
  const forget = async (unit: SavedUnit, name: string) => {
    const question = isUnique(unit)
      ? `Delete "${name}"? Lists that hold it keep it as a normal unit, without the name.`
      : `Delete this preconfigured ${name}? Lists that hold it keep it as a normal unit.`;
    if (!confirm(question)) return;
    try {
      await deleteSavedUnit(unit.id);
    } catch (e) {
      toast(failureMessage('delete this saved unit', e));
      return;
    }
    ctl.mutate((r) => {
      for (const f of r.forces) for (const s of f.selections) if (s.saved === unit.id) unlinkCopy(s);
    });
  };

  return (
    <div class="preconfigured">
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      {!shown.length && !q && (
        <p class="muted pad">
          No saved units for this army yet. Search for a unit to set one up, or tap Save updates on a unit's page.
        </p>
      )}
      {shown.length > 0 && (
        <p class="muted small pad-x pick-hint">
          Tap to add and open a unit. Swipe right to add it and stay here, or left to delete it.
        </p>
      )}
      <div class="pick-list" role="group" aria-label="Saved units">
        {shown.map(({ unit, name, sub, pts, fits }) => (
          <PickRow
            key={unit.id}
            name={name}
            sub={sub}
            pts={pts}
            added={isUnique(unit) ? 0 : copiesOf(unit.id)}
            swipeLabel="Add saved build"
            onTap={() => place(name, fits, addSaved(unit, true))}
            onSwipe={() => place(name, fits, addSaved(unit, false))}
            onSwipeLeft={() => void forget(unit, name)}
          />
        ))}
      </div>
      <DataUnits ctl={ctl} forces={ctl.ev.forces} q={q} />
      {placing && <PlaceSheet ctl={ctl} placing={placing} onClose={() => setPlacing(null)} />}
    </div>
  );
}

/** Asks which detachment, of those with room, takes the unit. */
function PlaceSheet({ ctl, placing, onClose }: { ctl: RosterCtl; placing: Placing; onClose: () => void }) {
  const repos = useStore((s) => s.repos);
  return (
    <Sheet title="Add to which detachment?" onClose={onClose}>
      <p class="muted small">{placing.title}</p>
      <div class="menu">
        {placing.forces.map((rf) => (
          <button
            key={rf.force.uid}
            onClick={() => {
              onClose();
              placing.add(rf, true);
            }}
          >
            {forceLabel(rf)} · {catalogueName(repos, ctl.roster.repo, rf.force.catalogueId)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** The plain units of the data, from these detachments and of category `cat` when given, that match `q`. */
export function DataUnits({
  ctl,
  forces,
  cat,
  q,
}: {
  ctl: RosterCtl;
  forces: readonly RForce[];
  cat?: string;
  q: string;
}) {
  const units = useMemo(() => {
    const byKey = new Map<string, { o: Opt; name: string; cat: string; rf: RForce }>();
    for (const rf of forces) {
      for (const o of forceRootOptions(rf.ctx, rf.entry)) {
        const c = primaryOf(o);
        if (!isUnitLike(o) || (cat !== undefined && c !== cat)) continue;
        const e = ctl.ev.optionEff(o, null, rf);
        if (e.hidden) continue;
        const id = `${rf.force.catalogueId}|${o.key}`;
        if (!byKey.has(id)) byKey.set(id, { o, name: e.name, cat: c, rf });
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [forces, cat, ctl.ev]);
  const ql = q.trim().toLowerCase();
  const shown = ql ? units.filter((u) => u.name.toLowerCase().includes(ql)) : [];
  if (!shown.length) return null;
  return (
    <>
      <div class="list-label">From the data</div>
      <p class="muted small pad-x pick-hint">Tap a unit to set it up and save it as a preconfigured unit.</p>
      <div class="pick-list" role="group" aria-label="From the data">
        {shown.map(({ o, name, cat: c, rf }) => (
          <button
            key={`${rf.force.catalogueId}|${o.key}`}
            class="pick"
            onClick={() => go(`/r/${ctl.roster.uid}/new/${rf.force.uid}/${encodeURIComponent(o.key)}`)}
          >
            <span>
              <b>{name}</b>
              {cat === undefined && <small class="pick-sub">{cleanCat(rf.ctx.categoryName(c))}</small>}
            </span>
            <Icon name="chev" />
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * A plain unit of the data, set up on its own page and saved as a preconfigured or unique unit.
 * It sits in a copy of the list, so its options follow the list's set-up, and the list itself never changes.
 */
export function DraftPage({ rosterUid, forceUid, optKey }: { rosterUid: string; forceUid: string; optKey: string }) {
  const roster = useStore((s) => s.rosters.find((r) => r.uid === rosterUid));
  const { ctl, error, loading } = useRosterCtl(roster, true, true);
  const [selUid, setSelUid] = useState<string>();
  const backTo = `/r/${rosterUid}/pre`;
  useEffect(() => {
    if (!ctl || selUid !== undefined) return;
    const rf = ctl.ev.forces.find((f) => f.force.uid === forceUid);
    const opt = rf && forceRootOptions(rf.ctx, rf.entry).find((o) => o.key === optKey);
    let added = '';
    if (opt) {
      ctl.mutate((r) => {
        added = addSel(r, ctl.contexts, forceUid, null, opt, 1, primaryOf(opt) || undefined) ?? '';
      });
    }
    setSelUid(added);
  }, [ctl, selUid]);
  if (!ctl || selUid === '')
    return (
      <div class="page">
        <TopBar title="New saved unit" backTo={backTo} />
        {loading || !ctl ? (
          loading ? (
            <Loading label="Loading army data…" />
          ) : (
            <p class="error-text pad">{error}</p>
          )
        ) : (
          <p class="error-text pad">This unit isn't in this army's data.</p>
        )}
      </div>
    );
  if (selUid === undefined) return <Loading label="Loading army data…" />;
  return <UnitEditor ctl={ctl} selUid={selUid} backTo={backTo} />;
}
