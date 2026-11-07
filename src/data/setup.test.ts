import { describe, expect, it } from 'vitest';
import type { Opt } from './catalog';
import { Context } from './catalog';
import { Evaluator, addSel, forceRootOptions, type Roster } from './engine';
import {
  addMandatoryRoots,
  allegianceOf,
  applyLoreAllegiance,
  changeForce,
  isAllegianceChoice,
  loreAllegiance,
  matchAllegiance,
  onOffPair,
  pick,
  setUpForce,
  switchesOn,
} from './setup';
import { TWO_FORCES, catalogue, children, entry, gameSystem, selIn, unit, world } from '../test/fixture';

const min1 = (scope: string) =>
  `<constraints><constraint id="c" type="min" value="1" field="selections" scope="${scope}"/></constraints>`;
const group = (id: string, name: string, inner: string) =>
  `<selectionEntryGroups><selectionEntryGroup id="${id}" name="${name}">${inner}</selectionEntryGroup></selectionEntryGroups>`;
const setupEntry = (id: string, name: string, inner: string) => entry(id, name, 0, inner);
const rootNames = (w: ReturnType<typeof world>) => w.ev().forces[0].roots.map((r) => r.eff.name);
const opt = (name: string, kind: Opt['kind'] = 'entry') => ({ kind, node: { name } }) as unknown as Opt;

describe('onOffPair', () => {
  it('recognises an On/Off pair in either order', () => {
    const [on, off] = [opt('Legacy Units On'), opt('Legacy Units Off ')];
    expect(onOffPair([off, on])).toEqual({ on, off });
  });
  it('rejects anything else', () => {
    expect(onOffPair([opt('A On'), opt('B')])).toBeNull();
    expect(onOffPair([opt('A On')])).toBeNull();
    expect(onOffPair([opt('A On'), opt('A On'), opt('A Off')])).toBeNull();
    expect(onOffPair([opt('A On', 'group'), opt('A Off')])).toBeNull();
    expect(onOffPair([opt('Salon'), opt('Takeoff')])).toBeNull();
  });
});

describe('loreAllegiance', () => {
  it.each([
    ['Sons of Horus', 'Traitor'],
    ['Legiones Astartes: Iron Warriors', 'Traitor'],
    ["Emperor's Children", 'Traitor'],
    ['Emperor’s Children', 'Traitor'],
    ['Daemons of the Ruinstorm', 'Traitor'],
    ['Ultramarines', 'Loyalist'],
    ['Imperial Fists', 'Loyalist'],
    ['Solar Auxilia', 'Loyalist'],
  ])('%s is %s', (army, side) => expect(loreAllegiance(army)).toBe(side));
});

describe('addMandatoryRoots', () => {
  it('adds a mandatory set-up entry once, but never a unit', () => {
    const w = world(setupEntry('leg', 'Legion', min1('force')) + unit('u', 'Squad', 0, min1('force')));
    expect(addMandatoryRoots(w.roster, w.contexts, 'f1')).toBe(1);
    expect(rootNames(w)).toEqual(['Legion']);
  });
  it('adds a mandatory entry with no category to a force that has categories', () => {
    const mandatory =
      '<constraints><constraint id="c" type="min" value="1" field="selections" scope="force"/></constraints>';
    const w = world(setupEntry('leg', 'Chapter Tactics', mandatory), {
      gst: `<categoryEntries><categoryEntry id="hq" name="HQ"/></categoryEntries>
        <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks>
          <categoryLink id="l-hq" name="HQ" targetId="hq"/>
        </categoryLinks></forceEntry></forceEntries>`,
    });
    expect(addMandatoryRoots(w.roster, w.contexts, 'f1')).toBe(1);
    expect(rootNames(w)).toEqual(['Chapter Tactics']);
  });
  it('leaves optional entries, hidden ones, and ones already there', () => {
    const w = world(
      setupEntry('a', 'Optional', '') +
        entry('b', 'Hidden', 0, min1('force'), 'type="upgrade" hidden="true"') +
        setupEntry('c', 'Done', min1('force')),
    );
    w.add('Done');
    expect(addMandatoryRoots(w.roster, w.contexts, 'f1')).toBe(0);
    expect(rootNames(w)).toEqual(['Done']);
  });
  it('adds a roster-wide entry to one force only', () => {
    const w = world(setupEntry('b', 'Battle Size', min1('roster')));
    expect(addMandatoryRoots(w.roster, w.contexts, 'f1')).toBe(1);
    w.addForce();
    expect(addMandatoryRoots(w.roster, w.contexts, 'f2')).toBe(0);
  });
  it('re-checks, because one set-up entry can make another mandatory', () => {
    const second = entry(
      'b',
      'Second',
      0,
      `<constraints><constraint id="c2" type="min" value="0" field="selections" scope="force"/></constraints><modifiers><modifier type="set" field="c2" value="1"><conditions><condition type="atLeast" value="1" field="selections" scope="force" childId="a"/></conditions></modifier></modifiers>`,
    );
    const w = world(setupEntry('a', 'First', min1('force')) + second);
    expect(addMandatoryRoots(w.roster, w.contexts, 'f1')).toBe(2);
  });
  it('does nothing for a force that is not there', () => {
    const w = world(setupEntry('a', 'First', min1('force')));
    expect(addMandatoryRoots(w.roster, w.contexts, 'nope')).toBe(0);
  });
});

