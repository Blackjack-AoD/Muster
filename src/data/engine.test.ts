import { describe, expect, it } from 'vitest';
import {
  Evaluator,
  addSel,
  defaultMember,
  fmt,
  forceRootOptions,
  locate,
  removeSel,
  unavailable,
  type Eff,
  type Issue,
} from './engine';
import type { Opt } from './catalog';
import { addedUid, children, entry, unit, world } from '../test/fixture';

const mods = (...m: string[]) => `<modifiers>${m.join('')}</modifiers>`;
const cons = (...c: string[]) => `<constraints>${c.join('')}</constraints>`;
const conds = (...c: string[]) => `<conditions>${c.join('')}</conditions>`;
const min = (n: number) => `<constraint id="c-min" type="min" value="${n}" field="selections" scope="parent"/>`;
const max = (n: number) => `<constraint id="c-max" type="max" value="${n}" field="selections" scope="parent"/>`;

describe('points', () => {
  it('adds up a unit and its children', () => {
    const w = world(unit('u', 'Squad', 50, children(entry('g', 'Gun', 5))));
    const u = w.add('Squad');
    w.pick(u, 'Gun');
    expect(w.pts(u)).toBe(55);
  });

  it('multiplies by the selection number, with children counted per model', () => {
    const w = world(unit('u', 'Squad', 10, children(entry('m', 'Model', 20, children(entry('g', 'Gun', 3))))));
    const u = w.add('Squad', 2);
    const m = w.pick(u, 'Model', 5);
    w.pick(m, 'Gun', 2);
    // 2 squads × (10 + 5 models × (20 + 2 guns × 3))
    expect(w.pts(u)).toBe(2 * (10 + 5 * (20 + 2 * 3)));
  });

  it('totals units across forces', () => {
    const w = world(unit('u', 'Squad', 40));
    w.add('Squad');
    w.add('Squad', 1, w.addForce());
    const ev = w.ev();
    expect(ev.forces.map((f) => f.total)).toEqual([40, 40]);
    expect(ev.total).toBe(80);
  });

  it('only counts the points cost type, not others such as power level', () => {
    const inner = '<costs><cost name="pts" typeId="pts" value="10"/><cost name="PL" typeId="pl" value="99"/></costs>';
    const w = world(`<selectionEntry id="u" name="Squad" type="unit">${inner}</selectionEntry>`);
    expect(w.pts(w.add('Squad'))).toBe(10);
  });
});

describe('modifiers', () => {
  const cost = (m: string, conditions = '') => unit('u', 'Squad', 100, mods(m) + conditions);

  it('sets a cost', () => {
    const w = world(cost('<modifier type="set" field="pts" value="7"/>'));
    expect(w.pts(w.add('Squad'))).toBe(7);
  });
  it('increments a cost', () => {
    const w = world(cost('<modifier type="increment" field="pts" value="7"/>'));
    expect(w.pts(w.add('Squad'))).toBe(107);
  });
  it('decrements a cost', () => {
    const w = world(cost('<modifier type="decrement" field="pts" value="7"/>'));
    expect(w.pts(w.add('Squad'))).toBe(93);
  });
  it('multiplies a cost', () => {
    const w = world(cost('<modifier type="multiply" field="pts" value="3"/>'));
    expect(w.pts(w.add('Squad'))).toBe(300);
  });
  it('ignores a modifier value that is not a number', () => {
    const w = world(cost('<modifier type="increment" field="pts" value="lots"/>'));
    expect(w.pts(w.add('Squad'))).toBe(100);
  });
  it('can give a cost to an entry that had none of that type', () => {
    const w = world(
      '<selectionEntry id="u" name="Squad" type="unit"><modifiers><modifier type="increment" field="pts" value="5"/></modifiers></selectionEntry>',
    );
    expect(w.pts(w.add('Squad'))).toBe(5);
  });
  it('applies modifiers in file order', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        100,
        mods('<modifier type="set" field="pts" value="10"/>', '<modifier type="increment" field="pts" value="1"/>'),
      ),
    );
    expect(w.pts(w.add('Squad'))).toBe(11);
  });

  it('sets and appends a name', () => {
    const w = world(
      unit('a', 'Alpha', 0, mods('<modifier type="set" field="name" value="Omega"/>')) +
        unit('b', 'Beta', 0, mods('<modifier type="append" field="name" value="(Elite)"/>')),
    );
    const [a, b] = [w.add('Alpha'), w.add('Beta')];
    expect(w.ev().find(a)!.eff.name).toBe('Omega');
    expect(w.ev().find(b)!.eff.name).toBe('Beta (Elite)');
  });

  it('sets hidden', () => {
    const w = world(unit('u', 'Squad', 0, mods('<modifier type="set" field="hidden" value="true"/>')));
    const u = w.add('Squad');
    expect(w.ev().find(u)!.eff.hidden).toBe(true);
  });

  it('adds, removes, and changes the primary category', () => {
    const links =
      '<categoryLinks><categoryLink id="l1" targetId="troops" primary="true"/><categoryLink id="l2" targetId="elite" primary="false"/></categoryLinks>';
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        links +
          mods(
            '<modifier type="add" field="category" value="heavy"/>',
            '<modifier type="remove" field="category" value="elite"/>',
            '<modifier type="set-primary" field="category" value="hq"/>',
          ),
      ),
    );
    const u = w.add('Squad');
    const e = w.ev().find(u)!.eff;
    expect([...e.categories].sort()).toEqual(['heavy', 'hq', 'troops']);
    expect(e.primary).toBe('hq');
  });

  it('unset-primary clears only a matching primary category', () => {
    const links = '<categoryLinks><categoryLink id="l1" targetId="troops" primary="true"/></categoryLinks>';
    const w = world(
      unit('a', 'Alpha', 0, links + mods('<modifier type="unset-primary" field="category" value="troops"/>')) +
        unit('b', 'Beta', 0, links + mods('<modifier type="unset-primary" field="category" value="other"/>')),
    );
    const eff = (name: string) => {
      const opt = w.root(name);
      return w.ev().effective(opt.node, { self: null, parent: null, force: w.ev().forces[0], opt });
    };
    expect(eff('Alpha').primary).toBeUndefined();
    expect(eff('Beta').primary).toBe('troops');
  });

  it('changes a constraint value by its id', () => {
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
            cons('<constraint id="gun-max" type="max" value="1" field="selections" scope="parent"/>') +
              mods('<modifier type="increment" field="gun-max" value="2"/>'),
          ),
        ),
      ),
    );
    const u = w.add('Squad');
    const ev = w.ev();
    expect(ev.limits(w.beneath(u, 'Gun'), ev.find(u)!, ev.forces[0]).max).toBe(3);
  });

  it('skips a modifier whose field matches nothing', () => {
    const w = world(unit('u', 'Squad', 10, mods('<modifier type="increment" field="no-such-thing" value="5"/>')));
    expect(w.pts(w.add('Squad'))).toBe(10);
  });

  describe('repeats', () => {
    const squad = (repeat: string) =>
      unit(
        'u',
        'Squad',
        100,
        mods(`<modifier type="increment" field="pts" value="10"><repeats>${repeat}</repeats></modifier>`) +
          children(entry('m', 'Model', 0)),
      );
    const withModels = (repeat: string, n: number) => {
      const w = world(squad(repeat));
      const u = w.add('Squad');
      if (n) w.pick(u, 'Model', n);
      return w.pts(u);
    };

    it('applies once per full step', () => {
      const r =
        '<repeat value="2" repeats="1" field="selections" scope="self" childId="m" includeChildSelections="true"/>';
      expect([0, 1, 2, 3, 4].map((n) => withModels(r, n))).toEqual([100, 100, 110, 110, 120]);
    });
    it('rounds partial steps up when asked', () => {
      const r =
        '<repeat value="2" repeats="1" field="selections" scope="self" childId="m" includeChildSelections="true" roundUp="true"/>';
      expect([0, 1, 2, 3].map((n) => withModels(r, n))).toEqual([100, 110, 110, 120]);
    });
    it('applies several times per step', () => {
      const r = '<repeat value="1" repeats="3" field="selections" scope="self" childId="m"/>';
      expect(withModels(r, 2)).toBe(160);
    });
    it('does nothing with a step of zero', () => {
      const r = '<repeat value="0" repeats="1" field="selections" scope="self" childId="m"/>';
      expect(withModels(r, 5)).toBe(100);
    });
  });

  describe('modifier groups', () => {
    const inGroup = (group: string) =>
      world(unit('flag', 'Flag', 0) + unit('u', 'Squad', 100, `<modifierGroups>${group}</modifierGroups>`));
    const has = conds(
      '<condition type="atLeast" value="1" field="selections" scope="force" childId="flag" includeChildSelections="true"/>',
    );

    it("apply the group's conditions to every modifier inside", () => {
      const w = inGroup(
        `<modifierGroup>${has}${mods('<modifier type="increment" field="pts" value="1"/>', '<modifier type="increment" field="pts" value="2"/>')}</modifierGroup>`,
      );
      const u = w.add('Squad');
      expect(w.pts(u)).toBe(100);
      w.add('Flag');
      expect(w.pts(u)).toBe(103);
    });
    it('require both the group and the modifier conditions', () => {
      const never = conds(
        '<condition type="equalTo" value="9" field="selections" scope="force" childId="flag" includeChildSelections="true"/>',
      );
      const w = inGroup(
        `<modifierGroup>${has}<modifiers><modifier type="increment" field="pts" value="1">${never}</modifier></modifiers></modifierGroup>`,
      );
      const u = w.add('Squad');
      w.add('Flag');
      expect(w.pts(u)).toBe(100);
    });
    it('nest, inheriting repeats from the group', () => {
      const repeat =
        '<repeats><repeat value="1" repeats="1" field="selections" scope="force" childId="flag"/></repeats>';
      const w = inGroup(
        `<modifierGroup>${repeat}<modifierGroups><modifierGroup>${mods('<modifier type="increment" field="pts" value="10"/>')}</modifierGroup></modifierGroups></modifierGroup>`,
      );
      const u = w.add('Squad');
      w.add('Flag', 3);
      expect(w.pts(u)).toBe(130);
    });
  });
});

