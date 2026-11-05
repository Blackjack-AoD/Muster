import { describe, expect, it } from 'vitest';
import type { Opt } from './catalog';
import {
  addMandatoryRoots,
  applyLoreAllegiance,
  loreAllegiance,
  onOffPair,
  pick,
  setUpForce,
  switchesOn,
} from './setup';
import { children, entry, present, unit, world } from '../test/fixture';

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
    const rs = present(ev.find(p), 'the selection');
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