describe('applyLoreAllegiance', () => {
  const allegiance = setupEntry(
    'al',
    'Allegiance',
    group('g', 'Side', children(entry('l', 'Loyalist'), entry('t', ' Traitor '))) + children(entry('x', 'Other')),
  );
  it('picks the side from the lore', () => {
    const w = world(allegiance);
    const a = w.add('Allegiance');
    applyLoreAllegiance(w.roster, w.contexts, 'f1', 'Sons of Horus');
    expect(w.sel(a).children.map((c) => c.eff.name.trim())).toEqual(['Traitor']);
  });
  it('picks Loyalist for a loyalist army', () => {
    const w = world(allegiance);
    const a = w.add('Allegiance');
    applyLoreAllegiance(w.roster, w.contexts, 'f1', 'Ultramarines');
    expect(w.sel(a).children.map((c) => c.eff.name.trim())).toEqual(['Loyalist']);
  });
  it('ignores a group with Traitor and no Loyalist', () => {
    const w = world(
      setupEntry('al', 'Other', group('g', 'Side', children(entry('z', 'Neutral'), entry('t', 'Traitor')))),
    );
    const a = w.add('Other');
    applyLoreAllegiance(w.roster, w.contexts, 'f1', 'Sons of Horus');
    expect(w.sel(a).children).toEqual([]);
  });
  it('ignores groups that are not an allegiance choice', () => {
    const w = world(
      setupEntry('al', 'Other', group('g', 'Side', children(entry('l', 'Loyalist'), entry('z', 'Neutral')))),
    );
    const a = w.add('Other');
    applyLoreAllegiance(w.roster, w.contexts, 'f1', 'Sons of Horus');
    expect(w.sel(a).children).toEqual([]);
  });
  it('does nothing for a force that is not there', () => {
    const w = world(allegiance);
    expect(() => applyLoreAllegiance(w.roster, w.contexts, 'nope', 'x')).not.toThrow();
  });
});

describe('switchesOn', () => {
  const panel = setupEntry(
    'p',
    'Expanded',
    group('g1', 'Legacy', children(entry('on', 'Legacy On'), entry('off', 'Legacy Off'))),
  );
  it('turns every switch on', () => {
    const w = world(panel);
    const p = w.add('Expanded');
    switchesOn(w.roster, w.contexts, 'f1');
    expect(w.sel(p).children.map((c) => c.eff.name)).toEqual(['Legacy On']);
  });
  it('replaces an Off with On', () => {
    const w = world(panel);
    const p = w.add('Expanded');
    w.pick(p, 'Legacy Off');
    switchesOn(w.roster, w.contexts, 'f1');
    expect(w.sel(p).children.map((c) => c.eff.name)).toEqual(['Legacy On']);
  });
  it('finds switches inside other groups', () => {
    const w = world(
      setupEntry(
        'p',
        'Expanded',
        group('o', 'Outer', group('g1', 'Legacy', children(entry('on', 'X On'), entry('off', 'X Off')))),
      ),
    );
    const p = w.add('Expanded');
    switchesOn(w.roster, w.contexts, 'f1');
    expect(w.sel(p).children.map((c) => c.eff.name)).toEqual(['X On']);
  });
  it('leaves units alone', () => {
    const w = world(unit('p', 'Squad', 0, group('g1', 'Legacy', children(entry('on', 'X On'), entry('off', 'X Off')))));
    const p = w.add('Squad');
    switchesOn(w.roster, w.contexts, 'f1');
    expect(w.sel(p).children).toEqual([]);
  });
  it('does nothing for a force that is not there', () => {
    const w = world(panel);
    expect(() => switchesOn(w.roster, w.contexts, 'nope')).not.toThrow();
  });
});

