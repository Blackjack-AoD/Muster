// A saved unit lives in a list of its own on the Units tab: its army's set-up and the unit, nothing else.
import type { Context, Opt } from './catalog';
import type { SavedUnit } from './db';
import {
  addSel,
  applySaved,
  isUnique,
  linkCopy,
  matchesSaved,
  tryAddSaved,
  uid,
  unavailable,
  type RSel,
  type Roster,
  type Sel,
} from './engine';
import { setUpForce } from './setup';

/** A saved unit's own list, and the uid of the unit in it. */
export interface UnitList {
  roster: Roster;
  unitUid: string;
}

const UNIT_FORCE = 'unit';

/** A saved unit's list counts as a game of any size, so a rule on the game's size never holds the unit back. */
const ANY_SIZE = Number.POSITIVE_INFINITY;

/** A saved unit's build never holds a name or a link of its own: the copies in lists do. */
export function buildOf({ name: _name, saved: _saved, ...build }: Sel): Sel {
  return build;
}

const primaryOf = (o: Opt) => (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId;

/** The detachment type for a unit of `categoryId`: the first with a slot for it, as the Library's preview picks. */
function forceEntryFor(ctx: Context, categoryId: string): string {
  const forces = ctx.forceEntries();
  return (forces.find((f) => f.categoryLinks.some((c) => c.targetId === categoryId)) ?? forces[0])?.id ?? '';
}

/** An empty one-detachment list of this army, with a new list's set-up unless `setUp` gives the saved one. */
function armyList(
  contexts: Map<string, Context>,
  place: { repo: string; catalogueId: string; armyName: string },
  forceEntryId: string,
  setUp: Sel[] | undefined,
): Roster {
  const ctx = contexts.get(place.catalogueId);
  const roster: Roster = {
    uid: 'unit-' + uid(),
    name: place.armyName,
    repo: place.repo,
    gameSystemId: ctx?.gst.id ?? '',
    costLimit: ANY_SIZE,
    forces: [
      {
        uid: UNIT_FORCE,
        forceEntryId,
        catalogueId: place.catalogueId,
        selections: structuredClone(setUp ?? []),
      },
    ],
    created: 0,
    updated: 0,
  };
  if (!setUp) setUpForce(roster, contexts, UNIT_FORCE, place.armyName);
  return roster;
}

/** The list a saved unit is built in: its set-up, or a new list's when it has none, and the unit. */
export function unitList(unit: SavedUnit, contexts: Map<string, Context>, armyName: string): UnitList {
  const ctx = contexts.get(unit.catalogueId);
  const forceEntryId = unit.setUp?.forceEntryId ?? (ctx ? forceEntryFor(ctx, unit.categoryId) : '');
  const roster = armyList(contexts, { ...unit, armyName }, forceEntryId, unit.setUp?.selections);
  const sel = structuredClone(unit.build);
  sel.categoryId = unit.categoryId;
  if (isUnique(unit)) sel.name = unit.name;
  roster.forces[0]?.selections.push(sel);
  return { roster, unitUid: sel.uid };
}

/** The saved unit as its list now has it. A name makes it unique; no name makes it preconfigured. */
export function savedFrom(unit: SavedUnit, list: UnitList, now: number): SavedUnit {
  const force = list.roster.forces[0];
  const sel = force?.selections.find((s) => s.uid === list.unitUid);
  if (!force || !sel) return unit;
  const { kind: _kind, ...rest } = unit;
  const name = sel.name;
  return {
    ...rest,
    ...(name ? { name } : { name: '', kind: 'preconfigured' as const }),
    build: buildOf(structuredClone(sel)),
    setUp: {
      forceEntryId: force.forceEntryId,
      selections: structuredClone(force.selections.filter((s) => s !== sel)),
    },
    updated: now,
  };
}

/** A new preconfigured unit of the data's unit `opt`, with its mandatory picks and a new list's set-up. */
export function newSavedUnit(
  contexts: Map<string, Context>,
  place: { repo: string; catalogueId: string; armyName: string },
  opt: Opt,
  now: number,
): SavedUnit | null {
  const ctx = contexts.get(place.catalogueId);
  if (!ctx) return null;
  const categoryId = primaryOf(opt) ?? '';
  const roster = armyList(contexts, place, forceEntryFor(ctx, categoryId), undefined);
  const unitUid = addSel(roster, contexts, UNIT_FORCE, null, opt, 1, categoryId || undefined);
  if (unitUid === null) return null;
  const blank: SavedUnit = {
    id: uid(),
    name: '',
    kind: 'preconfigured',
    repo: place.repo,
    gameSystemId: ctx.gst.id,
    catalogueId: place.catalogueId,
    key: opt.key,
    categoryId,
    build: { uid: unitUid, key: opt.key, number: 1, children: [] },
    created: now,
    updated: now,
  };
  return savedFrom(blank, { roster, unitUid }, now);
}

/** A second saved unit built the same way. A unique copy's name says it's the copy, as a list holds each once. */
export function duplicateSaved(unit: SavedUnit, now: number): SavedUnit {
  const copy = structuredClone(unit);
  return {
    ...copy,
    id: uid(),
    ...(isUnique(unit) ? { name: `${unit.name} (copy)` } : {}),
    created: now,
    updated: now,
  };
}

/** The first pick under `rs`, or `rs` itself, that its list's choices don't allow. */
function notAllowed(rs: RSel): RSel | undefined {
  if (rs.eff.hidden || unavailable(rs.eff)) return rs;
  for (const c of rs.children) {
    const bad = notAllowed(c);
    if (bad) return bad;
  }
  return undefined;
}

/** Why a unit added to a list would break there: it, or one of its picks, isn't allowed with the list's choices. */
export function clashOf(rs: RSel): string | undefined {
  const bad = notAllowed(rs);
  return bad ? `${bad.eff.name} isn't allowed in this list` : undefined;
}

/** Why a saved unit would break in detachment `forceUid` of a list. */
export function clashIn(
  roster: Roster,
  contexts: Map<string, Context>,
  forceUid: string,
  unit: SavedUnit,
): string | undefined {
  const tried = tryAddSaved(roster, contexts, forceUid, unit);
  return tried?.added ? clashOf(tried.rs) : undefined;
}

/** The points limit a new list of this game starts with. */
export function newListLimit(ctx: Context): number {
  const pt = ctx.pointsType();
  return pt && pt.defaultCostLimit > 0 ? pt.defaultCostLimit : 3000;
}

/** A copy that still matches its saved unit takes the change; a copy with changes of its own takes only the name. */
export function follow(copy: Sel, before: SavedUnit, after: SavedUnit): void {
  if (matchesSaved(copy, before)) applySaved(copy, after);
  else linkCopy(copy, after);
}

/** The set-up picks of a detachment: everything in it that isn't a unit or a model. */
export function setUpOf(roots: readonly RSel[]): Sel[] {
  return roots.filter((r) => r.node.type !== 'unit' && r.node.type !== 'model').map((r) => structuredClone(r.sel));
}
