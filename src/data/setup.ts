// What a new detachment starts with: its mandatory one-off entries (e.g. Horus Heresy's Legion, Allegiance,
// Rite of War, Expanded Army Lists), set up the way most players want them.
import type { Context, Opt } from './catalog';
import {
  Evaluator,
  addSel,
  forceRootOptions,
  locate,
  rootOptionsCached,
  unavailable,
  type RSel,
  type Roster,
  type Sel,
} from './engine';

/** Unit-like entries are what players add by hand; everything else that's mandatory is set-up. */
const isUnitLike = (o: Opt) => o.node.type === 'unit' || o.node.type === 'model';

/** A group that is just an On/Off switch, e.g. "Legacy Units" → "Legacy Units On" / "Legacy Units Off". */
export function onOffPair(members: Opt[]): { on: Opt; off: Opt } | null {
  if (members.length !== 2 || members.some((m) => m.kind !== 'entry')) return null;
  const on = members.find((m) => /\bon$/i.test(m.node.name.trim()));
  const off = members.find((m) => /\boff$/i.test(m.node.name.trim()));
  return on && off ? { on, off } : null;
}

/** Root set-up entries the force must have, added once each. Returns how many were added. */
export function addMandatoryRoots(roster: Roster, contexts: Map<string, Context>, forceUid: string): number {
  let added = 0;
  for (let pass = 0; pass < 12; pass++) {
    const ev = new Evaluator(roster, contexts);
    const rf = ev.forces.find((f) => f.force.uid === forceUid);
    if (!rf) return added;
    let did = false;
    for (const o of forceRootOptions(rf.ctx, rf.entry)) {
      if (isUnitLike(o)) continue;
      const eff = ev.optionEff(o, null, rf);
      if (eff.hidden || unavailable(eff)) continue;
      const mins = eff.constraints.filter((c) => c.type === 'min' && c.field === 'selections' && c.value >= 1);
      const forceMin = mins
        .filter((c) => c.scope === 'parent' || c.scope === 'force')
        .reduce((m, c) => Math.max(m, c.value), 0);
      // once per list (e.g. 40k 10th edition's Battle Size and Detachment): count every force
      const rosterMin = mins.filter((c) => c.scope === 'roster').reduce((m, c) => Math.max(m, c.value), 0);
      const here = rf.roots.filter((r) => r.opt.key === o.key).length;
      const everywhere = ev.forces.reduce((t, f) => t + f.roots.filter((r) => r.node.id === o.node.id).length, 0);
      if (here >= forceMin && everywhere >= rosterMin) continue;
      const cat = (o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0])?.targetId;
      addSel(roster, contexts, forceUid, null, o, 1, cat);
      added++;
      did = true;
      break; // re-evaluate: one set-up choice can switch others on or off
    }
    if (!did) break;
  }
  return added;
}

// Horus Heresy: which side each faction took in the lore. Anything not listed is Loyalist.
const TRAITOR = [
  "emperor's children",
  'emperor’s children',
  'iron warriors',
  'night lords',
  'world eaters',
  'death guard',
  'thousand sons',
  'sons of horus',
  'word bearers',
  'alpha legion',
  'daemon',
  'ruinstorm',
];
export function loreAllegiance(armyName: string): 'Traitor' | 'Loyalist' {
  const n = armyName.toLowerCase();
  return TRAITOR.some((t) => n.includes(t)) ? 'Traitor' : 'Loyalist';
}

export type Side = 'Loyalist' | 'Traitor';

/** A pick-one group offering Loyalist and Traitor. */
function sides(g: Opt): { loyalist: Opt; traitor: Opt } | null {
  if (g.kind !== 'group') return null;
  const named = (name: string) => g.members.find((m) => m.node.name.trim().toLowerCase() === name);
  const loyalist = named('loyalist');
  const traitor = named('traitor');
  return loyalist && traitor ? { loyalist, traitor } : null;
}

/** Whether a choice's options are Loyalist and Traitor. */
export function isAllegianceChoice(members: Opt[]): boolean {
  const names = new Set(members.map((m) => m.node.name.trim().toLowerCase()));
  return names.has('loyalist') && names.has('traitor');
}

/** The side a detachment's set-up picked, if it has a Loyalist / Traitor choice. */
export function allegianceOf(roster: Roster, contexts: Map<string, Context>, forceUid: string): Side | undefined {
  const rf = new Evaluator(roster, contexts).forces.find((f) => f.force.uid === forceUid);
  for (const rs of rf?.roots ?? []) {
    for (const g of rs.force.ctx.options(rs.node)) {
      const s = sides(g);
      if (!s) continue;
      if (rs.children.some((c) => c.opt.key === s.loyalist.key)) return 'Loyalist';
      if (rs.children.some((c) => c.opt.key === s.traitor.key)) return 'Traitor';
    }
  }
  return undefined;
}

/** Set every Loyalist / Traitor choice in the detachment's set-up to `side`. */
export function setAllegiance(roster: Roster, contexts: Map<string, Context>, forceUid: string, side: Side) {
  const rf = new Evaluator(roster, contexts).forces.find((f) => f.force.uid === forceUid);
  for (const rs of rf?.roots ?? []) {
    for (const g of rf?.ctx.options(rs.node) ?? []) {
      const s = sides(g);
      if (s) pick(roster, contexts, rs, g, side === 'Traitor' ? s.traitor : s.loyalist);
    }
  }
}

