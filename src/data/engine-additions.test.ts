import { describe, expect, it } from 'vitest';
import { unavailableHere } from './engine';
import { FORCE, children, entry, unit, world } from '../test/fixture';

const mods = (...m: string[]) => `<modifiers>${m.join('')}</modifiers>`;
const cons = (...c: string[]) => `<constraints>${c.join('')}</constraints>`;
const rules = (...names: string[]) =>
  `<rules>${names.map((n) => `<rule id="r-${n}" name="${n}"><description>Text</description></rule>`).join('')}</rules>`;

const selection = (w: ReturnType<typeof world>, uid: string) => {
  const rs = w.ev().find(uid);
  if (!rs) throw new Error(`no selection ${uid}`);
  return rs;
};

describe('armyRules', () => {
  it('lists the rules on set-up entries once each by name', () => {
    const w = world(
      entry('l', 'Legion', 0, rules('Legiones Astartes')) +
        entry('r', 'Rite', 0, rules('Legiones Astartes', 'Rite Rule')),
    );
    w.add('Legion');
    w.add('Rite');
    const ev = w.ev();
    expect(ev.armyRules(ev.forces[0]).map((r) => r.name)).toEqual(['Legiones Astartes', 'Rite Rule']);
  });

  it('skips the rules on units and models', () => {
    const w = world(
      entry('l', 'Legion', 0, rules('Army Rule')) +
        unit('u', 'Squad', 0, rules('Squad Rule')) +
        entry('m', 'Hero', 0, rules('Hero Rule'), 'type="model"'),
    );
    w.add('Squad');
    w.add('Hero');
    w.add('Legion');
    const ev = w.ev();
    expect(ev.armyRules(ev.forces[0]).map((r) => r.name)).toEqual(['Army Rule']);
  });

  it('reads only the detachment it is given', () => {
    const w = world(entry('l', 'Legion', 0, rules('Army Rule')));
    w.add('Legion', 1, w.addForce());
    const ev = w.ev();
    expect(ev.armyRules(ev.forces[0])).toEqual([]);
    expect(ev.armyRules(ev.forces[1]).map((r) => r.name)).toEqual(['Army Rule']);
  });
});

describe('unavailableHere', () => {
  const effOf = (inner: string) => {
    const w = world(entry('x', 'Option', 0, inner));
    const ev = w.ev();
    return ev.optionEff(w.root('Option'), null, ev.forces[0]);
  };

  it('is true for a max of 0 scoped to parent', () => {
    expect(
      unavailableHere(effOf(cons('<constraint id="c" type="max" value="0" field="selections" scope="parent"/>'))),
    ).toBe(true);
  });

  it('finds that max beside other constraints', () => {
    const inner = cons(
      '<constraint id="a" type="max" value="3" field="selections" scope="roster"/>',
      '<constraint id="b" type="max" value="0" field="selections" scope="parent"/>',
    );
    expect(unavailableHere(effOf(inner))).toBe(true);
  });

  it('reads the max after modifiers', () => {
    const inner =
      cons('<constraint id="c" type="max" value="1" field="selections" scope="parent"/>') +
      mods('<modifier type="decrement" field="c" value="1"/>');
    expect(unavailableHere(effOf(inner))).toBe(true);
  });

  it.each([
    ['a force-wide max of 0', '<constraint id="c" type="max" value="0" field="selections" scope="force"/>'],
    ['a list-wide max of 0', '<constraint id="c" type="max" value="0" field="selections" scope="roster"/>'],
    ['a max of 0 scoped to self', '<constraint id="c" type="max" value="0" field="selections" scope="self"/>'],
    ['a max of 1', '<constraint id="c" type="max" value="1" field="selections" scope="parent"/>'],
    ['a min of 0', '<constraint id="c" type="min" value="0" field="selections" scope="parent"/>'],
    ['a max of 0 points', '<constraint id="c" type="max" value="0" field="pts" scope="parent"/>'],
  ])('is false for %s', (_, constraint) => {
    expect(unavailableHere(effOf(cons(constraint)))).toBe(false);
  });

  it('is false with no constraints', () => {
    expect(unavailableHere(effOf(''))).toBe(false);
  });
});

