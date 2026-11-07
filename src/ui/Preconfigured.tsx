// The army-wide Preconfigured page: every saved unit of the list's armies, added straight into the force org
// without showing it. Saved units are made and changed on the Units tab.
import { useMemo, useState } from 'preact/hooks';
import { go } from '../app';
import type { SavedUnit } from '../data/db';
import {
  addSavedUnit,
  forceRootOptions,
  isUnique,
  removeSel,
  savedUnitIsFor,
  tryAddSaved,
  type RForce,
  type Roster,
} from '../data/engine';
import { clashOf } from '../data/units';
import { toast, useStore, type RosterCtl } from '../store';
import { Sheet } from './common';
import { Icon } from './Icon';
import { catalogueName } from './Lists';
import { PickRow, REFUSED, RefusedRow, droppedMessage, heldCopy, roomFor, unitSummary } from './RosterView';

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
          const clash = tried.added ? clashOf(tried.rs) : undefined;
          // a unique unit the list holds can't go in again: it shows the points of the copy it holds
          const pts = !tried.added
            ? tried.reason === 'already-in-list' && rs
              ? rs.total
              : REFUSED[tried.reason]
            : fits.length
              ? tried.pts
              : 'No room';
          return [{ unit, name, sub: rs ? unitSummary(rs) : undefined, pts, fits, clash }];
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [savedUnits, ctl.ev],
  );
  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));

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

  return (
    <div class="preconfigured">
      <div class="search">
        <Icon name="search" size={18} />
        <input placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      {!shown.length && <p class="muted pad">{q ? 'No saved units matching that.' : NO_SAVED_UNITS}</p>}
      {shown.length > 0 && (
        <p class="muted small pad-x pick-hint">
          Tap to add and open a unit. Swipe right to add it and stay here, or left to take one out of the list.
        </p>
      )}
      <div class="pick-list" role="group" aria-label="Saved units">
        {shown.map(({ unit, name, sub, pts, fits, clash }) =>
          clash ? (
            <RefusedRow key={unit.id} name={name} sub={clash} reason="Not allowed" />
          ) : (
            <PickRow
              key={unit.id}
              name={name}
              sub={sub}
              pts={pts}
              added={copiesOf(ctl.roster, unit.id)}
              swipeLabel="Add saved build"
              onTap={() => place(name, fits, addSaved(unit, true))}
              onSwipe={() => place(name, fits, addSaved(unit, false))}
              onSwipeLeft={() => takeOff(ctl, name, unit)}
            />
          ),
        )}
      </div>
      {placing && <PlaceSheet ctl={ctl} placing={placing} onClose={() => setPlacing(null)} />}
    </div>
  );
}

/** How many copies of saved unit `id` a list holds, in any detachment. */
export const copiesOf = (r: Roster, id: string) =>
  r.forces.reduce((t, f) => t + f.selections.filter((s) => s.saved === id).length, 0);

/** What a list shows when its armies have no saved units. */
export const NO_SAVED_UNITS = 'No saved units for this army yet. Make them on the Units tab.';

/** A swipe left on a saved unit: takes its last copy out of the list, with Undo. The saved unit stays. */
export function takeOff(ctl: RosterCtl, name: string, unit: SavedUnit): void {
  const held = ctl.roster.forces.flatMap((f) => f.selections.filter((s) => s.saved === unit.id).map((s) => ({ f, s })));
  const last = held[held.length - 1];
  if (!last) return;
  const forceUid = last.f.uid;
  const idx = last.f.selections.indexOf(last.s);
  const copy = structuredClone(last.s);
  ctl.mutate((r) => removeSel(r, copy.uid));
  toast(`Removed ${name}`, {
    label: 'Undo',
    run: () =>
      ctl.mutate((r) => {
        const f = r.forces.find((x) => x.uid === forceUid);
        if (f) f.selections.splice(Math.min(idx, f.selections.length), 0, copy);
      }),
  });
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