describe('pick', () => {
  const setup = () => {
    const w = world(setupEntry('p', 'Panel', group('g', 'Choice', children(entry('a', 'A'), entry('b', 'B')))));
    const p = w.add('Panel');
    const ev = w.ev();
    const rs = selIn(ev, p);
    const [g] = w.ctx.options(rs.node);
    return { w, p, rs, g };
  };
  it('swaps the pick within the group', () => {
    const { w, p, rs, g } = setup();
    pick(w.roster, w.contexts, rs, g, g.members[0]);
    pick(w.roster, w.contexts, rs, g, g.members[1]);
    expect(w.sel(p).children.map((c) => c.eff.name)).toEqual(['B']);
  });
  it('does nothing when the target is already picked', () => {
    const { w, p, rs, g } = setup();
    pick(w.roster, w.contexts, rs, g, g.members[0]);
    const uid = w.sel(p).children[0].sel.uid;
    pick(w.roster, w.contexts, rs, g, g.members[0]);
    expect(w.sel(p).children[0].sel.uid).toBe(uid);
  });
});

describe('setUpForce', () => {
  it('adds set-up, sets allegiance, and turns switches on', () => {
    const w = world(
      setupEntry(
        'al',
        'Allegiance',
        min1('force') + group('g', 'Side', children(entry('l', 'Loyalist'), entry('t', 'Traitor'))),
      ) +
        setupEntry(
          'p',
          'Expanded',
          min1('force') + group('g1', 'Legacy', children(entry('on', 'Legacy On'), entry('off', 'Legacy Off'))),
        ),
    );
    setUpForce(w.roster, w.contexts, 'f1', 'Night Lords');
    const picks = w.ev().forces[0].roots.flatMap((r) => r.children.map((c) => c.eff.name));
    expect(picks).toEqual(['Traitor', 'Legacy On']);
  });
});

const ALLEGIANCE = setupEntry(
  'al',
  'Allegiance',
  min1('force') + group('g', 'Side', children(entry('l', 'Loyalist'), entry('t', 'Traitor'))),
);
const sideIn = (w: { ev: ReturnType<typeof world>['ev'] }, force: number) =>
  w
    .ev()
    .forces[force].roots.filter((r) => r.eff.name === 'Allegiance')
    .flatMap((r) => r.children.map((c) => c.eff.name));

describe('allegiance across detachments', () => {
  const twoForces = () => {
    const w = world(ALLEGIANCE);
    w.addForce('f2');
    setUpForce(w.roster, w.contexts, 'f1', 'Ultramarines');
    setUpForce(w.roster, w.contexts, 'f2', 'Night Lords');
    return w;
  };
  it('reads the side a detachment picked', () => {
    const w = twoForces();
    expect(allegianceOf(w.roster, w.contexts, 'f1')).toBe('Loyalist');
    expect(allegianceOf(w.roster, w.contexts, 'f2')).toBe('Traitor');
  });
  it('has no side without an allegiance choice', () => {
    const w = world(unit('u', 'Squad'));
    expect(allegianceOf(w.roster, w.contexts, 'f1')).toBeUndefined();
  });
  it("gives every later detachment the first one's side", () => {
    const w = twoForces();
    matchAllegiance(w.roster, w.contexts);
    expect(sideIn(w, 0)).toEqual(['Loyalist']);
    expect(sideIn(w, 1)).toEqual(['Loyalist']);
  });
  it('knows a Loyalist / Traitor choice from any other', () => {
    const w = world(
      ALLEGIANCE + setupEntry('o', 'Other', group('g2', 'Mode', children(entry('a', 'A'), entry('b', 'B')))),
    );
    const members = (name: string) => {
      const rs = w.sel(w.add(name));
      const g = rs.force.ctx.options(rs.node)[0];
      return g.members;
    };
    expect(isAllegianceChoice(members('Allegiance'))).toBe(true);
    expect(isAllegianceChoice(members('Other'))).toBe(false);
  });
});