describe('issues', () => {
  const link = (id: string, target: string) =>
    `<entryLinks><entryLink id="${id}" name="${target}" targetId="${target}" type="selectionEntry"/></entryLinks>`;
  const relic = entry(
    'Relic',
    'Relic',
    0,
    cons('<constraint id="c" type="max" value="1" field="selections" scope="roster"/>'),
  );

  it('says a list-wide limit once when several units break it', () => {
    const w = world(unit('a', 'Squad', 0, link('la', 'Relic')) + unit('b', 'Hero', 0, link('lb', 'Relic')), {
      cat: `<sharedSelectionEntries>${relic}</sharedSelectionEntries>`,
    });
    w.pick(w.add('Squad'), 'Relic');
    w.pick(w.add('Hero'), 'Relic');
    expect(w.errors()).toEqual(['Relic: at most 1 allowed in the list (has 2)']);
  });

  it('says a list-wide limit on a unit once across detachments', () => {
    const w = world(
      unit('u', 'Hero', 0, cons('<constraint id="c" type="max" value="1" field="selections" scope="roster"/>')),
    );
    w.add('Hero');
    w.add('Hero', 1, w.addForce());
    expect(w.errors()).toEqual(['Hero: at most 1 allowed in the list (has 2)']);
  });

  it('keeps one issue for each limit that is broken', () => {
    const cap = cons('<constraint id="c" type="max" value="0" field="selections" scope="roster"/>');
    const w = world(unit('a', 'Squad', 0, children(entry('r', 'Relic', 0, cap), entry('b', 'Banner', 0, cap))));
    const u = w.add('Squad');
    w.pick(u, 'Relic');
    w.pick(u, 'Banner');
    expect(w.errors()).toEqual([
      'Relic: at most 0 allowed in the list (has 1)',
      'Banner: at most 0 allowed in the list (has 1)',
    ]);
  });
});

describe('rules inherited from a category', () => {
  const gst =
    FORCE +
    `<categoryEntries>
      <categoryEntry id="char" name="Character">
        <rules><rule id="r-ic" name="Independent Character"><description>Own text</description></rule></rules>
        <infoLinks><infoLink id="il" name="Bodyguard" targetId="sr" type="rule"/></infoLinks>
      </categoryEntry>
      <categoryEntry id="veh" name="Vehicle">
        <rules><rule id="r-v" name="Armoured"><description>Text</description></rule></rules>
      </categoryEntry>
    </categoryEntries>
    <sharedRules><rule id="sr" name="Shared Rule"><description>Shared text</description></rule></sharedRules>`;
  const inChar =
    '<categoryLinks><categoryLink id="cl" name="Character" targetId="char" primary="true"/></categoryLinks>';
  const rulesOf = (inner: string) => {
    const w = world(unit('u', 'Praetor', 0, inner), { gst });
    return w.ev().rulesFor(selection(w, w.add('Praetor')));
  };

  it('includes the rules on a category the unit belongs to', () => {
    const r = rulesOf(inChar).find((x) => x.name === 'Independent Character');
    expect(r?.description).toBe('Own text');
  });

  it('includes the rule links on that category, using the link name', () => {
    const r = rulesOf(inChar).find((x) => x.name === 'Bodyguard');
    expect(r?.description).toBe('Shared text');
  });

  it('leaves out categories the unit does not belong to', () => {
    expect(rulesOf('')).toEqual([]);
    expect(rulesOf(inChar).map((x) => x.name)).not.toContain('Armoured');
  });

  it('includes a category that a modifier adds', () => {
    const names = rulesOf(mods('<modifier type="add" field="category" value="veh"/>')).map((x) => x.name);
    expect(names).toEqual(['Armoured']);
  });
});