describe('conditions', () => {
  /** Squad costs 1 extra when the condition holds */
  const TWO_FORCES =
    '<forceEntries><forceEntry id="det" name="Detachment"/><forceEntry id="ally" name="Allies"/></forceEntries>';
  const guarded = (condition: string, others = unit('x', 'Other', 10)) =>
    unit(
      'u',
      'Squad',
      0,
      `<modifiers><modifier type="increment" field="pts" value="1">${conds(condition)}</modifier></modifiers>`,
    ) + others;
  const holds = (w: ReturnType<typeof world>, u: string) => w.pts(u) === 1;

  describe('comparisons against the number of selections', () => {
    const cases: [string, string, boolean[]][] = [
      [
        'lessThan',
        '<condition type="lessThan" value="1" field="selections" scope="force" childId="x"/>',
        [true, false, false],
      ],
      [
        'greaterThan',
        '<condition type="greaterThan" value="1" field="selections" scope="force" childId="x"/>',
        [false, false, true],
      ],
      [
        'equalTo',
        '<condition type="equalTo" value="1" field="selections" scope="force" childId="x"/>',
        [false, true, false],
      ],
      [
        'notEqualTo',
        '<condition type="notEqualTo" value="1" field="selections" scope="force" childId="x"/>',
        [true, false, true],
      ],
      [
        'atLeast',
        '<condition type="atLeast" value="1" field="selections" scope="force" childId="x"/>',
        [false, true, true],
      ],
      [
        'atMost',
        '<condition type="atMost" value="1" field="selections" scope="force" childId="x"/>',
        [true, true, false],
      ],
    ];
    it.each(cases)('%s', (_, condition, expected) => {
      const results = [0, 1, 2].map((n) => {
        const w = world(guarded(condition));
        const u = w.add('Squad');
        if (n) w.add('Other', n);
        return holds(w, u);
      });
      expect(results).toEqual(expected);
    });
    it('treats an unknown comparison as false', () => {
      const w = world(
        guarded('<condition type="approximately" value="0" field="selections" scope="force" childId="x"/>'),
      );
      expect(holds(w, w.add('Squad'))).toBe(false);
    });
  });

  describe('condition groups', () => {
    const group = (type: string) =>
      unit('a', 'A', 0) +
      unit('b', 'B', 0) +
      unit(
        'u',
        'Squad',
        0,
        `<modifiers><modifier type="increment" field="pts" value="1"><conditionGroups><conditionGroup type="${type}">${conds(
          '<condition type="atLeast" value="1" field="selections" scope="force" childId="a"/>',
          '<condition type="atLeast" value="1" field="selections" scope="force" childId="b"/>',
        )}</conditionGroup></conditionGroups></modifier></modifiers>`,
      );

    it('or needs any one', () => {
      const w = world(group('or'));
      const u = w.add('Squad');
      expect(holds(w, u)).toBe(false);
      w.add('A');
      expect(holds(w, u)).toBe(true);
    });
    it('and needs all', () => {
      const w = world(group('and'));
      const u = w.add('Squad');
      w.add('A');
      expect(holds(w, u)).toBe(false);
      w.add('B');
      expect(holds(w, u)).toBe(true);
    });
    it('nest', () => {
      const xml =
        unit('a', 'A', 0) +
        unit('b', 'B', 0) +
        unit('c', 'C', 0) +
        unit(
          'u',
          'Squad',
          0,
          `<modifiers><modifier type="increment" field="pts" value="1"><conditionGroups><conditionGroup type="and">${conds(
            '<condition type="atLeast" value="1" field="selections" scope="force" childId="a"/>',
          )}<conditionGroups><conditionGroup type="or">${conds(
            '<condition type="atLeast" value="1" field="selections" scope="force" childId="b"/>',
            '<condition type="atLeast" value="1" field="selections" scope="force" childId="c"/>',
          )}</conditionGroup></conditionGroups></conditionGroup></conditionGroups></modifier></modifiers>`,
        );
      const w = world(xml);
      const u = w.add('Squad');
      w.add('C');
      expect(holds(w, u)).toBe(false);
      w.add('A');
      expect(holds(w, u)).toBe(true);
    });
  });

  describe('what is counted', () => {
    /** a Squad holding a Model holding a Gun, with the guarded Marker unit alongside */
    const nested = (condition: string, where: 'root' | 'child' = 'root') => {
      const marker = entry(
        'marker',
        'Marker',
        0,
        `<modifiers><modifier type="increment" field="pts" value="1">${conds(condition)}</modifier></modifiers>`,
      );
      const model = entry('m', 'Model', 0, children(entry('g', 'Gun', 0)));
      return world(
        where === 'root'
          ? unit('squad', 'Squad', 0, children(model)) + marker.replace('type="upgrade"', 'type="unit"')
          : unit('squad', 'Squad', 0, children(model, marker)),
      );
    };
    const fill = (w: ReturnType<typeof world>) => {
      const s = w.add('Squad');
      w.pick(w.pick(s, 'Model', 2), 'Gun', 3);
      return s;
    };

    it('scope self looks at its own children', () => {
      const w = world(
        unit(
          'u',
          'Squad',
          0,
          children(entry('g', 'Gun', 0)) +
            mods(
              `<modifier type="increment" field="pts" value="1">${conds('<condition type="atLeast" value="1" field="selections" scope="self" childId="g"/>')}</modifier>`,
            ),
        ),
      );
      const u = w.add('Squad');
      expect(w.pts(u)).toBe(0);
      w.pick(u, 'Gun');
      expect(w.pts(u)).toBe(1);
    });
    it('scope parent looks at siblings', () => {
      const w = nested('<condition type="atLeast" value="1" field="selections" scope="parent" childId="m"/>', 'child');
      const s = w.add('Squad');
      const mark = w.pick(s, 'Marker');
      expect(w.pts(mark)).toBe(0);
      w.pick(s, 'Model');
      expect(w.pts(mark)).toBe(1);
    });
    it('scope parent at the root of a force looks at the force', () => {
      const w = world(guarded('<condition type="atLeast" value="1" field="selections" scope="parent" childId="x"/>'));
      const u = w.add('Squad');
      w.add('Other');
      expect(holds(w, u)).toBe(true);
    });
    it('a shallow count at force scope misses selections inside units', () => {
      const w = nested('<condition type="atLeast" value="1" field="selections" scope="force" childId="g"/>');
      const mark = w.add('Marker');
      fill(w);
      expect(w.pts(mark)).toBe(0);
    });
    it('a deep count multiplies through the selections above', () => {
      const w = nested(
        '<condition type="equalTo" value="6" field="selections" scope="force" childId="g" includeChildSelections="true"/>',
      );
      const mark = w.add('Marker');
      fill(w);
      expect(w.pts(mark)).toBe(1);
    });
    it('a deep count does not double count below a match', () => {
      const w = nested(
        '<condition type="equalTo" value="2" field="selections" scope="force" childId="any" includeChildSelections="true"/>',
      );
      const mark = w.add('Marker');
      expect(w.pts(mark)).toBe(0); // one selection so far, the Marker itself
      w.add('Marker');
      expect(w.pts(mark)).toBe(1);
    });
    it('scope roster looks across forces', () => {
      const w = world(guarded('<condition type="atLeast" value="1" field="selections" scope="roster" childId="x"/>'));
      const u = w.add('Squad');
      w.add('Other', 1, w.addForce());
      expect(holds(w, u)).toBe(true);
    });
    it('scope force does not look across forces', () => {
      const w = world(guarded('<condition type="atLeast" value="1" field="selections" scope="force" childId="x"/>'));
      const u = w.add('Squad');
      w.add('Other', 1, w.addForce());
      expect(holds(w, u)).toBe(false);
    });
    it('scope primary-catalogue looks across forces of this army', () => {
      const w = world(
        guarded('<condition type="atLeast" value="1" field="selections" scope="primary-catalogue" childId="x"/>'),
      );
      const u = w.add('Squad');
      w.add('Other', 1, w.addForce());
      expect(holds(w, u)).toBe(true);
    });
    it('scope primary-category looks at units sharing the primary category', () => {
      const troops = '<categoryLinks><categoryLink id="l" targetId="troops" primary="true"/></categoryLinks>';
      const hq = '<categoryLinks><categoryLink id="l" targetId="hq" primary="true"/></categoryLinks>';
      const w = world(
        unit(
          'u',
          'Squad',
          0,
          troops +
            mods(
              `<modifier type="increment" field="pts" value="1">${conds('<condition type="greaterThan" value="1" field="selections" scope="primary-category" childId="any"/>')}</modifier>`,
            ),
        ) +
          unit('x', 'Other', 0, troops) +
          unit('y', 'Boss', 0, hq),
      );
      const u = w.add('Squad');
      w.add('Boss');
      expect(w.pts(u)).toBe(0);
      w.add('Other');
      expect(w.pts(u)).toBe(1);
    });
    it('scope by id counts inside the nearest matching ancestor', () => {
      const w = nested('<condition type="atLeast" value="1" field="selections" scope="squad" childId="m"/>', 'child');
      const s = w.add('Squad');
      const mark = w.pick(s, 'Marker');
      expect(w.pts(mark)).toBe(0);
      w.pick(s, 'Model');
      expect(w.pts(mark)).toBe(1);
    });
    it('scope by the id of the force counts the force', () => {
      const w = world(guarded('<condition type="atLeast" value="1" field="selections" scope="det" childId="x"/>'));
      const u = w.add('Squad');
      w.add('Other');
      expect(holds(w, u)).toBe(true);
    });
    it('scope by an id that matches nothing counts nothing', () => {
      const w = world(guarded('<condition type="atLeast" value="1" field="selections" scope="nowhere" childId="x"/>'));
      const u = w.add('Squad');
      w.add('Other');
      expect(holds(w, u)).toBe(false);
    });
    it('matches by category', () => {
      const w = world(
        guarded(
          '<condition type="atLeast" value="1" field="selections" scope="force" childId="elite"/>',
          unit('x', 'Other', 0, '<categoryLinks><categoryLink id="l" targetId="elite"/></categoryLinks>'),
        ),
      );
      const u = w.add('Squad');
      w.add('Other');
      expect(holds(w, u)).toBe(true);
    });
    it('matches by entry type', () => {
      const w = world(guarded('<condition type="equalTo" value="2" field="selections" scope="force" childId="unit"/>'));
      const u = w.add('Squad');
      w.add('Other');
      expect(holds(w, u)).toBe(true);
    });
    it('counts detachments when a condition asks for selections of a force entry', () => {
      const w = world(guarded('<condition type="atLeast" value="2" field="selections" scope="roster" childId="det"/>'));
      const u = w.add('Squad');
      expect(holds(w, u)).toBe(false);
      w.addForce();
      expect(holds(w, u)).toBe(true);
    });
    it('a list with no detachment of that force entry counts none', () => {
      const w = world(
        guarded('<condition type="lessThan" value="1" field="selections" scope="roster" childId="ally"/>'),
        {
          gst: TWO_FORCES,
        },
      );
      const u = w.add('Squad');
      expect(holds(w, u)).toBe(true);
      w.roster.forces.push({ uid: 'f2', forceEntryId: 'ally', catalogueId: 'cat', selections: [] });
      expect(holds(w, u)).toBe(false);
    });
    it('scope force asks only whether this detachment is of that force entry', () => {
      const own = world(
        guarded('<condition type="atLeast" value="1" field="selections" scope="force" childId="det"/>'),
        {
          gst: TWO_FORCES,
        },
      );
      expect(holds(own, own.add('Squad'))).toBe(true);
      const other = world(
        guarded('<condition type="atLeast" value="1" field="selections" scope="force" childId="ally"/>'),
        { gst: TWO_FORCES },
      );
      const u = other.add('Squad');
      other.roster.forces.push({ uid: 'f2', forceEntryId: 'ally', catalogueId: 'cat', selections: [] });
      expect(holds(other, u)).toBe(false);
    });
    it('counts forces', () => {
      const w = world(guarded('<condition type="atLeast" value="2" field="forces" scope="roster" childId="det"/>'));
      const u = w.add('Squad');
      expect(holds(w, u)).toBe(false);
      w.addForce();
      expect(holds(w, u)).toBe(true);
    });
    it('measures points spent', () => {
      const w = world(guarded('<condition type="atLeast" value="30" field="pts" scope="parent" childId="x"/>'));
      w.add('Other', 3);
      const u = w.add('Squad');
      expect(holds(w, u)).toBe(true);
    });
    it('measures points as a percentage', () => {
      const share = (others: number) => {
        const w = world(
          guarded(
            '<condition type="atLeast" value="50" field="pts" scope="parent" childId="x" percentValue="true"/>',
            unit('x', 'Other', 30) + unit('y', 'Filler', 70),
          ),
        );
        w.add('Other', others);
        w.add('Filler');
        return holds(w, w.add('Squad'));
      };
      expect(share(1)).toBe(false); // 30 of 100
      expect(share(3)).toBe(true); // 90 of 160
    });
    it('a percentage of nothing is zero', () => {
      const w = world(
        guarded('<condition type="atMost" value="0" field="pts" scope="parent" childId="x" percentValue="true"/>'),
      );
      expect(holds(w, w.add('Squad'))).toBe(true);
    });

    it('points conditions give the same answer whatever order units were added', () => {
      const xml = guarded('<condition type="atLeast" value="10" field="pts" scope="force" childId="x"/>');
      const after = world(xml);
      const a = after.add('Squad');
      after.add('Other');
      const before = world(xml);
      before.add('Other');
      const b = before.add('Squad');
      // Other costs 10, so the condition holds and Squad costs 1 either way
      expect(after.pts(a)).toBe(1);
      expect(before.pts(b)).toBe(1);
      expect(after.ev().total).toBe(11);
      expect(before.ev().total).toBe(11);
    });
  });

  describe('instanceOf', () => {
    const inside = (condition: string, extra = '') =>
      unit(
        's',
        'Squad',
        0,
        extra +
          children(
            entry(
              'm',
              'Model',
              0,
              children(
                entry(
                  'g',
                  'Gun',
                  0,
                  mods(`<modifier type="increment" field="pts" value="1">${conds(condition)}</modifier>`),
                ),
              ),
            ),
          ),
      );
    const gun = (xml: string) => {
      const w = world(xml);
      const s = w.add('Squad');
      const m = w.pick(s, 'Model');
      return w.pts(w.pick(m, 'Gun'));
    };

    it('self matches the selection itself', () => {
      expect(gun(inside('<condition type="instanceOf" value="1" field="selections" scope="self" childId="g"/>'))).toBe(
        1,
      );
      expect(gun(inside('<condition type="instanceOf" value="1" field="selections" scope="self" childId="m"/>'))).toBe(
        0,
      );
    });
    it('parent matches the direct parent only', () => {
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="parent" childId="m"/>')),
      ).toBe(1);
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="parent" childId="s"/>')),
      ).toBe(0);
    });
    it('ancestor matches any level above', () => {
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="ancestor" childId="s"/>')),
      ).toBe(1);
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="ancestor" childId="zzz"/>')),
      ).toBe(0);
    });
    it('ancestor matches a category of an ancestor', () => {
      const cat = '<categoryLinks><categoryLink id="l" targetId="elite"/></categoryLinks>';
      expect(
        gun(
          inside('<condition type="instanceOf" value="1" field="selections" scope="ancestor" childId="elite"/>', cat),
        ),
      ).toBe(1);
    });
    it('notInstanceOf inverts', () => {
      expect(
        gun(inside('<condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="s"/>')),
      ).toBe(0);
      expect(
        gun(inside('<condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="zzz"/>')),
      ).toBe(1);
    });
    it('force matches the force entry and the catalogue', () => {
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="force" childId="det"/>')),
      ).toBe(1);
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="force" childId="cat"/>')),
      ).toBe(1);
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="force" childId="zzz"/>')),
      ).toBe(0);
    });
    it('primary-catalogue matches the catalogue', () => {
      expect(
        gun(
          inside('<condition type="instanceOf" value="1" field="selections" scope="primary-catalogue" childId="cat"/>'),
        ),
      ).toBe(1);
      expect(
        gun(
          inside(
            '<condition type="notInstanceOf" value="1" field="selections" scope="primary-catalogue" childId="zzz"/>',
          ),
        ),
      ).toBe(1);
    });
    it('roster matches any force and the game system', () => {
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="roster" childId="gst"/>')),
      ).toBe(1);
      expect(
        gun(inside('<condition type="instanceOf" value="1" field="selections" scope="roster" childId="det"/>')),
      ).toBe(1);
    });
    it('self works for an option not yet selected', () => {
      const w = world(
        unit(
          's',
          'Squad',
          0,
          children(
            entry(
              'g',
              'Gun',
              0,
              `<categoryLinks><categoryLink id="l" targetId="elite"/></categoryLinks>` +
                mods(
                  `<modifier type="set" field="hidden" value="true">${conds('<condition type="instanceOf" value="1" field="selections" scope="self" childId="elite"/>')}</modifier>`,
                ),
            ),
          ),
        ),
      );
      const s = w.add('Squad');
      const ev = w.ev();
      expect(ev.optionEff(w.beneath(s, 'Gun'), ev.find(s)!, ev.forces[0]).hidden).toBe(true);
    });
  });
});

