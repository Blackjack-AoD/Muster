// Which of an army's tactics a force can use. A tactic's optional "Requires" characteristic names what the force must
// hold for it: a unit or model ("Tech-priest Dominus"), a selection such as a specialism ("Combat"), or a category
// ("Commander"). Several can be given, separated by commas or "or". A tactic with no requirement is always available.
import type { RForce, RSel } from './engine';
import type { Profile } from './model';

export interface ForceTactic {
  profile: Profile;
  available: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The names a tactic's requirement can match, from every selection in the force at any depth. */
export function namesIn(rf: RForce): Set<string> {
  const names = new Set<string>();
  const walk = (rs: RSel) => {
    names.add(norm(rs.node.name));
    names.add(norm(rs.eff.name));
    if (rs.sel.name) names.add(norm(rs.sel.name));
    for (const c of rs.eff.categories) names.add(norm(rf.ctx.categoryName(c)));
    if (rs.eff.primary) names.add(norm(rf.ctx.categoryName(rs.eff.primary)));
    rs.children.forEach(walk);
  };
  rf.roots.forEach(walk);
  names.delete('');
  return names;
}

/** What a tactic requires, as lower-case names; empty when it needs nothing. */
export function requirements(p: Profile): string[] {
  const v = p.characteristics.find((c) => /^requires?$/i.test(c.name.trim()))?.value ?? '';
  return v
    .split(/\s*(?:,|;|\bor\b)\s*/i)
    .map(norm)
    .filter((x) => x && x !== '-');
}

/** The force's tactics by source (game system first), each marked available or not. */
export function tacticsFor(rf: RForce): { source: string; tactics: ForceTactic[] }[] {
  const have = namesIn(rf);
  return rf.ctx.tactics().map((g) => ({
    source: g.source,
    tactics: g.profiles.map((profile) => {
      const need = requirements(profile);
      return { profile, available: !need.length || need.some((n) => have.has(n)) };
    }),
  }));
}