describe('fillDefaults at a cap of 0', () => {
  const namesUnder = (w: ReturnType<typeof world>, uid: string) => selection(w, uid).children.map((c) => c.eff.name);

  const listCap = '<constraint id="cap" type="max" value="0" field="selections" scope="roster"/>';
  /** As Horus Heresy writes it: no Master of the Legion allowed, plus one for each full 1,000 points in the list. */
  const onePer1000 = entry(
    'mol',
    'Master of the Legion',
    0,
    mods(
      '<modifier type="increment" field="mol-cap" value="1"><repeats><repeat field="pts" scope="roster" value="1000" repeats="1" childId="any" roundUp="false"/></repeats></modifier>',
    ) +
      cons(
        '<constraint id="mol-cap" type="max" value="0" field="selections" scope="roster" includeChildSelections="true"/>',
      ),
  );
  const praetorWorld = () =>
    world(
      unit(
        'p',
        'Praetor',
        120,
        '<entryLinks><entryLink id="l" name="Master of the Legion" targetId="mol" type="selectionEntry"><constraints><constraint id="l-max" type="max" value="1" field="selections" scope="parent"/><constraint id="l-min" type="min" value="1" field="selections" scope="parent"/></constraints></entryLink></entryLinks>',
      ) + unit('t', 'Tactical Squad', 880),
      { cat: `<sharedSelectionEntries>${onePer1000}</sharedSelectionEntries>` },
    );
  const group = (inner: string, attrs = '') =>
    `<selectionEntryGroups><selectionEntryGroup id="grp" name="Weapons" ${attrs}>${inner}</selectionEntryGroup></selectionEntryGroups>`;
  const required = '<constraint id="g-min" type="min" value="1" field="selections" scope="parent"/>';

  it("adds a Praetor's Master of the Legion under 1,000 points, and the cap shows as an issue", () => {
    const w = praetorWorld();
    const p = w.add('Praetor');
    expect(namesUnder(w, p)).toEqual(['Master of the Legion']);
    expect(w.errors()).toEqual(['Master of the Legion: at most 0 allowed in the list (has 1)']);
  });

  it('drops that issue once the list reaches 1,000 points', () => {
    const w = praetorWorld();
    w.add('Praetor');
    w.add('Tactical Squad');
    expect(w.errors()).toEqual([]);
  });

  it('does not add a mandatory entry whose own max is 0', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        children(
          entry(
            'g',
            'Gun',
            0,
            cons(
              '<constraint id="a" type="min" value="1" field="selections" scope="parent"/>',
              '<constraint id="b" type="max" value="0" field="selections" scope="parent"/>',
            ),
          ),
        ),
      ),
    );
    expect(namesUnder(w, w.add('Squad'))).toEqual([]);
  });

  it('skips an optional entry at a list-wide cap of 0', () => {
    const w = world(unit('u', 'Squad', 0, children(entry('r', 'Relic', 0, cons(listCap)))));
    expect(namesUnder(w, w.add('Squad'))).toEqual([]);
    expect(w.errors()).toEqual([]);
  });

  it('picks another member of a required group when its default is at a list-wide cap of 0', () => {
    const members = children(entry('r', 'Relic', 0, cons(listCap)), entry('s', 'Sword', 5));
    const w = world(unit('u', 'Squad', 0, group(cons(required) + members, 'defaultSelectionEntryId="r"')));
    expect(namesUnder(w, w.add('Squad'))).toEqual(['Sword']);
  });

  it('skips a required group at a list-wide cap of 0', () => {
    const w = world(unit('u', 'Squad', 0, group(cons(required, listCap) + children(entry('s', 'Sword', 5)))));
    expect(namesUnder(w, w.add('Squad'))).toEqual([]);
  });
});