describe('effects that depend on each other', () => {
  /** adds the named units in the order given and reads the points of each */
  const built = (xml: string, ...names: string[]) => {
    const w = world(xml);
    const sels = names.map((n) => [n, w.add(n)] as const);
    const ev = w.ev();
    return { total: ev.total, pts: Object.fromEntries(sels.map(([n, u]) => [n, ev.find(u)?.total])) };
  };

  it("a parent's condition on its children's costs gives the right points", () => {
    const w = world(
      unit(
        'u',
        'Squad',
        50,
        mods(
          `<modifier type="increment" field="pts" value="10">${conds('<condition type="atLeast" value="5" field="pts" scope="self" childId="any"/>')}</modifier>`,
        ) + children(entry('g', 'Gun', 5)),
      ),
    );
    const u = w.add('Squad');
    expect(w.pts(u)).toBe(50);
    w.pick(u, 'Gun');
    expect(w.pts(u)).toBe(50 + 5 + 10);
  });

  // A adds 10 while B costs 15 or more; B adds 10 while A costs under 15. Each pass from nothing:
  // (A, B) = (10, 20), (20, 20), (20, 10), (10, 10), (10, 20), so the cap leaves A at 10 and B at 20.
  it('a list whose modifiers never settle stops at the cap, with the same points in any unit order', () => {
    const xml =
      unit(
        'a',
        'Alpha',
        10,
        mods(
          `<modifier type="increment" field="pts" value="10">${conds('<condition type="atLeast" value="15" field="pts" scope="force" childId="b"/>')}</modifier>`,
        ),
      ) +
      unit(
        'b',
        'Beta',
        10,
        mods(
          `<modifier type="increment" field="pts" value="10">${conds('<condition type="lessThan" value="15" field="pts" scope="force" childId="a"/>')}</modifier>`,
        ),
      );
    const expected = { total: 30, pts: { Alpha: 10, Beta: 20 } };
    expect(built(xml, 'Alpha', 'Beta')).toEqual(expected);
    expect(built(xml, 'Beta', 'Alpha')).toEqual(expected);
  });

  /** costs 10, or 20 once the unit before it in the chain costs 20 */
  const link = (id: string, name: string, before: string) =>
    unit(
      id,
      name,
      10,
      mods(
        `<modifier type="increment" field="pts" value="10">${conds(`<condition type="atLeast" value="20" field="pts" scope="force" childId="${before}"/>`)}</modifier>`,
      ),
    );

  it('a chain of conditions runs out at the fifth pass, whatever the unit order', () => {
    const xml =
      unit('c1', 'One', 20) +
      link('c2', 'Two', 'c1') +
      link('c3', 'Three', 'c2') +
      link('c4', 'Four', 'c3') +
      link('c5', 'Five', 'c4') +
      link('c6', 'Six', 'c5');
    // each pass brings one more unit to 20, and only the sixth would need a sixth pass
    const expected = { total: 110, pts: { One: 20, Two: 20, Three: 20, Four: 20, Five: 20, Six: 10 } };
    expect(built(xml, 'One', 'Two', 'Three', 'Four', 'Five', 'Six')).toEqual(expected);
    expect(built(xml, 'Six', 'Five', 'Four', 'Three', 'Two', 'One')).toEqual(expected);
  });

  it('keeps going after a pass that changes only a category', () => {
    const xml =
      unit('s', 'Spotter', 10) +
      unit(
        'm',
        'Marked',
        0,
        mods(
          `<modifier type="add" field="category" value="elite">${conds('<condition type="atLeast" value="10" field="pts" scope="force" childId="s"/>')}</modifier>`,
        ),
      ) +
      unit(
        'r',
        'Reader',
        1,
        mods(
          `<modifier type="increment" field="pts" value="5">${conds('<condition type="atLeast" value="1" field="selections" scope="force" childId="elite"/>')}</modifier>`,
        ),
      );
    const expected = { total: 16, pts: { Spotter: 10, Marked: 0, Reader: 6 } };
    expect(built(xml, 'Spotter', 'Marked', 'Reader')).toEqual(expected);
    expect(built(xml, 'Reader', 'Marked', 'Spotter')).toEqual(expected);
  });

  it('keeps going after a pass that changes only a primary category', () => {
    const hq = '<categoryLinks><categoryLink id="l" targetId="hq" primary="true"/></categoryLinks>';
    const xml =
      unit('s', 'Spotter', 10) +
      unit(
        'm',
        'Marked',
        0,
        hq +
          mods(
            `<modifier type="unset-primary" field="category" value="hq">${conds('<condition type="atLeast" value="10" field="pts" scope="force" childId="s"/>')}</modifier>`,
          ),
      ) +
      unit(
        'r',
        'Reader',
        1,
        hq +
          mods(
            `<modifier type="increment" field="pts" value="5">${conds('<condition type="lessThan" value="2" field="selections" scope="primary-category" childId="any"/>')}</modifier>`,
          ),
      );
    const expected = { total: 16, pts: { Spotter: 10, Marked: 0, Reader: 6 } };
    expect(built(xml, 'Spotter', 'Marked', 'Reader')).toEqual(expected);
    expect(built(xml, 'Reader', 'Marked', 'Spotter')).toEqual(expected);
  });
});