/** Two armies that both import a library's Tactical Squad, each through a link of its own. */
function twoArmies() {
  const gst = gameSystem(TWO_FORCES);
  const lib = catalogue(
    `<sharedSelectionEntries>${unit('tac', 'Tactical Squad', 100, children(entry('plasma', 'Plasma', 10)))}</sharedSelectionEntries>`,
    'lib',
    'library="true"',
  );
  const army = (id: string, own: string) =>
    new Context(
      gst,
      catalogue(
        `<catalogueLinks><catalogueLink id="${id}-lib" targetId="lib" type="catalogue" importRootEntries="true"/></catalogueLinks>
        <selectionEntries>${ALLEGIANCE}${own}</selectionEntries>
        <entryLinks><entryLink id="${id}-tac" name="Tactical Squad" targetId="tac" type="selectionEntry"/></entryLinks>`,
        id,
      ),
      [lib],
    );
  const contexts = new Map([
    ['a', army('a', unit('hero-a', 'Hero of A', 50))],
    ['b', army('b', unit('hero-b', 'Hero of B', 60))],
  ]);
  const roster: Roster = {
    uid: 'r',
    name: 'Test list',
    repo: 'test/repo',
    gameSystemId: gst.id,
    costLimit: 0,
    forces: [
      { uid: 'f1', forceEntryId: 'det', catalogueId: 'a', selections: [] },
      { uid: 'f2', forceEntryId: 'ally', catalogueId: 'a', selections: [] },
    ],
    created: 0,
    updated: 0,
  };
  const ctxA = contexts.get('a') as Context;
  const add = (forceUid: string, name: string) => {
    const fe = ctxA.forceEntries().find((f) => f.id === (forceUid === 'f1' ? 'det' : 'ally')) as NonNullable<
      ReturnType<Context['forceEntries']>[number]
    >;
    const o = forceRootOptions(ctxA, fe).find((x) => x.node.name === name);
    if (!o) throw new Error(`no root entry called ${name}`);
    return addSel(roster, contexts, forceUid, null, o, 1) as string;
  };
  setUpForce(roster, contexts, 'f1', 'Sons of Horus');
  setUpForce(roster, contexts, 'f2', 'Sons of Horus');
  const w = { roster, contexts, add, ev: () => new Evaluator(roster, contexts) };
  return w;
}
const unitNames = (w: ReturnType<typeof twoArmies>, force: number) =>
  w
    .ev()
    .forces[force].roots.filter((r) => r.node.type === 'unit')
    .map((r) => r.eff.name);

