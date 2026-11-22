import { describe, expect, it } from 'vitest';
import { FORCE, children, entry, unit, world } from '../test/fixture';
import { requirements, tacticsFor } from './tactics';

const tactic = (id: string, name: string, requires = '') =>
  `<profile id="${id}" name="${name}" typeName="Tactic"><characteristics><characteristic name="CP">1</characteristic>` +
  (requires ? `<characteristic name="Requires">${requires}</characteristic>` : '') +
  `</characteristics></profile>`;

// Kill Team 2018 shapes: a specialism picked beneath a model, and a named commander
const DOMINUS = unit('dominus', 'Tech-priest Dominus', 60);
const VANGUARD = unit('vanguard', 'Skitarii Vanguard', 10, children(entry('combat', 'Combat', 0)));
const gst =
  FORCE +
  `<sharedProfiles>${tactic('t1', 'Command Re-roll')}${tactic('t2', 'Combat Specialist', 'Combat')}${tactic('t3', 'Overlord Protocol', 'Tech-priest Dominus or Archmagos')}${tactic('t4', 'Nothing Here', '-')}</sharedProfiles>`;

const available = (w: ReturnType<typeof world>) =>
  tacticsFor(w.ev().forces[0]).flatMap((g) => g.tactics.filter((t) => t.available).map((t) => t.profile.name));

describe('requirements', () => {
  it('reads names separated by commas or "or", ignoring a dash for none', () => {
    const [p] = world('', { gst }).gst.sharedProfiles.filter((x) => x.name === 'Overlord Protocol');
    expect(requirements(p)).toEqual(['tech-priest dominus', 'archmagos']);
    const [none] = world('', { gst }).gst.sharedProfiles.filter((x) => x.name === 'Nothing Here');
    expect(requirements(none)).toEqual([]);
  });
});

describe('tacticsFor', () => {
  it('makes a tactic with no requirement available to any list', () => {
    expect(available(world(DOMINUS + VANGUARD, { gst }))).toEqual(['Command Re-roll', 'Nothing Here']);
  });
  it('makes a specialist tactic available once a model in the force has that specialism picked', () => {
    const w = world(DOMINUS + VANGUARD, { gst });
    w.pick(w.add('Skitarii Vanguard'), 'Combat');
    expect(available(w)).toContain('Combat Specialist');
    expect(available(w)).not.toContain('Overlord Protocol');
  });
  it('makes a commander tactic available once the force has that commander, by any of its names', () => {
    const w = world(DOMINUS + VANGUARD, { gst });
    w.add('Tech-priest Dominus');
    expect(available(w)).toContain('Overlord Protocol');
  });
});