describe('validation', () => {
  it('reports going over the points limit by how much', () => {
    const w = world(unit('u', 'Squad', 60), { costLimit: 100 });
    w.add('Squad');
    expect(w.errors()).toEqual([]);
    w.add('Squad');
    expect(w.errors()).toEqual(['Over points limit by 20']);
  });
  it('allows hitting the points limit exactly', () => {
    const w = world(unit('u', 'Squad', 50), { costLimit: 100 });
    w.add('Squad', 2);
    expect(w.errors()).toEqual([]);
  });
  it('treats a limit of zero as no limit', () => {
    const w = world(unit('u', 'Squad', 1000));
    w.add('Squad');
    expect(w.errors()).toEqual([]);
  });

  it('reports too few of a child', () => {
    const w = world(unit('u', 'Squad', 0, children(entry('g', 'Gun', 0, cons(min(2))))));
    const u = w.add('Squad');
    w.ev();
    const s = locate(w.roster, u)!.sel;
    s.children[0].number = 1;
    expect(w.errors()).toEqual(['Squad › Gun: needs at least 2 (has 1)']);
  });
  it('reports too many of a child', () => {
    const w = world(unit('u', 'Squad', 0, children(entry('g', 'Gun', 0, cons(max(1))))));
    const u = w.add('Squad');
    w.pick(u, 'Gun', 2);
    expect(w.errors()).toEqual(['Squad › Gun: at most 1 allowed (has 2)']);
  });
  it('checks a group across its members', () => {
    const group = `<selectionEntryGroups><selectionEntryGroup id="grp" name="Weapons">${cons(max(1))}${children(entry('a', 'Axe', 0), entry('b', 'Bow', 0))}</selectionEntryGroup></selectionEntryGroups>`;
    const w = world(unit('u', 'Squad', 0, group));
    const u = w.add('Squad');
    w.pick(u, 'Axe');
    w.pick(u, 'Bow');
    expect(w.errors()).toEqual(['Squad › Weapons: at most 1 allowed (has 2)']);
  });
  it('checks a hidden child only when it was actually taken', () => {
    const w = world(
      unit('u', 'Squad', 0, children(entry('g', 'Gun', 0, cons(min(1)), 'type="upgrade" hidden="true"'))),
    );
    w.add('Squad');
    expect(w.errors()).toEqual([]);
  });
  it('checks a max across the force for selections anywhere', () => {
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
              '<constraint id="c" type="max" value="1" field="selections" scope="force" includeChildSelections="true"/>',
            ),
          ),
        ),
      ),
    );
    w.pick(w.add('Squad'), 'Gun');
    expect(w.errors()).toEqual([]);
    w.pick(w.add('Squad'), 'Gun');
    expect(w.errors()).toContain('Gun: at most 1 allowed in this detachment (has 2)');
  });
  it('checks a max across the roster for selections anywhere', () => {
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
              '<constraint id="c" type="max" value="1" field="selections" scope="roster" includeChildSelections="true"/>',
            ),
          ),
        ),
      ),
    );
    w.pick(w.add('Squad'), 'Gun');
    const f2 = w.addForce();
    w.pick(w.add('Squad', 1, f2), 'Gun');
    expect(w.errors()).toContain('Gun: at most 1 allowed in the list (has 2)');
  });
  it('checks limits on root units within a force', () => {
    const w = world(
      unit('u', 'Boss', 0, cons('<constraint id="c" type="max" value="1" field="selections" scope="force"/>')),
    );
    w.add('Boss');
    expect(w.errors()).toEqual([]);
    w.add('Boss');
    expect(w.errors()).toEqual(['Boss: at most 1 allowed in this detachment (has 2)']);
  });
  it('checks limits on root units across a roster', () => {
    const w = world(
      unit('u', 'Boss', 0, cons('<constraint id="c" type="max" value="1" field="selections" scope="roster"/>')),
    );
    w.add('Boss');
    w.add('Boss', 1, w.addForce());
    expect(w.errors()).toContain('Boss: at most 1 allowed in the list (has 2)');
  });
  it('requires mandatory root units', () => {
    const w = world(
      unit('u', 'Boss', 0, cons('<constraint id="c" type="min" value="1" field="selections" scope="force"/>')),
    );
    expect(w.errors()).toEqual(['Boss: needs at least 1 in this detachment (has 0)']);
  });
  it('checks points limits on a root unit', () => {
    const w = world(
      unit('u', 'Boss', 30, cons('<constraint id="c" type="max" value="50" field="pts" scope="force"/>')),
    );
    w.add('Boss', 2);
    expect(w.errors()).toEqual(['Boss: at most 50 pts allowed in this detachment (has 60)']);
  });
  it('checks percentage limits against the current total', () => {
    const w = world(
      unit(
        'u',
        'Boss',
        30,
        cons('<constraint id="c" type="max" value="25" field="pts" scope="roster" percentValue="true"/>'),
      ) + unit('x', 'Other', 70),
    );
    w.add('Other');
    w.add('Boss');
    expect(w.errors()).toEqual(['Boss: at most 25 pts allowed in the list (has 30)']);
    w.add('Other');
    expect(w.errors()).toEqual([]);
  });
  it('warns about a unit that has become hidden', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        mods(
          `<modifier type="set" field="hidden" value="true">${conds('<condition type="atLeast" value="1" field="selections" scope="force" childId="x"/>')}</modifier>`,
        ),
      ) + unit('x', 'Other', 0),
    );
    w.add('Squad');
    w.add('Other');
    expect(w.warnings()).toEqual(['Squad is not available with the current choices']);
  });
  it('does not warn about an entry that hides itself once one is taken', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        mods(
          `<modifier type="set" field="hidden" value="true">${conds('<condition type="equalTo" value="1" field="selections" scope="force" childId="u"/>')}</modifier>`,
        ),
      ),
    );
    w.add('Squad');
    expect(w.ev().optionEff(w.root('Squad'), null, w.ev().forces[0]).hidden).toBe(true);
    expect(w.warnings()).toEqual([]);
  });
  it('still warns when something else hides a self-hiding entry', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        mods(
          `<modifier type="set" field="hidden" value="true">${conds('<condition type="equalTo" value="1" field="selections" scope="force" childId="u"/>')}</modifier>`,
          `<modifier type="set" field="hidden" value="true">${conds('<condition type="atLeast" value="1" field="selections" scope="force" childId="x"/>')}</modifier>`,
        ),
      ) + unit('x', 'Other', 0),
    );
    w.add('Squad');
    w.add('Other');
    expect(w.warnings()).toEqual(['Squad is not available with the current choices']);
  });
  it('warns about units that are gone from the data, and keeps them in the list', () => {
    const w = world(unit('u', 'Squad', 10));
    const u = w.add('Squad');
    locate(w.roster, u)!.sel.key = 'gone';
    expect(w.warnings()).toEqual(['1 unit(s) no longer exist in the data and were skipped']);
    expect(w.ev().total).toBe(0);
    expect(w.roster.forces[0].selections).toHaveLength(1);
  });

  describe('issues keep to their reach', () => {
    const issue = (reach: Issue['reach'], message: string, forceUid?: string, selUid?: string) => ({
      level: 'error',
      reach,
      forceUid,
      selUid,
      message,
    });
    const pickIn = (w: ReturnType<typeof world>, forceUid: string, parentUid: string, name: string) =>
      addSel(w.roster, w.contexts, forceUid, parentUid, w.beneath(parentUid, name));
    const inForce = cons('<constraint id="c" type="max" value="1" field="selections" scope="force"/>');
    const inList = cons('<constraint id="c" type="max" value="1" field="selections" scope="roster"/>');

    it('gives each unit its own issue for a limit of its own', () => {
      const w = world(unit('u', 'Squad', 0, children(entry('g', 'Gun', 0, cons(max(1))))));
      const a = w.add('Squad');
      const b = w.add('Squad');
      w.pick(a, 'Gun', 2);
      w.pick(b, 'Gun', 2);
      const message = 'Squad › Gun: at most 1 allowed (has 2)';
      expect(w.ev().issues).toEqual([issue('unit', message, 'f1', a), issue('unit', message, 'f1', b)]);
    });

    it('gives wargear over a detachment limit one issue on each force', () => {
      const w = world(unit('u', 'Squad', 0, children(entry('r', 'Relic', 0, inForce))));
      const f2 = w.addForce();
      const [a, b] = [w.add('Squad'), w.add('Squad')];
      const [c, d] = [w.add('Squad', 1, f2), w.add('Squad', 1, f2)];
      for (const u of [a, b]) pickIn(w, 'f1', u, 'Relic');
      for (const u of [c, d]) pickIn(w, f2, u, 'Relic');
      const message = 'Relic: at most 1 allowed in this detachment (has 2)';
      expect(w.ev().issues).toEqual([issue('force', message, 'f1', a), issue('force', message, f2, c)]);
    });

    it('gives a root unit over a detachment limit one issue on each force', () => {
      const w = world(unit('u', 'Hero', 0, inForce));
      const f2 = w.addForce();
      const a = w.add('Hero', 2);
      const b = w.add('Hero', 2, f2);
      const message = 'Hero: at most 1 allowed in this detachment (has 2)';
      expect(w.ev().issues).toEqual([issue('force', message, 'f1', a), issue('force', message, f2, b)]);
    });

    it('gives a category limit one issue on each force', () => {
      const gst = `<categoryEntries><categoryEntry id="hq" name="HQ"/></categoryEntries>
        <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks>
          <categoryLink id="l" name="HQ" targetId="hq">${cons(min(1))}</categoryLink>
        </categoryLinks></forceEntry></forceEntries>`;
      const w = world('', { gst });
      const f2 = w.addForce();
      const message = 'HQ: needs at least 1 (has 0)';
      expect(w.ev().issues).toEqual([issue('force', message, 'f1'), issue('force', message, f2)]);
    });

    it('gives a missing root unit one issue on each force', () => {
      const w = world(unit('u', 'Hero', 0, cons(min(1))));
      const f2 = w.addForce();
      const message = 'Hero: needs at least 1 (has 0)';
      expect(w.ev().issues).toEqual([issue('force', message, 'f1'), issue('force', message, f2)]);
    });

    it("treats a parent limit on a root unit as the detachment's, across links to one entry", () => {
      const links = `<entryLinks>
        <entryLink id="l1" name="Hero" targetId="h" type="selectionEntry"/>
        <entryLink id="l2" name="Hero" targetId="h" type="selectionEntry"/>
      </entryLinks>`;
      const w = world('', {
        cat: `${links}<sharedSelectionEntries>${unit('h', 'Hero', 0, cons(max(1)))}</sharedSelectionEntries>`,
      });
      const f2 = w.addForce();
      const [one, two] = forceRootOptions(w.ctx, w.ctx.forceEntries()[0]);
      const a = addedUid(addSel(w.roster, w.contexts, 'f1', null, one));
      addSel(w.roster, w.contexts, 'f1', null, two);
      const b = addedUid(addSel(w.roster, w.contexts, f2, null, one));
      addSel(w.roster, w.contexts, f2, null, two);
      const message = 'Hero: at most 1 allowed (has 2)';
      expect(w.ev().issues).toEqual([issue('force', message, 'f1', a), issue('force', message, f2, b)]);
    });

    it('keeps a list-wide issue on the first unit that reached it', () => {
      const w = world(unit('u', 'Squad', 0, children(entry('r', 'Relic', 0, inList))));
      const f2 = w.addForce();
      const a = w.add('Squad');
      const b = w.add('Squad', 1, f2);
      pickIn(w, 'f1', a, 'Relic');
      pickIn(w, f2, b, 'Relic');
      expect(w.ev().issues).toEqual([issue('list', 'Relic: at most 1 allowed in the list (has 2)', 'f1', a)]);
    });

    it('keeps the same text from different reaches apart', () => {
      const w = world(
        unit('u', 'Squad', 0, children(entry('g', 'Gun', 0, cons(max(1))))) + unit('s', 'Squad › Gun', 0, cons(max(1))),
      );
      const root = w.add('Squad › Gun', 2);
      const u = w.add('Squad');
      w.pick(u, 'Gun', 2);
      const message = 'Squad › Gun: at most 1 allowed (has 2)';
      expect(w.ev().issues).toEqual([issue('force', message, 'f1', root), issue('unit', message, 'f1', u)]);
    });

    it('puts going over the points limit on the whole list', () => {
      const w = world(unit('u', 'Squad', 60), { costLimit: 50 });
      w.add('Squad');
      expect(w.ev().issues).toEqual([issue('list', 'Over points limit by 10')]);
    });

    it('warns about each unit that is hidden by other choices', () => {
      const hidden = `<modifier type="set" field="hidden" value="true">${conds('<condition type="atLeast" value="1" field="selections" scope="force" childId="x"/>')}</modifier>`;
      const w = world(unit('u', 'Squad', 0, mods(hidden)) + unit('x', 'Other', 0));
      const a = w.add('Squad');
      const b = w.add('Squad');
      w.add('Other');
      const message = 'Squad is not available with the current choices';
      expect(w.ev().issues).toEqual([
        { ...issue('unit', message, 'f1', a), level: 'warn' },
        { ...issue('unit', message, 'f1', b), level: 'warn' },
      ]);
    });

    it('warns about skipped units on each force', () => {
      const w = world(unit('u', 'Squad', 0));
      const f2 = w.addForce();
      w.add('Squad');
      w.add('Squad', 1, f2);
      for (const force of w.roster.forces) force.selections[0].key = 'gone';
      const message = '1 unit(s) no longer exist in the data and were skipped';
      expect(w.ev().issues).toEqual([
        { ...issue('force', message, 'f1'), level: 'warn' },
        { ...issue('force', message, f2), level: 'warn' },
      ]);
    });
  });

  describe('wargear gone from the data', () => {
    const SQUAD = unit('u', 'Squad', 10);
    const SQUAD_WITH_GUN = unit('u', 'Squad', 10, children(entry('g', 'Gun', 5)));
    const skipped = (name: string, n: number) => `${name}: ${n} item(s) no longer exist in the data and were skipped`;

    it('warns about wargear that is gone from the data', () => {
      const w = world(SQUAD_WITH_GUN);
      const u = w.add('Squad');
      w.pick(u, 'Gun');
      const without = new Evaluator(w.roster, world(SQUAD).contexts);
      expect(without.issues).toEqual([
        { level: 'warn', reach: 'unit', forceUid: 'f1', selUid: u, message: skipped('Squad', 1) },
      ]);
    });

    it('leaves gone wargear in the saved list and out of the points', () => {
      const w = world(SQUAD_WITH_GUN);
      const u = w.add('Squad');
      const g = w.pick(u, 'Gun');
      const saved = structuredClone(w.roster);
      const rs = new Evaluator(w.roster, world(SQUAD).contexts).find(u);
      expect(rs?.total).toBe(10);
      expect(rs?.broken.map((s) => s.uid)).toEqual([g]);
      expect(w.roster).toEqual(saved);
    });

    it('drops the warning and returns the points when the data has the item again', () => {
      const w = world(SQUAD_WITH_GUN);
      const u = w.add('Squad');
      w.pick(u, 'Gun');
      const without = new Evaluator(w.roster, world(SQUAD).contexts);
      expect(without.issues.map((i) => i.message)).toEqual([skipped('Squad', 1)]);
      expect(without.find(u)?.total).toBe(10);
      const restored = new Evaluator(w.roster, w.contexts);
      expect(restored.issues).toEqual([]);
      expect(restored.find(u)?.total).toBe(15);
    });

    it('counts each gone selection once in the warning, whatever its number', () => {
      const w = world(unit('u', 'Squad', 10, children(entry('g', 'Gun', 5), entry('k', 'Knife', 1))));
      const u = w.add('Squad');
      w.pick(u, 'Gun', 3);
      w.pick(u, 'Knife');
      const without = new Evaluator(w.roster, world(SQUAD).contexts);
      expect(without.issues.map((i) => i.message)).toEqual([skipped('Squad', 2)]);
    });

    it('warns on the model that lost the wargear, not on its unit', () => {
      const squad = (gear: string) => unit('u', 'Squad', 10, children(entry('m', 'Model', 20, gear)));
      const w = world(squad(children(entry('g', 'Gun', 5))));
      const u = w.add('Squad');
      const m = w.pick(u, 'Model');
      w.pick(m, 'Gun');
      const without = new Evaluator(w.roster, world(squad('')).contexts);
      expect(without.issues).toEqual([
        { level: 'warn', reach: 'unit', forceUid: 'f1', selUid: m, message: skipped('Model', 1) },
      ]);
      expect(without.find(u)?.total).toBe(30);
    });

    it('gives each unit its own warning when two have the same name and count', () => {
      const w = world(SQUAD_WITH_GUN);
      const first = w.add('Squad');
      const second = w.add('Squad');
      w.pick(first, 'Gun');
      w.pick(second, 'Gun');
      const without = new Evaluator(w.roster, world(SQUAD).contexts);
      expect(without.issues).toEqual([
        { level: 'warn', reach: 'unit', forceUid: 'f1', selUid: first, message: skipped('Squad', 1) },
        { level: 'warn', reach: 'unit', forceUid: 'f1', selUid: second, message: skipped('Squad', 1) },
      ]);
    });

    it('skips wargear whose key now belongs to a group', () => {
      const w = world(SQUAD_WITH_GUN);
      const u = w.add('Squad');
      w.pick(u, 'Gun');
      const regrouped = unit(
        'u',
        'Squad',
        10,
        '<selectionEntryGroups><selectionEntryGroup id="g" name="Guns"/></selectionEntryGroups>',
      );
      const without = new Evaluator(w.roster, world(regrouped).contexts);
      expect(without.issues.map((i) => i.message)).toEqual([skipped('Squad', 1)]);
      expect(without.find(u)?.total).toBe(10);
    });
  });

  it('survives a catalogue that is not loaded', () => {
    const w = world(unit('u', 'Squad', 10));
    w.add('Squad');
    w.roster.forces[0].catalogueId = 'missing';
    expect(w.ev().forces).toEqual([]);
  });

  describe('force organisation', () => {
    const FOC = `<categoryEntries><categoryEntry id="hq" name="HQ"/><categoryEntry id="tr" name="Troops"/></categoryEntries>
      <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks>
        <categoryLink id="l-hq" name="HQ" targetId="hq"><constraints>
          <constraint id="hq-min" type="min" value="1" field="selections" scope="parent"/>
          <constraint id="hq-max" type="max" value="2" field="selections" scope="parent"/>
        </constraints></categoryLink>
        <categoryLink id="l-tr" name="Troops" targetId="tr"/>
      </categoryLinks></forceEntry></forceEntries>`;
    const inCat = (c: string) => `<categoryLinks><categoryLink id="l" targetId="${c}" primary="true"/></categoryLinks>`;
    const units = unit('b', 'Boss', 0, inCat('hq')) + unit('t', 'Troop', 0, inCat('tr'));

    it('reports a slot that is short', () => {
      const w = world(units, { gst: FOC });
      expect(w.errors()).toEqual(['HQ: needs at least 1 (has 0)']);
      w.add('Boss');
      expect(w.errors()).toEqual([]);
    });
    it('reports a slot that is over', () => {
      const w = world(units, { gst: FOC });
      w.add('Boss', 3);
      expect(w.errors()).toEqual(['HQ: at most 2 allowed (has 3)']);
    });
    it('summarises a slot', () => {
      const w = world(units, { gst: FOC });
      w.add('Boss', 3);
      const ev = w.ev();
      expect(ev.categoryLimits(ev.forces[0], 'hq')).toEqual({ min: 1, max: 2, n: 3, bad: true });
      expect(ev.categoryLimits(ev.forces[0], 'tr')).toEqual({ min: 0, max: -1, n: 0, bad: false });
    });
    it('lets the data change a slot with a modifier', () => {
      const raised = FOC.replace(
        '<categoryLink id="l-hq" name="HQ" targetId="hq">',
        '<categoryLink id="l-hq" name="HQ" targetId="hq"><modifiers><modifier type="increment" field="hq-max" value="1"/></modifiers>',
      );
      const w = world(units, { gst: raised });
      w.add('Boss', 3);
      expect(w.ev().categoryLimits(w.ev().forces[0], 'hq').max).toBe(3);
      expect(w.errors()).toEqual([]);
    });
    it('reads limits set on the category itself', () => {
      const gst = `<categoryEntries><categoryEntry id="tr" name="Troops"><constraints><constraint id="c" type="max" value="1" field="selections" scope="parent"/></constraints></categoryEntry></categoryEntries>
        <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks><categoryLink id="l" targetId="tr"/></categoryLinks></forceEntry></forceEntries>`;
      const w = world(unit('t', 'Troop', 0, inCat('tr')), { gst });
      w.add('Troop', 2);
      expect(w.errors()).toEqual(['Troops: at most 1 allowed (has 2)']);
    });
    it('limits points in a category, across the roster when asked', () => {
      const gst = `<categoryEntries><categoryEntry id="tr" name="Troops"/></categoryEntries>
        <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks><categoryLink id="l" name="Troops" targetId="tr"><constraints><constraint id="c" type="max" value="10" field="pts" scope="roster"/></constraints></categoryLink></categoryLinks></forceEntry></forceEntries>`;
      const w = world(unit('t', 'Troop', 6, inCat('tr')), { gst });
      w.add('Troop');
      w.add('Troop', 1, w.addForce());
      expect(w.errors()).toContain('Troops: at most 10 pts allowed in the list (has 12)');
    });
    it('counts a unit only in the category it was added under when the data gives no primary', () => {
      const w = world(unit('t', 'Troop', 0, '<categoryLinks><categoryLink id="l" targetId="tr"/></categoryLinks>'), {
        gst: FOC,
      });
      const opt = w.root('Troop');
      addSel(w.roster, w.contexts, 'f1', null, opt, 1, 'tr');
      expect(w.ev().categoryLimits(w.ev().forces[0], 'tr').n).toBe(1);
    });
    it('offers units whose primary category is in the force, and entries with no category', () => {
      const w = world(
        units +
          unit('z', 'Stranger', 0, inCat('nope')) +
          unit('y', 'Fallback', 0, '<categoryLinks><categoryLink id="l" targetId="tr"/></categoryLinks>') +
          unit('n', 'Nameless', 0),
        { gst: FOC },
      );
      const names = forceRootOptions(w.ctx, w.ctx.forceEntries()[0]).map((o) => o.node.name);
      expect(names).toEqual(['Boss', 'Troop', 'Fallback', 'Nameless']);
    });
    it('holds a detachment to the minimum of a root entry with no category', () => {
      const w = world(
        units +
          entry(
            'c',
            'Chapter Tactics',
            0,
            '<constraints><constraint id="c-min" type="min" value="1" field="selections" scope="force"/></constraints>',
          ),
        { gst: FOC },
      );
      w.add('Boss');
      expect(w.errors()).toEqual(['Chapter Tactics: needs at least 1 in this detachment (has 0)']);
    });
    it('remembers root options per force entry', () => {
      const w = world(units, { gst: FOC });
      const fe = w.ctx.forceEntries()[0];
      expect(forceRootOptions(w.ctx, fe)).toBe(forceRootOptions(w.ctx, fe));
    });
    it('falls back to a stand-in force entry when the data lost it', () => {
      const w = world(unit('u', 'Squad', 5));
      w.add('Squad');
      w.roster.forces[0].forceEntryId = 'gone';
      expect(w.ev().forces[0].entry.name).toBe('Force');
    });
    it('still counts the units of a force whose entry has gone', () => {
      const w = world(unit('u', 'Squad', 5));
      w.add('Squad', 2);
      w.add('Squad', 1, w.addForce());
      w.roster.forces[0].forceEntryId = 'gone';
      const ev = w.ev();
      expect(ev.forces.map((f) => f.total)).toEqual([10, 5]);
      expect(ev.total).toBe(15);
    });
    it('applies no category limits to a force whose entry has gone', () => {
      const w = world(units, { gst: FOC });
      w.add('Boss', 3);
      expect(w.errors()).toEqual(['HQ: at most 2 allowed (has 3)']);
      w.roster.forces[0].forceEntryId = 'gone';
      expect(w.errors()).toEqual([]);
    });
    it("warns on a force whose entry has gone, with the force's uid", () => {
      const w = world(unit('u', 'Squad', 5));
      w.add('Squad');
      w.roster.forces[0].forceEntryId = 'gone';
      expect(w.ev().issues).toEqual([
        { level: 'warn', reach: 'force', forceUid: 'f1', message: "This detachment's type is no longer in the data" },
      ]);
    });
    it('warns on each force whose entry has gone', () => {
      const w = world(unit('u', 'Squad', 5));
      w.addForce();
      for (const f of w.roster.forces) f.forceEntryId = 'gone';
      expect(w.ev().issues.map((i) => i.forceUid)).toEqual(['f1', 'f2']);
    });
    it('warns only on the force whose entry has gone', () => {
      const w = world(unit('u', 'Squad', 5));
      w.addForce();
      w.roster.forces[1].forceEntryId = 'gone';
      expect(w.ev().issues.map((i) => i.forceUid)).toEqual(['f2']);
    });
    describe('root-entry limits on a force whose entry has gone', () => {
      const TWO_TYPES = `<categoryEntries><categoryEntry id="hq" name="HQ"/><categoryEntry id="oth" name="Other"/></categoryEntries>
        <forceEntries>
          <forceEntry id="det" name="Detachment"><categoryLinks><categoryLink id="l-hq" name="HQ" targetId="hq"/></categoryLinks></forceEntry>
          <forceEntry id="other" name="Other Detachment"><categoryLinks><categoryLink id="l-oth" name="Other" targetId="oth"/></categoryLinks></forceEntry>
        </forceEntries>`;
      const boss = unit('b', 'Boss', 0, inCat('hq'));
      const elsewhere = unit('m', 'Mandatory', 0, inCat('oth') + cons(min(1)));

      it('keeps a list free of errors when a mandatory entry belongs to another detachment type', () => {
        const w = world(boss + elsewhere, { gst: TWO_TYPES });
        w.add('Boss');
        expect(w.errors()).toEqual([]);
        w.roster.forces[0].forceEntryId = 'gone';
        expect(w.errors()).toEqual([]);
      });
      it('applies no limit set on a root entry the force holds', () => {
        const w = world(unit('b', 'Boss', 0, inCat('hq') + cons(max(2))), { gst: TWO_TYPES });
        w.add('Boss', 3);
        expect(w.errors()).toEqual(['Boss: at most 2 allowed (has 3)']);
        w.roster.forces[0].forceEntryId = 'gone';
        expect(w.errors()).toEqual([]);
      });
      it('drops the warning about a hidden root entry the force holds', () => {
        const hidden = entry('b', 'Boss', 0, inCat('hq'), 'type="unit" hidden="true"');
        const w = world(hidden, { gst: TWO_TYPES });
        w.add('Boss');
        expect(w.warnings()).toEqual(['Boss is not available with the current choices']);
        w.roster.forces[0].forceEntryId = 'gone';
        expect(w.warnings()).toEqual(["This detachment's type is no longer in the data"]);
      });
      it('leaves only the warnings about the lost entry and the skipped units at force level', () => {
        const w = world(boss + elsewhere, { gst: TWO_TYPES });
        w.add('Boss', 2);
        w.roster.forces[0].selections[0].key = 'gone';
        w.roster.forces[0].forceEntryId = 'gone';
        expect(w.ev().issues).toEqual([
          {
            level: 'warn',
            reach: 'force',
            forceUid: 'f1',
            message: '1 unit(s) no longer exist in the data and were skipped',
          },
          { level: 'warn', reach: 'force', forceUid: 'f1', message: "This detachment's type is no longer in the data" },
        ]);
      });
      it('still reports a limit inside a unit', () => {
        const squad = unit('b', 'Boss', 0, inCat('hq') + children(entry('g', 'Gun', 0, cons(max(1)))));
        const w = world(squad + elsewhere, { gst: TWO_TYPES });
        const u = w.add('Boss');
        w.pick(u, 'Gun', 2);
        w.roster.forces[0].forceEntryId = 'gone';
        expect(w.errors()).toEqual(['Boss › Gun: at most 1 allowed (has 2)']);
      });
      it('keeps the root-entry limits of a force that still has its entry', () => {
        const w = world(unit('b', 'Boss', 0, inCat('hq') + cons(min(1))), { gst: TWO_TYPES });
        w.addForce();
        w.roster.forces[0].forceEntryId = 'gone';
        const errors = w.ev().issues.filter((i) => i.level === 'error');
        expect(errors.map((i) => i.forceUid)).toEqual(['f2']);
      });
    });
  });
});

