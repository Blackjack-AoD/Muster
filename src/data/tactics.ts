// Which of an army's tactics a force can use. A tactic's optional "Requires" characteristic names what the force must
// hold for it: a unit or model ("Tech-priest Dominus"), a selection such as a specialism ("Combat"), or a category
// ("Commander"). Several can be given, separated by commas or "or"; any one of them will do. Names joined by "+" must
// all be found on the same selection or beneath it, so "Combat + Level 2" needs a Combat specialism that has a pick
// from its Level 2 group. A group a selection was picked from counts as one of its names. A tactic with no requirement
// is always available.
import type { RForce, RSel } from './engine';
import type { Profile } from './model';

export interface ForceTactic {
  profile: Profile;
  available: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** A selection's own names: its entry, any custom name, its categories and the groups it was picked from. */
function ownNames(rf: RForce, rs: RSel): string[] {
  const out = [rs.node.name, rs.eff.name, rs.sel.name ?? ''];
  for (const c of rs.eff.categories) out.push(rf.ctx.categoryName(c));
  if (rs.eff.primary) out.push(rf.ctx.categoryName(rs.eff.primary));
  for (const g of rs.opt.groupIds) out.push(rf.ctx.get(g)?.name ?? '');
  return out.map(norm).filter(Boolean);
}

/** The names found on each selection or beneath it, for every selection in the force. */
function subtreeNames(rf: RForce): Set<string>[] {
  const all: Set<string>[] = [];
  const walk = (rs: RSel): Set<string> => {
    const names = new Set(ownNames(rf, rs));
    for (const c of rs.children) for (const n of walk(c)) names.add(n);
    all.push(names);
    return names;
  };
  rf.roots.forEach(walk);
  return all;
}

/** The names a tactic's requirement can match, from every selection in the force at any depth. */
export function namesIn(rf: RForce): Set<string> {
  const names = new Set<string>();
  for (const s of subtreeNames(rf)) for (const n of s) names.add(n);
  return names;
}

/** What a tactic requires: alternatives, each a list of lower-case names needed together. Empty when it needs nothing. */
export function requirements(p: Profile): string[][] {
  const v = p.characteristics.find((c) => /^requires?$/i.test(c.name.trim()))?.value ?? '';
  return v
    .split(/\s*(?:,|;|\bor\b)\s*/i)
    .map((alt) =>
      alt
        .split('+')
        .map(norm)
        .filter((x) => x && x !== '-'),
    )
    .filter((alt) => alt.length);
}

/** The force's tactics by source (game system first), each marked available or not. */
export function tacticsFor(rf: RForce): { source: string; tactics: ForceTactic[] }[] {
  const subtrees = subtreeNames(rf);
  const met = (alt: string[]) => subtrees.some((s) => alt.every((n) => s.has(n)));
  return rf.ctx.tactics().map((g) => ({
    source: g.source,
    tactics: g.profiles.map((profile) => {
      const need = requirements(profile);
      return { profile, available: !need.length || need.some(met) };
    }),
  }));
}