describe('changeForce', () => {
  it('changes the detachment type and keeps every unit, saved copies too', () => {
    const w = twoArmies();
    const tac = w.add('f2', 'Tactical Squad');
    w.add('f2', 'Hero of A');
    const loc = w.roster.forces[1].selections.find((s) => s.uid === tac);
    if (loc) loc.saved = 'saved-1';
    expect(changeForce(w.roster, w.contexts, 'f2', 'a', 'det', 'Sons of Horus')).toBe(0);
    expect(w.roster.forces[1].forceEntryId).toBe('det');
    expect(unitNames(w, 1)).toEqual(['Tactical Squad', 'Hero of A']);
  });
  it('keeps the side the first detachment chose when its type changes', () => {
    const w = twoArmies();
    setAllegianceTo(w, 'f1', 'Loyalist');
    changeForce(w.roster, w.contexts, 'f1', 'a', 'ally', 'Sons of Horus');
    expect(w.roster.forces[0].forceEntryId).toBe('ally');
    expect(sideIn(w, 0)).toEqual(['Loyalist']);
  });
  it('leaves a switch the player turned Off alone when only the type changes', () => {
    const w = world(
      setupEntry(
        'p',
        'Expanded',
        min1('force') + group('g1', 'Legacy', children(entry('on', 'Legacy On'), entry('off', 'Legacy Off'))),
      ),
      { gst: TWO_FORCES },
    );
    setUpForce(w.roster, w.contexts, 'f1', 'Ultramarines');
    const rs = w.ev().forces[0].roots[0];
    const g = rs.force.ctx.options(rs.node)[0];
    pick(w.roster, w.contexts, rs, g, g.members[1]);
    changeForce(w.roster, w.contexts, 'f1', 'cat', 'ally', 'Ultramarines');
    expect(w.roster.forces[0].forceEntryId).toBe('ally');
    expect(w.ev().forces[0].roots[0].children.map((c) => c.eff.name)).toEqual(['Legacy Off']);
  });
  it('moves to another army, keeping plain units that army also has, with their options', () => {
    const w = twoArmies();
    const tac = w.add('f2', 'Tactical Squad');
    w.ev();
    addSel(w.roster, w.contexts, 'f2', tac, optionBeneath(w, tac, 'Plasma'), 1);
    w.add('f2', 'Hero of A');
    expect(changeForce(w.roster, w.contexts, 'f2', 'b', 'ally', 'Death Guard')).toBe(1);
    const f = w.ev().forces[1];
    expect(f.force.catalogueId).toBe('b');
    expect(unitNames(w, 1)).toEqual(['Tactical Squad']);
    const kept = f.roots.find((r) => r.eff.name === 'Tactical Squad');
    expect(kept?.sel.key).toBe('b-tac');
    expect(kept?.children.map((c) => c.eff.name)).toEqual(['Plasma']);
    expect(kept?.total).toBe(110);
  });
  it('takes out saved and unique copies, and units with an option the data no longer has', () => {
    const w = twoArmies();
    const copy = w.add('f2', 'Tactical Squad');
    const odd = w.add('f2', 'Tactical Squad');
    const sels = w.roster.forces[1].selections;
    const at = (u: string) => sels.find((s) => s.uid === u);
    const c = at(copy);
    if (c) c.saved = 'saved-1';
    at(odd)?.children.push({ uid: 'gone', key: 'not-in-the-data', number: 1, children: [] });
    expect(changeForce(w.roster, w.contexts, 'f2', 'b', 'ally', 'Death Guard')).toBe(2);
    expect(unitNames(w, 1)).toEqual([]);
  });
  it("sets the new army up, on the first detachment's side", () => {
    const w = twoArmies();
    setAllegianceTo(w, 'f1', 'Loyalist');
    changeForce(w.roster, w.contexts, 'f2', 'b', 'ally', 'Death Guard');
    expect(sideIn(w, 1)).toEqual(['Loyalist']);
  });
  it('sets the first detachment up on its own side when its army changes', () => {
    const w = twoArmies();
    changeForce(w.roster, w.contexts, 'f1', 'b', 'det', 'Ultramarines');
    expect(w.roster.forces[0].catalogueId).toBe('b');
    expect(sideIn(w, 0)).toEqual(['Traitor']);
  });
  it('does nothing for a force or army that is not there', () => {
    const w = twoArmies();
    expect(changeForce(w.roster, w.contexts, 'nope', 'b', 'ally', 'x')).toBe(0);
    expect(changeForce(w.roster, w.contexts, 'f2', 'nope', 'ally', 'x')).toBe(0);
    expect(w.roster.forces[1].catalogueId).toBe('a');
  });
});

function optionBeneath(w: ReturnType<typeof twoArmies>, selUid: string, name: string) {
  const rs = w.ev().find(selUid);
  const o = rs && rs.force.ctx.options(rs.node).find((x) => x.node.name === name);
  if (!o) throw new Error(`no option called ${name}`);
  return o;
}
function setAllegianceTo(w: ReturnType<typeof twoArmies>, forceUid: string, side: 'Loyalist' | 'Traitor') {
  const rf = w.ev().forces.find((f) => f.force.uid === forceUid);
  const rs = rf?.roots.find((r) => r.eff.name === 'Allegiance');
  const g = rs && rs.force.ctx.options(rs.node)[0];
  const target = g?.members.find((m) => m.node.name === side);
  if (!rs || !g || !target) throw new Error('no allegiance choice');
  pick(w.roster, w.contexts, rs, g, target);
}