describe('limits for the option picker', () => {
  const squad = (constraints: string, modifiers: string) =>
    unit('u', 'Squad', 0, children(entry('g', 'Gun', 0, cons(constraints) + modifiers)));
  const limits = (constraints: string, modifiers = '') => {
    const w = world(squad(constraints, modifiers));
    const u = w.add('Squad');
    const ev = w.ev();
    return ev.limits(w.beneath(u, 'Gun'), ev.find(u)!, ev.forces[0]);
  };

  it('defaults to no minimum and no maximum', () => {
    expect(limits('')).toEqual({ min: 0, max: -1 });
  });
  it('takes the tightest of several', () => {
    expect(
      limits(
        '<constraint id="a" type="max" value="5" field="selections" scope="parent"/><constraint id="b" type="max" value="2" field="selections" scope="parent"/>',
      ).max,
    ).toBe(2);
  });
  it('ignores limits at other scopes and on other fields', () => {
    expect(
      limits(
        '<constraint id="a" type="max" value="1" field="selections" scope="force"/><constraint id="b" type="max" value="1" field="pts" scope="parent"/>',
      ),
    ).toEqual({ min: 0, max: -1 });
  });

  it('a max of -1 does not depend on the order of the constraints', () => {
    const a = '<constraint id="a" type="max" value="5" field="selections" scope="parent"/>';
    const b = '<constraint id="b" type="max" value="-1" field="selections" scope="parent"/>';
    expect(limits(a + b).max).toBe(5);
    expect(limits(b + a).max).toBe(5);
  });
  it('a modifier that sets a max to -1 leaves another real limit in force', () => {
    const a = '<constraint id="a" type="max" value="5" field="selections" scope="parent"/>';
    const b = '<constraint id="b" type="max" value="2" field="selections" scope="parent"/>';
    const lift = mods('<modifier type="set" field="b" value="-1"/>');
    expect(limits(a + b, lift).max).toBe(5);
    expect(limits(b + a, lift).max).toBe(5);
  });
  it('a max of -1 on its own means unlimited', () => {
    expect(limits('<constraint id="a" type="max" value="-1" field="selections" scope="parent"/>').max).toBe(-1);
  });

  describe('room beyond the parent', () => {
    const gun = (scope: string) =>
      unit(
        'u',
        'Squad',
        0,
        children(
          entry('g', 'Gun', 0, cons(`<constraint id="c" type="max" value="1" field="selections" scope="${scope}"/>`)),
        ),
      );

    it('runs out at a force limit', () => {
      const w = world(gun('force'));
      const a = w.add('Squad');
      const b = w.add('Squad');
      const room = () => {
        const ev = w.ev();
        return ev.roomBeyondParent(w.beneath(b, 'Gun'), ev.find(b)!, ev.forces[0]);
      };
      expect(room()).toBe(true);
      w.pick(a, 'Gun');
      expect(room()).toBe(false);
    });
    it('runs out at a roster limit across forces', () => {
      const w = world(gun('roster'));
      const a = w.add('Squad');
      const b = w.add('Squad', 1, w.addForce());
      w.pick(a, 'Gun');
      const ev = w.ev();
      expect(ev.roomBeyondParent(w.beneath(b, 'Gun'), ev.find(b)!, ev.forces[1])).toBe(false);
    });
  });

  it('calls an option with a max of 0 unavailable', () => {
    const eff = (type: string, value: number, field = 'selections') =>
      ({ constraints: [{ type, value, field }] }) as unknown as Eff;
    expect(unavailable(eff('max', 0))).toBe(true);
    expect(unavailable(eff('max', 1))).toBe(false);
    expect(unavailable(eff('min', 0))).toBe(false);
    expect(unavailable(eff('max', 0, 'pts'))).toBe(false);
  });
});

