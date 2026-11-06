// The army-wide Preconfigured page: every saved unit of the list's armies, and any unit of the data, added
// straight into the force org without showing it.
import { useMemo, useState } from 'preact/hooks';
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
import { deleteSavedUnit, failureMessage, toast, useStore, type RosterCtl } from '../store';
import { Sheet } from './common';
import { Icon } from './Icon';
import { catalogueName } from './Lists';
import {
  PickRow,
  REFUSED,
  cleanCat,
  droppedMessage,
  heldCopy,
  isUnitLike,
  roomFor,
  startPts,
  unitSummary,
} from './RosterView';

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
  const [addingAny, setAddingAny] = useState(false);

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
  const place = (title: string, forces: RForce[], add: Add, fromSheet = false) => {
    if (forces.length === 1 && forces[0]) add(forces[0], fromSheet);
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
      <div class="search-row">
        <div class="search">
          <Icon name="search" size={18} />
          <input placeholder="Search saved units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </div>
        <button class="icon-btn" aria-label="Add a unit" onClick={() => setAddingAny(true)}>
          <Icon name="plus" />
        </button>
      </div>
      {!shown.length && (
        <p class="muted pad">
          {q
            ? 'No saved units matching that.'
            : "No saved units for this army yet. Change a unit's options and tap Save updates on its page to keep it here."}
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
      {addingAny && (
        <AddAnySheet
          ctl={ctl}
          onPick={(name, forces, add) => {
            setAddingAny(false);
            place(name, forces, add, true);
          }}
          onClose={() => setAddingAny(false)}
        />
      )}
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

/** Every unit of the data any detachment of the list has room for, once each, to search and add. */
function AddAnySheet({
  ctl,
  onPick,
  onClose,
}: {
  ctl: RosterCtl;
  onPick: (name: string, forces: RForce[], add: Add) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const byKey = new Map<string, { o: Opt; name: string; cat: string; pts: number; forces: RForce[] }>();
    for (const rf of ctl.ev.forces) {
      for (const o of forceRootOptions(rf.ctx, rf.entry)) {
        if (!isUnitLike(o)) continue;
        const cat = primaryOf(o);
        if (!hasRoom(ctl, rf, o.key, cat)) continue;
        const id = `${rf.force.catalogueId}|${o.key}`;
        const known = byKey.get(id);
        if (known) {
          known.forces.push(rf);
          continue;
        }
        const eff = ctl.ev.optionEff(o, null, rf);
        byKey.set(id, { o, name: eff.name, cat, pts: startPts(rf, o, eff, ctl.ev.pointsTypeId), forces: [rf] });
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [ctl.ev]);
  const shown = options.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  const addData =
    (o: Opt, cat: string, open: boolean): Add =>
    (rf, fromSheet) => {
      let newUid = '';
      ctl.mutate((r) => {
        newUid = addSel(r, ctl.contexts, rf.force.uid, null, o, 1, cat || undefined) ?? '';
      });
      if (open && newUid) go(`/r/${ctl.roster.uid}/u/${newUid}`, fromSheet);
    };

  return (
    <Sheet title="Add unit" onClose={onClose} full>
      <div class="search">
        <Icon name="search" size={18} />
        <input autoFocus placeholder="Search units" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      {!shown.length && <p class="muted pad">Nothing with room{q ? ' matching that' : ''}.</p>}
      <div class="pick-list">
        {shown.map(({ o, name, cat, pts, forces }) => (
          <PickRow
            key={`${forces[0]?.force.catalogueId}|${o.key}`}
            name={name}
            sub={cleanCat(forces[0]?.ctx.categoryName(cat) ?? '')}
            pts={pts}
            added={0}
            swipeLabel="Add with standard options"
            onTap={() => onPick(name, forces, addData(o, cat, true))}
            onSwipe={() => onPick(name, forces, addData(o, cat, false))}
          />
        ))}
      </div>
    </Sheet>
  );
}