/** Set the Loyalist / Traitor choice to the army's side in the lore. */
export function applyLoreAllegiance(
  roster: Roster,
  contexts: Map<string, Context>,
  forceUid: string,
  armyName: string,
) {
  setAllegiance(roster, contexts, forceUid, loreAllegiance(armyName));
}

/** Every detachment after the first fights on the first one's side. */
export function matchAllegiance(roster: Roster, contexts: Map<string, Context>) {
  const [first, ...rest] = roster.forces;
  const side = first && allegianceOf(roster, contexts, first.uid);
  if (!side) return;
  for (const f of rest)
    if (allegianceOf(roster, contexts, f.uid) !== side) setAllegiance(roster, contexts, f.uid, side);
}

/** Turn every On/Off switch in the force's set-up entries On. */
export function switchesOn(roster: Roster, contexts: Map<string, Context>, forceUid: string) {
  for (let pass = 0; pass < 40; pass++) {
    const ev = new Evaluator(roster, contexts);
    const rf = ev.forces.find((f) => f.force.uid === forceUid);
    if (!rf) return;
    let did = false;
    const walk = (rs: RSel, opts: Opt[]): boolean => {
      for (const g of opts) {
        if (g.kind !== 'group') continue;
        const pair = onOffPair(
          g.members.filter((m) => {
            const e = ev.optionEff(m, rs, rf);
            return !e.hidden && !unavailable(e);
          }),
        );
        if (pair && !rs.children.some((c) => c.opt.key === pair.on.key)) {
          pick(roster, contexts, rs, g, pair.on);
          return true;
        }
        if (walk(rs, g.members)) return true;
      }
      return false;
    };
    for (const rs of rf.roots) {
      if (isUnitLike(rs.opt)) continue;
      if (walk(rs, rf.ctx.options(rs.node))) {
        did = true;
        break;
      }
    }
    if (!did) return;
  }
}

/** Make `target` the only pick within group g under rs. */
export function pick(roster: Roster, contexts: Map<string, Context>, rs: RSel, g: Opt, target: Opt) {
  const loc = locate(roster, rs.sel.uid);
  if (!loc) return;
  if (loc.sel.children.some((c) => c.key === target.key)) return;
  loc.sel.children = loc.sel.children.filter((c) => !c.key.startsWith(g.key + '/'));
  addSel(roster, contexts, rs.force.force.uid, rs.sel.uid, target, 1);
}

/** Everything a brand-new detachment should start with. */
export function setUpForce(roster: Roster, contexts: Map<string, Context>, forceUid: string, armyName: string) {
  addMandatoryRoots(roster, contexts, forceUid);
  applyLoreAllegiance(roster, contexts, forceUid, armyName);
  switchesOn(roster, contexts, forceUid);
}

/** Whether every option chosen beneath a selection is still in the data, under `node` in `ctx`. */
function optionsHold(ctx: Context, node: Opt['node'], sels: Sel[]): boolean {
  return sels.every((c) => {
    const o = ctx.findOption(node, c.key);
    return o !== undefined && optionsHold(ctx, o.node, c.children);
  });
}

/**
 * Moves a detachment to another detachment type or army, on the list's side.
 * A move to another army keeps each plain unit that army also has, and takes out the rest, with every set-up pick.
 * Returns how many units it took out.
 */
export function changeForce(
  roster: Roster,
  contexts: Map<string, Context>,
  forceUid: string,
  catalogueId: string,
  forceEntryId: string,
  armyName: string,
): number {
  const force = roster.forces.find((f) => f.uid === forceUid);
  const from = force && contexts.get(force.catalogueId);
  const to = contexts.get(catalogueId);
  const entry = to?.forceEntries().find((f) => f.id === forceEntryId);
  if (!force || !from || !to || !entry) return 0;
  const first = roster.forces[0]?.uid === forceUid;
  const side =
    allegianceOf(roster, contexts, first ? forceUid : (roster.forces[0]?.uid ?? '')) ?? loreAllegiance(armyName);
  const newArmy = catalogueId !== force.catalogueId;
  let removed = 0;
  if (newArmy) {
    const fromRoots = rootOptionsCached(from);
    const toRoots = forceRootOptions(to, entry);
    const cats = new Set(entry.categoryLinks.map((c) => c.targetId));
    const kept: Sel[] = [];
    for (const sel of force.selections) {
      const was = from.findOption(null, sel.key, fromRoots);
      if (!was || !isUnitLike(was)) continue;
      const same = toRoots.filter((o) => o.node.id === was.node.id);
      const now = same.find((o) => o.node.categoryLinks.some((c) => c.targetId === sel.categoryId)) ?? same[0];
      if (sel.saved || !now || !optionsHold(to, now.node, sel.children)) {
        removed++;
        continue;
      }
      const primary = (now.node.categoryLinks.find((c) => c.primary) ?? now.node.categoryLinks[0])?.targetId;
      kept.push({
        ...sel,
        key: now.key,
        categoryId: sel.categoryId && (!cats.size || cats.has(sel.categoryId)) ? sel.categoryId : primary,
      });
    }
    force.selections = kept;
    force.catalogueId = catalogueId;
  }
  force.forceEntryId = forceEntryId;
  addMandatoryRoots(roster, contexts, forceUid);
  setAllegiance(roster, contexts, forceUid, side);
  // a new army's set-up starts fresh; a new type keeps the switches the player set
  if (newArmy) switchesOn(roster, contexts, forceUid);
  return removed;
}