describe('selected', () => {
  it('finds picks made from an option or from anywhere in a group', () => {
    const group = `<selectionEntryGroups><selectionEntryGroup id="grp" name="Weapons">${children(entry('a', 'Axe', 0), entry('b', 'Bow', 0))}</selectionEntryGroup></selectionEntryGroups>`;
    const w = world(unit('u', 'Squad', 0, group));
    const u = w.add('Squad');
    w.pick(u, 'Axe');
    w.pick(u, 'Bow');
    const ev = w.ev();
    const rs = ev.find(u)!;
    const [g] = w.ctx.options(rs.node);
    expect(ev.selected(g, rs, ev.forces[0]).map((s) => s.node.name)).toEqual(['Axe', 'Bow']);
    expect(ev.selected(g.members[0], rs, ev.forces[0]).map((s) => s.node.name)).toEqual(['Axe']);
  });
});

describe('adding a unit fills in what it must have', () => {
  const names = (w: ReturnType<typeof world>, uid: string) =>
    w
      .ev()
      .find(uid)!
      .children.map((c) => `${c.sel.number}x ${c.eff.name}`);
  const group = (inner: string, attrs = '') =>
    `<selectionEntryGroups><selectionEntryGroup id="grp" name="Weapons" ${attrs}>${inner}</selectionEntryGroup></selectionEntryGroups>`;

  it('takes the minimum of a mandatory child', () => {
    const w = world(unit('u', 'Squad', 0, children(entry('m', 'Model', 0, cons(min(5))))));
    expect(names(w, w.add('Squad'))).toEqual(['5x Model']);
  });
  it('leaves optional children alone', () => {
    const w = world(unit('u', 'Squad', 0, children(entry('m', 'Model', 0))));
    expect(names(w, w.add('Squad'))).toEqual([]);
  });
  it('does not exceed a max that is below the min', () => {
    const w = world(unit('u', 'Squad', 0, children(entry('m', 'Model', 0, cons(min(5), max(3))))));
    expect(names(w, w.add('Squad'))).toEqual(['3x Model']);
  });
  it('fills in nested mandatory children', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        children(entry('m', 'Model', 0, cons(min(1)) + children(entry('g', 'Gun', 0, cons(min(1)))))),
      ),
    );
    const u = w.add('Squad');
    expect(
      w
        .ev()
        .find(u)!
        .children[0].children.map((c) => c.eff.name),
    ).toEqual(['Gun']);
  });
  it('skips a hidden mandatory child', () => {
    const w = world(
      unit('u', 'Squad', 0, children(entry('m', 'Model', 0, cons(min(1)), 'type="model" hidden="true"'))),
    );
    expect(names(w, w.add('Squad'))).toEqual([]);
  });
  it('uses the default of a mandatory group', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        group(cons(min(1)) + children(entry('a', 'Axe', 0), entry('b', 'Bow', 9)), 'defaultSelectionEntryId="b"'),
      ),
    );
    expect(names(w, w.add('Squad'))).toEqual(['1x Bow']);
  });
  it('lets a modifier change the default', () => {
    const inner =
      cons(min(1)) +
      mods('<modifier type="set" field="defaultSelectionEntryId" value="a"/>') +
      children(entry('a', 'Axe', 9), entry('b', 'Bow', 1));
    const w = world(unit('u', 'Squad', 0, group(inner, 'defaultSelectionEntryId="b"')));
    expect(names(w, w.add('Squad'))).toEqual(['1x Axe']);
  });
  it('takes the cheapest option after modifiers when there is no default', () => {
    const inner =
      cons(min(1)) +
      children(entry('a', 'Axe', 1, mods('<modifier type="set" field="pts" value="50"/>')), entry('b', 'Bow', 5));
    const w = world(unit('u', 'Squad', 0, group(inner)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Bow']);
  });
  it('fills a group needing several, one at a time, moving on when an option is full', () => {
    const inner = cons(min(2)) + children(entry('a', 'Axe', 1, cons(max(1))), entry('b', 'Bow', 5));
    const w = world(unit('u', 'Squad', 0, group(inner)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Axe', '1x Bow']);
  });
  it('ignores hidden options when picking', () => {
    const inner =
      cons(min(1)) + children(entry('a', 'Axe', 0, '', 'type="upgrade" hidden="true"'), entry('b', 'Bow', 5));
    const w = world(unit('u', 'Squad', 0, group(inner)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Bow']);
  });
  it('reaches into a nested group', () => {
    const nested = `<selectionEntryGroups><selectionEntryGroup id="inner" name="Inner">${children(entry('a', 'Axe', 0))}</selectionEntryGroup></selectionEntryGroups>`;
    const w = world(unit('u', 'Squad', 0, group(cons(min(1)) + nested)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Axe']);
  });
  it('takes a free weapon over a nested group that holds only a paid one', () => {
    const melee = `<selectionEntryGroups><selectionEntryGroup id="melee" name="Melee Weapon" defaultSelectionEntryId="gone">
      <constraints>
        <constraint id="melee-min" type="min" value="1" field="selections" scope="parent"/>
        <constraint id="melee-max" type="max" value="1" field="selections" scope="parent"/>
      </constraints>
      <selectionEntryGroups><selectionEntryGroup id="swap" name="One in five may exchange it for">
        <selectionEntries><selectionEntry id="blade" name="Blade" type="upgrade">
          <constraints>
            <constraint id="blade-cap" type="max" value="1" field="selections" scope="u" shared="true" includeChildSelections="true"/>
          </constraints>
          <costs><cost name="pts" typeId="pts" value="10"/></costs>
        </selectionEntry></selectionEntries>
      </selectionEntryGroup></selectionEntryGroups>
      <entryLinks><entryLink id="axe-link" name="Axe" type="selectionEntry" targetId="axe"/></entryLinks>
    </selectionEntryGroup></selectionEntryGroups>`;
    const guard = entry('m', 'Guard', 40, cons(min(5)) + melee, 'type="model"');
    const w = world(unit('u', 'Squad', 10, children(guard)), {
      cat: `<sharedSelectionEntries>${entry('axe', 'Axe', 0)}</sharedSelectionEntries>`,
    });
    w.add('Squad');
    const model = w.roster.forces[0].selections[0].children[0];
    expect(names(w, model.uid)).toEqual(['1x Axe']);
    expect(w.ev().total).toBe(210); // 10 + 5 x 40
    expect(w.ev().issues).toEqual([]);
  });
  it('prices a nested group by the members it can offer', () => {
    const hiddenFree = entry('f', 'Free', 0, '', 'type="upgrade" hidden="true"');
    const nested = `<selectionEntryGroups><selectionEntryGroup id="inner" name="Inner">${children(hiddenFree, entry('s', 'Sword', 10))}</selectionEntryGroup></selectionEntryGroups>`;
    const w = world(unit('u', 'Squad', 0, group(cons(min(1)) + children(entry('b', 'Bow', 5)) + nested)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Bow']);
  });
  it('compares nested groups by what they hold', () => {
    const inner = (id: string, member: string) =>
      `<selectionEntryGroup id="${id}" name="${id}">${children(member)}</selectionEntryGroup>`;
    const nested = `<selectionEntryGroups>${inner('dear', entry('s', 'Sword', 10))}${inner('cheap', entry('d', 'Dagger', 1))}</selectionEntryGroups>`;
    const w = world(unit('u', 'Squad', 0, group(cons(min(1)) + nested)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Dagger']);
  });
  it('takes the default of each nested group before paying for a second pick from one', () => {
    const melee = `<selectionEntryGroup id="melee" name="Melee" defaultSelectionEntryId="sword">${cons(min(1))}${children(entry('shield', 'Shield', 15), entry('sword', 'Chainsword', 0))}</selectionEntryGroup>`;
    const ranged = `<selectionEntryGroup id="ranged" name="Ranged" defaultSelectionEntryId="pistol">${cons(max(1))}${children(entry('pistol', 'Pistol', 0))}</selectionEntryGroup>`;
    const inner = cons(min(2), max(2)) + `<selectionEntryGroups>${melee}${ranged}</selectionEntryGroups>`;
    const w = world(unit('u', 'Squad', 0, group(inner)));
    expect(names(w, w.add('Squad')).sort()).toEqual(['1x Chainsword', '1x Pistol']);
  });
  it('gives each model the free default of both weapon groups', () => {
    const capped = cons(max(1));
    const melee = `<selectionEntryGroup id="melee" name="Melee" defaultSelectionEntryId="sword">${cons(min(1))}${children(entry('shield', 'Shield', 15, capped), entry('sword', 'Chainsword', 0, capped))}</selectionEntryGroup>`;
    const ranged = `<selectionEntryGroup id="ranged" name="Ranged" defaultSelectionEntryId="pistol">${cons(max(1))}${children(entry('pistol', 'Pistol', 0), entry('bolter', 'Bolter', 0))}</selectionEntryGroup>`;
    const weapons = cons(min(2), max(2)) + `<selectionEntryGroups>${melee}${ranged}</selectionEntryGroups>`;
    const model = entry('m', 'Rider', 40, cons(min(3)) + group(weapons), 'type="model"');
    const w = world(unit('u', 'Squad', 0, children(model)));
    w.add('Squad');
    const rider = w.roster.forces[0].selections[0].children[0];
    expect(names(w, rider.uid).sort()).toEqual(['1x Chainsword', '1x Pistol']);
    expect(w.ev().total).toBe(120); // 3 x 40, both defaults are free
    expect(w.ev().issues).toEqual([]);
  });
  it('respects a limit elsewhere in the force when choosing', () => {
    const limited = entry(
      'a',
      'Axe',
      0,
      cons('<constraint id="c" type="max" value="1" field="selections" scope="force" includeChildSelections="true"/>'),
    );
    const inner = cons(min(1)) + children(limited, entry('b', 'Bow', 5));
    const w = world(unit('u', 'Squad', 0, group(inner)));
    w.add('Squad');
    expect(names(w, w.add('Squad'))).toEqual(['1x Bow']);
  });
  it('re-checks limits after each pick, because a pick can change them', () => {
    const flag = entry('a', 'Armour', 0, cons(min(1)));
    const follow = entry(
      'b',
      'Bonus',
      0,
      cons('<constraint id="b-min" type="min" value="0" field="selections" scope="parent"/>') +
        mods(
          `<modifier type="set" field="b-min" value="1">${conds('<condition type="atLeast" value="1" field="selections" scope="parent" childId="a"/>')}</modifier>`,
        ),
    );
    const w = world(unit('u', 'Squad', 0, children(flag, follow)));
    expect(names(w, w.add('Squad'))).toEqual(['1x Armour', '1x Bonus']);
  });
  it('revisits children, because a later pick can unlock something in an earlier one', () => {
    const sword = entry(
      'sw',
      'Sword',
      0,
      cons('<constraint id="g-min" type="min" value="0" field="selections" scope="parent"/>') +
        mods(
          `<modifier type="set" field="g-min" value="1">${conds('<condition type="atLeast" value="1" field="selections" scope="force" childId="gun" includeChildSelections="true"/>')}</modifier>`,
        ),
    );
    const sarge = entry('s', 'Sergeant', 0, cons(min(1)) + children(sword));
    const trooper = entry('t', 'Trooper', 0, cons(min(1)) + children(entry('gun', 'Gun', 0, cons(min(1)))));
    const w = world(unit('u', 'Squad', 0, children(sarge, trooper)));
    const u = w.add('Squad');
    expect(
      w
        .ev()
        .find(u)!
        .children[0].children.map((c) => c.eff.name),
    ).toEqual(['Sword']);
  });
  it('stops a chain of mandatory entries that links back to itself', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        '<entryLinks><entryLink id="l" targetId="u" type="selectionEntry"><constraints><constraint id="c" type="min" value="1" field="selections" scope="parent"/></constraints></entryLink></entryLinks>',
      ),
    );
    expect(() => w.add('Squad')).not.toThrow();
  });
});

describe('roster edits', () => {
  it('finds a nested selection and removes it', () => {
    const w = world(unit('u', 'Squad', 10, children(entry('g', 'Gun', 5))));
    const u = w.add('Squad');
    const g = w.pick(u, 'Gun');
    expect(locate(w.roster, g)?.sel.uid).toBe(g);
    removeSel(w.roster, g);
    expect(locate(w.roster, g)).toBeNull();
    expect(w.pts(u)).toBe(10);
  });
  it('ignores a selection that does not exist', () => {
    const w = world(unit('u', 'Squad', 10));
    w.add('Squad');
    expect(() => removeSel(w.roster, 'nope')).not.toThrow();
    expect(w.roster.forces[0].selections).toHaveLength(1);
  });
  it('remembers the category a unit was added under', () => {
    const w = world(
      unit('u', 'Squad', 0, '<categoryLinks><categoryLink id="l" targetId="troops" primary="true"/></categoryLinks>'),
    );
    const uid = addedUid(addSel(w.roster, w.contexts, 'f1', null, w.root('Squad'), 1, 'chosen'));
    expect(w.ev().find(uid)!.eff.primary).toBe('chosen');
  });

  describe('an add with nowhere to go', () => {
    const SQUAD = unit(
      'u',
      'Squad',
      0,
      children(entry('b', 'Banner', 0, children(entry('f', 'Flag', 0, cons(min(1)))))),
    );

    it('skips a root unit when its force is not in the roster', () => {
      const w = world(SQUAD);
      expect(addSel(w.roster, w.contexts, 'gone', null, w.root('Squad'))).toBeNull();
      expect(w.roster.forces[0].selections).toEqual([]);
    });

    it('skips an option, and fills in none of its defaults, when its force is not in the roster', () => {
      const w = world(SQUAD);
      const u = w.add('Squad');
      const before = structuredClone(w.roster);
      expect(addSel(w.roster, w.contexts, 'gone', u, w.beneath(u, 'Banner'))).toBeNull();
      expect(w.roster).toEqual(before);
    });

    it('skips an option when its parent is not in the roster', () => {
      const w = world(SQUAD);
      const u = w.add('Squad');
      const banner = w.beneath(u, 'Banner');
      const before = structuredClone(w.roster);
      expect(addSel(w.roster, w.contexts, 'f1', 'gone', banner)).toBeNull();
      expect(w.roster).toEqual(before);
    });
  });
});

describe('ctxFor', () => {
  it('fails with a message a player can act on when the army has no context', () => {
    const w = world('');
    const force = { ...w.roster.forces[0], catalogueId: 'gone' };
    expect(() => w.ev().ctxFor(force)).toThrow('This army is no longer in the synced data');
  });
});

describe('defaultMember', () => {
  const opt = (id: string, extra: Partial<Opt['node']> = {}, kind: Opt['kind'] = 'entry') =>
    ({ key: `grp/${id}`, kind, members: [], groupIds: [], node: { id, ...extra } }) as unknown as Opt;
  const g = (defaultSelectionEntryId?: string) => ({ node: { defaultSelectionEntryId } }) as unknown as Opt;

  it('finds the default by id, link id, or key', () => {
    const [a, b] = [opt('a'), opt('b', { linkId: 'link-b' })];
    expect(defaultMember(g('a'), [a, b])).toBe(a);
    expect(defaultMember(g('link-b'), [a, b])).toBe(b);
    expect(defaultMember(g(), [a, b], false, 'b')).toBe(b);
  });
  it('falls back to a nested group that has a default', () => {
    const nested = opt('n', { defaultSelectionEntryId: 'x' }, 'group');
    expect(defaultMember(g(), [opt('a'), nested])).toBe(nested);
  });
  it('falls back to the first, unless strict', () => {
    const a = opt('a');
    expect(defaultMember(g(), [a])).toBe(a);
    expect(defaultMember(g(), [a], true)).toBeUndefined();
  });
  it('falls through when the default is hidden', () => {
    const a = opt('a');
    expect(defaultMember(g('hidden'), [a], true)).toBeUndefined();
  });
});

describe('profiles and rules for display', () => {
  const stat = (name: string, attrs: string, mod = '') =>
    `<profiles><profile id="p-${name}" name="${name}" typeId="t" typeName="Unit" ${attrs}><characteristics><characteristic name="Move" typeId="mv">6"</characteristic><characteristic name="Save" typeId="sv">3+</characteristic></characteristics>${mod}</profile></profiles>`;
  const rule = (name: string, attrs = '', mod = '') =>
    `<rules><rule id="r-${name}" name="${name}" ${attrs}><description>Text of ${name}</description>${mod}</rule></rules>`;
  const shared = `<sharedProfiles><profile id="sp" name="Shared Stat" typeId="t" typeName="Unit"><characteristics><characteristic name="Move" typeId="mv">8"</characteristic></characteristics></profile></sharedProfiles>
    <sharedRules><rule id="sr" name="Shared Rule"><description>Shared text</description></rule></sharedRules>`;
  const profilesOf = (inner: string, o = {}) => {
    const w = world(unit('u', 'Squad', 0, inner), o);
    const u = w.add('Squad');
    const ev = w.ev();
    return ev.profilesFor(ev.find(u)!);
  };
  const rulesOf = (inner: string, o = {}) => {
    const w = world(unit('u', 'Squad', 0, inner), o);
    const u = w.add('Squad');
    const ev = w.ev();
    return ev.rulesFor(ev.find(u)!);
  };

  it("lists a unit's profiles and those of its selected children", () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        stat('A', '') +
          children(entry('g', 'Gun', 0, cons(min(1)) + stat('B', '')), entry('z', 'Spare', 0, stat('C', ''))),
      ),
    );
    const u = w.add('Squad');
    const ev = w.ev();
    expect(ev.profilesFor(ev.find(u)!).map((p) => p.name)).toEqual(['A', 'B']);
  });
  it('shows a repeated profile once', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        children(
          entry('g', 'Gun', 0, cons(min(1)) + stat('A', '')),
          entry('h', 'Gun2', 0, cons(min(1)) + stat('A', '')),
        ),
      ),
    );
    const u = w.add('Squad');
    const ev = w.ev();
    expect(ev.profilesFor(ev.find(u)!)).toHaveLength(1);
  });
  it('leaves out hidden profiles', () => {
    expect(profilesOf(stat('A', 'hidden="true"'))).toEqual([]);
  });
  it('follows profile links, using the link name and the hidden flag on either side', () => {
    const link = (attrs: string) => `<infoLinks><infoLink id="il" targetId="sp" type="profile" ${attrs}/></infoLinks>`;
    expect(profilesOf(link('name="Renamed"'), { cat: shared }).map((p) => p.name)).toEqual(['Renamed']);
    expect(profilesOf(link('name="" hidden="true"'), { cat: shared })).toEqual([]);
  });
  it('skips a link to a profile that does not exist, and links of other types', () => {
    expect(
      profilesOf(
        '<infoLinks><infoLink id="il" targetId="nope" type="profile"/><infoLink id="i2" targetId="sr" type="rule"/></infoLinks>',
        { cat: shared },
      ),
    ).toEqual([]);
  });
  it('applies modifiers to characteristics', () => {
    const p = (m: string) =>
      profilesOf(stat('A', '', mods(m)))[0].characteristics.find((c) => c.typeId === 'sv')!.value;
    expect(p('<modifier type="set" field="sv" value="2+"/>')).toBe('2+');
    expect(p('<modifier type="append" field="sv" value="(invuln)"/>')).toBe('3+ (invuln)');
    expect(p('<modifier type="increment" field="sv" value="1"/>')).toBe('4+');
    expect(p('<modifier type="decrement" field="sv" value="1"/>')).toBe('2+');
  });
  it('leaves a characteristic with no number alone when incrementing', () => {
    const noNum = `<profiles><profile id="p" name="A" typeId="t"><characteristics><characteristic name="X" typeId="x">-</characteristic></characteristics><modifiers><modifier type="increment" field="x" value="1"/></modifiers></profile></profiles>`;
    expect(profilesOf(noNum)[0].characteristics[0].value).toBe('-');
  });
  it('modifies a profile name, hides it, and ignores unknown fields', () => {
    expect(profilesOf(stat('A', '', mods('<modifier type="set" field="name" value="B"/>')))[0].name).toBe('B');
    expect(profilesOf(stat('A', '', mods('<modifier type="append" field="name" value="II"/>')))[0].name).toBe('A II');
    expect(profilesOf(stat('A', '', mods('<modifier type="set" field="hidden" value="true"/>')))).toEqual([]);
    expect(profilesOf(stat('A', '', mods('<modifier type="set" field="nope" value="1"/>')))).toHaveLength(1);
  });
  it('does not change the shared profile when modifying', () => {
    const w = world(unit('u', 'Squad', 0, stat('A', '', mods('<modifier type="set" field="sv" value="2+"/>'))));
    const u = w.add('Squad');
    const ev = w.ev();
    ev.profilesFor(ev.find(u)!);
    expect(ev.find(u)!.node.profiles[0].characteristics[1].value).toBe('3+');
  });
  it('skips a modifier on a profile when its condition fails', () => {
    const m = mods(
      `<modifier type="set" field="sv" value="2+">${conds('<condition type="atLeast" value="1" field="selections" scope="force" childId="nope"/>')}</modifier>`,
    );
    expect(profilesOf(stat('A', '', m))[0].characteristics[1].value).toBe('3+');
  });

  it('lists rules, once each by name, from selected children too', () => {
    const w = world(
      unit(
        'u',
        'Squad',
        0,
        rule('A') +
          children(entry('g', 'Gun', 0, cons(min(1)) + rule('A')), entry('h', 'Hat', 0, cons(min(1)) + rule('B'))),
      ),
    );
    const u = w.add('Squad');
    const ev = w.ev();
    expect(ev.rulesFor(ev.find(u)!).map((r) => r.name)).toEqual(['A', 'B']);
  });
  it('leaves out hidden rules', () => {
    expect(rulesOf(rule('A', 'hidden="true"'))).toEqual([]);
  });
  it('follows rule links, using the link name', () => {
    const rs = rulesOf(
      '<infoLinks><infoLink id="il" name="Renamed" targetId="sr" type="rule"/><infoLink id="i2" targetId="nope" type="rule"/><infoLink id="i3" targetId="sp" type="profile"/></infoLinks>',
      { cat: shared },
    );
    expect(rs.map((r) => r.name)).toEqual(['Renamed']);
    expect(rs[0].description).toBe('Shared text');
  });
  it('applies modifiers to a rule', () => {
    const r = (m: string) => rulesOf(rule('A', '', mods(m)))[0];
    expect(r('<modifier type="set" field="name" value="B"/>').name).toBe('B');
    expect(r('<modifier type="append" field="name" value="(1)"/>').name).toBe('A (1)');
    expect(r('<modifier type="set" field="description" value="New"/>').description).toBe('New');
    expect(r('<modifier type="append" field="description" value="More"/>').description).toBe('Text of A More');
    expect(rulesOf(rule('A', '', mods('<modifier type="set" field="hidden" value="true"/>')))).toEqual([]);
  });
  it('can reveal a hidden rule with a modifier', () => {
    expect(
      rulesOf(rule('A', 'hidden="true"', mods('<modifier type="set" field="hidden" value="false"/>'))),
    ).toHaveLength(1);
  });
});

describe('fmt', () => {
  it('shows whole numbers plainly and others to one place', () => {
    expect(fmt(20)).toBe('20');
    expect(fmt(12.25)).toBe('12.3');
    expect(fmt(0)).toBe('0');
  });
});
