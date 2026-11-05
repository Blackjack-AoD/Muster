// One test for each common shape of data. Each states what the shape means, in the XML the data uses.
import { describe, expect, it } from 'vitest';
import { removeSel } from './engine';
import { TWO_FORCES, children, conds, cons, entry, mods, unit, world } from '../test/fixture';

/** 10 points more while every condition holds. */
const plusTen = (...c: string[]) => mods(`<modifier type="increment" field="pts" value="10">${conds(...c)}</modifier>`);
/** 5 points more for each time the repeat counts. */
const plusFiveEach = (repeat: string) =>
  mods(`<modifier type="increment" field="pts" value="5"><repeats>${repeat}</repeats></modifier>`);

const model = (id: string, name: string, inner = '') => entry(id, name, 0, inner, 'type="model"');
const category = (id: string) => `<categoryLinks><categoryLink id="l-${id}" targetId="${id}"/></categoryLinks>`;

const TOKEN = `<sharedSelectionEntries>${entry('x', 'Token')}</sharedSelectionEntries>`;
/** A link to the shared Token, so one entry can sit at several depths, as linked wargear does. */
const token = (linkId: string, inner = '') =>
  `<entryLink id="${linkId}" name="Token" targetId="x" type="selectionEntry">${inner}</entryLink>`;
const tokenIn = (linkId: string) => `<entryLinks>${token(linkId)}</entryLinks>`;

type World = ReturnType<typeof world>;

const hiddenBeneath = (w: World, parentUid: string, name: string) => {
  const ev = w.ev();
  const rs = ev.find(parentUid);
  if (!rs) throw new Error(`no selection ${parentUid}`);
  return ev.optionEff(w.beneath(parentUid, name), rs, rs.force).hidden;
};

describe('conditions counting inside the selection itself', () => {
  const rank = (n: string) => `<modifier type="append" field="name" value="(${n})">`;
  const RANKS = mods(
    `${rank('Battle-ready')}${conds('<condition type="atMost" value="5" field="selections" scope="self" childId="xp" includeChildSelections="true"/>')}</modifier>`,
    `${rank('Blooded')}${conds(
      '<condition type="greaterThan" value="5" field="selections" scope="self" childId="xp" includeChildSelections="true"/>',
      '<condition type="atMost" value="15" field="selections" scope="self" childId="xp" includeChildSelections="true"/>',
    )}</modifier>`,
  );
  const ranked = () =>
    world(unit('s', 'Squad', 0, RANKS + children(entry('m', 'Model', 0, children(entry('xp', 'XP'))))));

  it.each([
    [1, 'Squad (Battle-ready)'],
    [5, 'Squad (Battle-ready)'],
    [6, 'Squad (Blooded)'],
    [15, 'Squad (Blooded)'],
    [16, 'Squad'],
  ])('reads a rank from %i points of experience nested in the unit', (xp, name) => {
    const w = ranked();
    const s = w.add('Squad');
    w.pick(w.pick(s, 'Model'), 'XP', xp);
    expect(w.sel(s).eff.name).toBe(name);
  });

  it('multiplies by the number of the selections in between', () => {
    const w = ranked();
    const s = w.add('Squad');
    w.pick(w.pick(s, 'Model', 2), 'XP', 3);
    expect(w.sel(s).eff.name).toBe('Squad (Blooded)');
  });

  describe('atLeast', () => {
    const veteran = () =>
      world(
        unit(
          's',
          'Squad',
          10,
          plusTen(
            '<condition type="atLeast" value="1" field="selections" scope="self" childId="vet" includeChildSelections="true"/>',
          ) + children(entry('m', 'Model', 0, children(entry('vet', 'Veteran')))),
        ),
      );

    it('sees a nested pick in this selection and not in another', () => {
      const w = veteran();
      const a = w.add('Squad');
      const b = w.add('Squad');
      w.pick(w.pick(b, 'Model'), 'Veteran');
      expect(w.pts(a)).toBe(10);
      expect(w.pts(b)).toBe(20);
    });

    it('holds nothing for an option not yet taken', () => {
      const w = veteran();
      const b = w.add('Squad');
      w.pick(w.pick(b, 'Model'), 'Veteran');
      const ev = w.ev();
      expect(ev.optionEff(w.root('Squad'), null, ev.forces[0]).costs.get('pts')).toBe(10);
    });
  });
});

describe('conditions and repeats scoped to an entry id', () => {
  /** Squad holds a Marker carrying the modifier, a Token, and a Sergeant holding a Token. */
  const squad = (modifiers: string) =>
    world(
      unit(
        'squad',
        'Squad',
        0,
        children(entry('mark', 'Marker', 0, modifiers), entry('sgt', 'Sergeant', 0, tokenIn('l-deep'))) +
          tokenIn('l-top'),
      ),
      { cat: TOKEN },
    );
  const fresh = (modifiers: string) => {
    const w = squad(modifiers);
    const s = w.add('Squad');
    return { w, s, mark: w.pick(s, 'Marker'), sgt: w.pick(s, 'Sergeant') };
  };

  it('equalTo with children counts both depths of the named ancestor', () => {
    const { w, s, mark, sgt } = fresh(
      plusTen(
        '<condition type="equalTo" value="2" field="selections" scope="squad" childId="x" includeChildSelections="true"/>',
      ),
    );
    w.pick(s, 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(sgt, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('equalTo without children counts only what sits directly in the ancestor', () => {
    const { w, s, mark, sgt } = fresh(
      plusTen('<condition type="equalTo" value="1" field="selections" scope="squad" childId="x"/>'),
    );
    w.pick(sgt, 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(s, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('greaterThan with children reads the nearest such ancestor, not another copy of it', () => {
    const { w, mark, sgt } = fresh(
      plusTen(
        '<condition type="greaterThan" value="0" field="selections" scope="squad" childId="x" includeChildSelections="true"/>',
      ),
    );
    w.pick(w.pick(w.add('Squad'), 'Sergeant'), 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(sgt, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('atLeast with children multiplies by the number of the selections in between', () => {
    const { w, s, mark } = fresh(
      plusTen(
        '<condition type="atLeast" value="3" field="selections" scope="squad" childId="x" includeChildSelections="true"/>',
      ),
    );
    const sgts = w.pick(s, 'Sergeant', 2);
    w.pick(sgts, 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(s, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('a repeat counts direct picks in the ancestor and rounds down', () => {
    const { w, s, mark, sgt } = fresh(
      plusFiveEach('<repeat value="2" repeats="1" field="selections" scope="squad" childId="x"/>'),
    );
    w.pick(sgt, 'Token', 2);
    expect(w.pts(mark)).toBe(0);
    w.pick(s, 'Token', 3);
    expect(w.pts(mark)).toBe(5);
  });

  it('a repeat with children counts models at any depth by their type', () => {
    const w = world(
      unit(
        'squad',
        'Squad',
        0,
        children(
          entry(
            'mark',
            'Marker',
            0,
            plusFiveEach(
              '<repeat value="2" repeats="1" field="selections" scope="squad" childId="model" includeChildSelections="true"/>',
            ),
          ),
          model('sgt', 'Sergeant'),
          entry('team', 'Team', 0, children(model('tr', 'Trooper'))),
        ),
      ),
    );
    const s = w.add('Squad');
    const mark = w.pick(s, 'Marker');
    w.pick(s, 'Sergeant');
    w.pick(w.pick(s, 'Team'), 'Trooper', 4);
    expect(w.pts(mark)).toBe(10);
  });
});

describe('conditions on the detachment', () => {
  const inForce = (condition: string) => {
    const w = world(unit('u', 'Unit', 10, plusTen(condition)), { gst: TWO_FORCES });
    const here = w.add('Unit');
    const there = w.add('Unit', 1, w.addForce('f2', 'ally'));
    return { w, here, there };
  };
  /** Watcher costs 10 and carries the modifier; Carrier can hold a Token. */
  const watching = (condition: string) => {
    const w = world(unit('w', 'Watcher', 10, plusTen(condition)) + unit('c', 'Carrier', 0, tokenIn('l')), {
      cat: TOKEN,
      gst: TWO_FORCES,
    });
    const watcher = w.add('Watcher');
    const ally = w.addForce('f2', 'ally');
    return { w, watcher, ally };
  };

  it('instanceOf asks what type of detachment the entry is in', () => {
    const { w, here, there } = inForce(
      '<condition type="instanceOf" value="1" field="selections" scope="force" childId="det" includeChildSelections="true"/>',
    );
    expect(w.pts(here)).toBe(20);
    expect(w.pts(there)).toBe(10);
  });

  it('notInstanceOf is the opposite', () => {
    const { w, here, there } = inForce(
      '<condition type="notInstanceOf" value="1" field="selections" scope="force" childId="det" includeChildSelections="true"/>',
    );
    expect(w.pts(here)).toBe(10);
    expect(w.pts(there)).toBe(20);
  });

  it('greaterThan with children finds a nested pick in this detachment only', () => {
    const { w, watcher, ally } = watching(
      '<condition type="greaterThan" value="0" field="selections" scope="force" childId="x" includeChildSelections="true"/>',
    );
    w.pick(w.add('Carrier', 1, ally), 'Token');
    expect(w.pts(watcher)).toBe(10);
    w.pick(w.add('Carrier'), 'Token');
    expect(w.pts(watcher)).toBe(20);
  });

  it('lessThan with children stops holding once a nested pick is in this detachment', () => {
    const { w, watcher, ally } = watching(
      '<condition type="lessThan" value="1" field="selections" scope="force" childId="x" includeChildSelections="true"/>',
    );
    w.pick(w.add('Carrier', 1, ally), 'Token');
    expect(w.pts(watcher)).toBe(20);
    w.pick(w.add('Carrier'), 'Token');
    expect(w.pts(watcher)).toBe(10);
  });
});

describe('conditions on the whole list', () => {
  const watching = (condition: string, carried = tokenIn('l')) => {
    const w = world(unit('w', 'Watcher', 10, plusTen(condition)) + unit('c', 'Carrier', 0, carried), {
      cat: TOKEN,
      gst: TWO_FORCES,
    });
    const watcher = w.add('Watcher');
    const ally = w.addForce('f2', 'ally');
    return { w, watcher, ally };
  };

  it('lessThan with children sees a nested pick in another detachment', () => {
    const { w, watcher, ally } = watching(
      '<condition type="lessThan" value="1" field="selections" scope="roster" childId="x" includeChildSelections="true"/>',
    );
    w.add('Carrier', 1, ally);
    expect(w.pts(watcher)).toBe(20);
    w.pick(w.add('Carrier', 1, ally), 'Token');
    expect(w.pts(watcher)).toBe(10);
  });

  it('greaterThan with children sees a nested pick in another detachment', () => {
    const { w, watcher, ally } = watching(
      '<condition type="greaterThan" value="0" field="selections" scope="roster" childId="x" includeChildSelections="true"/>',
    );
    w.add('Carrier', 1, ally);
    expect(w.pts(watcher)).toBe(10);
    w.pick(w.add('Carrier', 1, ally), 'Token');
    expect(w.pts(watcher)).toBe(20);
  });

  it('greaterThan on a force entry id counts detachments of that type', () => {
    const w = world(
      unit(
        'w',
        'Watcher',
        10,
        plusTen(
          '<condition type="greaterThan" value="0" field="selections" scope="roster" childId="ally" includeChildSelections="true"/>',
        ),
      ),
      { gst: TWO_FORCES },
    );
    const watcher = w.add('Watcher');
    expect(w.pts(watcher)).toBe(10);
    w.addForce('f2', 'ally');
    expect(w.pts(watcher)).toBe(20);
  });

  it('atLeast with children adds up every detachment', () => {
    const { w, watcher, ally } = watching(
      '<condition type="atLeast" value="2" field="selections" scope="roster" childId="x" includeChildSelections="true"/>',
    );
    w.pick(w.add('Carrier'), 'Token');
    expect(w.pts(watcher)).toBe(10);
    w.pick(w.add('Carrier', 1, ally), 'Token');
    expect(w.pts(watcher)).toBe(20);
  });

  it('equalTo with children counts nested picks in a category, and only that many', () => {
    const { w, watcher } = watching(
      '<condition type="equalTo" value="1" field="selections" scope="roster" childId="elite" includeChildSelections="true"/>',
      children(entry('g', 'Elite Gear', 0, category('elite'))),
    );
    w.pick(w.add('Carrier'), 'Elite Gear');
    expect(w.pts(watcher)).toBe(20);
    w.pick(w.add('Carrier'), 'Elite Gear');
    expect(w.pts(watcher)).toBe(10);
  });

  it('atLeast on forces counts detachments of that type anywhere in the list', () => {
    const w = world(
      unit(
        'u',
        'Unit',
        10,
        plusTen(
          '<condition type="atLeast" value="1" field="forces" scope="roster" childId="ally" includeChildSelections="true" includeChildForces="true"/>',
        ),
      ),
      { gst: TWO_FORCES },
    );
    const u = w.add('Unit');
    expect(w.pts(u)).toBe(10);
    w.addForce('f2', 'ally');
    expect(w.pts(u)).toBe(20);
  });

  it('lessThan on forces stops holding once a detachment of that type joins', () => {
    const w = world(
      unit(
        'u',
        'Unit',
        10,
        plusTen(
          '<condition type="lessThan" value="1" field="forces" scope="roster" childId="ally" includeChildSelections="true" includeChildForces="true"/>',
        ),
      ),
      { gst: TWO_FORCES },
    );
    const u = w.add('Unit');
    expect(w.pts(u)).toBe(20);
    w.addForce('f2', 'ally');
    expect(w.pts(u)).toBe(10);
  });
});

describe('conditions scoped to the parent', () => {
  /** Squad holds a Marker carrying the modifier, a Token, and a Buddy holding a Token. */
  const fresh = (modifiers: string) => {
    const w = world(
      unit(
        's',
        'Squad',
        0,
        children(entry('mark', 'Marker', 0, modifiers), entry('b', 'Buddy', 0, tokenIn('l-deep'))) + tokenIn('l-top'),
      ),
      { cat: TOKEN },
    );
    const s = w.add('Squad');
    return { w, s, mark: w.pick(s, 'Marker'), buddy: w.pick(s, 'Buddy') };
  };

  it('lessThan with children stops holding on a pick nested in a sibling', () => {
    const { w, mark, buddy } = fresh(
      plusTen(
        '<condition type="lessThan" value="1" field="selections" scope="parent" childId="x" includeChildSelections="true"/>',
      ),
    );
    expect(w.pts(mark)).toBe(10);
    w.pick(buddy, 'Token');
    expect(w.pts(mark)).toBe(0);
  });

  it('lessThan with children ignores another unit', () => {
    const { w, mark } = fresh(
      plusTen(
        '<condition type="lessThan" value="1" field="selections" scope="parent" childId="x" includeChildSelections="true"/>',
      ),
    );
    w.pick(w.pick(w.add('Squad'), 'Buddy'), 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('equalTo with children counts both depths', () => {
    const { w, s, mark, buddy } = fresh(
      plusTen(
        '<condition type="equalTo" value="2" field="selections" scope="parent" childId="x" includeChildSelections="true"/>',
      ),
    );
    w.pick(s, 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(buddy, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('equalTo without children counts direct picks only', () => {
    const { w, s, mark, buddy } = fresh(
      plusTen('<condition type="equalTo" value="1" field="selections" scope="parent" childId="x"/>'),
    );
    w.pick(buddy, 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(s, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('greaterThan with children sees a pick nested in a sibling', () => {
    const { w, mark, buddy } = fresh(
      plusTen(
        '<condition type="greaterThan" value="0" field="selections" scope="parent" childId="x" includeChildSelections="true"/>',
      ),
    );
    expect(w.pts(mark)).toBe(0);
    w.pick(buddy, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('atLeast with children adds up both depths', () => {
    const { w, s, mark, buddy } = fresh(
      plusTen(
        '<condition type="atLeast" value="2" field="selections" scope="parent" childId="x" includeChildSelections="true"/>',
      ),
    );
    w.pick(s, 'Token');
    expect(w.pts(mark)).toBe(0);
    w.pick(buddy, 'Token');
    expect(w.pts(mark)).toBe(10);
  });

  it('at the root of a detachment, the parent is that detachment', () => {
    const w = world(
      unit(
        'w',
        'Watcher',
        10,
        plusTen(
          '<condition type="atLeast" value="1" field="selections" scope="parent" childId="x" includeChildSelections="true"/>',
        ),
      ) + unit('c', 'Carrier', 0, tokenIn('l')),
      { cat: TOKEN, gst: TWO_FORCES },
    );
    const watcher = w.add('Watcher');
    w.pick(w.add('Carrier', 1, w.addForce('f2', 'ally')), 'Token');
    expect(w.pts(watcher)).toBe(10);
    w.pick(w.add('Carrier'), 'Token');
    expect(w.pts(watcher)).toBe(20);
  });

  describe('notInstanceOf', () => {
    const GUN = entry(
      'g',
      'Gun',
      0,
      mods(
        `<modifier type="set" field="hidden" value="true">${conds('<condition type="notInstanceOf" value="1" field="selections" scope="parent" childId="inf"/>')}</modifier>`,
      ),
    );
    const armoury = () =>
      world(
        unit('i', 'Infantry', 0, category('inf') + children(GUN, entry('m', 'Model', 0, children(GUN)))) +
          unit('v', 'Vehicle', 0, children(GUN)),
      );

    it('holds when the parent lacks the category', () => {
      const w = armoury();
      expect(hiddenBeneath(w, w.add('Infantry'), 'Gun')).toBe(false);
      expect(hiddenBeneath(w, w.add('Vehicle'), 'Gun')).toBe(true);
    });

    it('looks at the parent alone, not further up', () => {
      const w = armoury();
      expect(hiddenBeneath(w, w.pick(w.add('Infantry'), 'Model'), 'Gun')).toBe(true);
    });
  });
});

describe('conditions on any ancestor', () => {
  const nested = (condition: string) => {
    const w = world(
      unit(
        'i',
        'Infantry',
        0,
        category('inf') + children(entry('m', 'Model', 0, children(entry('g', 'Gun', 0, plusTen(condition))))),
      ) + unit('v', 'Vehicle', 0, children(entry('m', 'Model', 0, children(entry('g', 'Gun', 0, plusTen(condition)))))),
      { gst: TWO_FORCES },
    );
    const gunIn = (name: string, forceUid = 'f1') => w.pick(w.pick(w.add(name, 1, forceUid), 'Model'), 'Gun');
    return { w, gunIn };
  };

  it('instanceOf finds a category two levels up', () => {
    const { w, gunIn } = nested(
      '<condition type="instanceOf" value="1" field="selections" scope="ancestor" childId="inf" includeChildSelections="true"/>',
    );
    expect(w.pts(gunIn('Infantry'))).toBe(10);
    expect(w.pts(gunIn('Vehicle'))).toBe(0);
  });

  it('instanceOf reaches past the root to the type of detachment', () => {
    const { w, gunIn } = nested(
      '<condition type="instanceOf" value="1" field="selections" scope="ancestor" childId="det" includeChildSelections="true"/>',
    );
    expect(w.pts(gunIn('Vehicle'))).toBe(10);
    expect(w.pts(gunIn('Vehicle', w.addForce('f2', 'ally')))).toBe(0);
  });

  it('notInstanceOf holds only when no ancestor has the category', () => {
    const { w, gunIn } = nested(
      '<condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="inf" includeChildSelections="true"/>',
    );
    expect(w.pts(gunIn('Infantry'))).toBe(0);
    expect(w.pts(gunIn('Vehicle'))).toBe(10);
  });
});

describe('selection limits with child selections', () => {
  const MAX_PARENT =
    '<constraint id="c" type="max" value="1" field="selections" scope="parent" includeChildSelections="true"/>';
  const MIN_PARENT =
    '<constraint id="c" type="min" value="1" field="selections" scope="parent" includeChildSelections="true"/>';
  const MIN_FORCE =
    '<constraint id="c" type="min" value="1" field="selections" scope="force" includeChildSelections="true"/>';
  const MIN_ROSTER =
    '<constraint id="c" type="min" value="1" field="selections" scope="roster" includeChildSelections="true"/>';

  /** A Token at the root, carrying the limit, and a Carrier that can hold another. */
  const rootToken = (limit: string) =>
    world(unit('c', 'Carrier', 0, tokenIn('l-nested')), {
      cat: `${TOKEN}<entryLinks>${token('l-root', cons(limit))}</entryLinks>`,
      gst: TWO_FORCES,
    });

  it('a max scoped to the parent caps a child within its parent', () => {
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
            cons(
              '<constraint id="c" type="max" value="2" field="selections" scope="parent" includeChildSelections="true"/>',
            ),
          ),
        ),
      ),
    );
    w.pick(w.add('Squad'), 'Gun', 2);
    expect(w.errors()).toEqual([]);
    w.pick(w.add('Squad'), 'Gun', 3);
    expect(w.errors()).toEqual(['Squad › Gun: at most 2 allowed (has 3)']);
  });

  it('a max scoped to the parent at the root counts copies nested in other units', () => {
    const w = rootToken(MAX_PARENT);
    w.add('Token');
    expect(w.errors()).toEqual([]);
    w.pick(w.add('Carrier'), 'Token');
    expect(w.errors()).toEqual(['Token: at most 1 allowed (has 2)']);
  });

  it('a min scoped to the parent asks for a child that was removed', () => {
    const w = world(unit('s', 'Squad', 0, children(entry('g', 'Gun', 0, cons(MIN_PARENT)))));
    const s = w.add('Squad');
    expect(w.errors()).toEqual([]);
    removeSel(w.roster, w.sel(s).children[0].sel.uid);
    expect(w.errors()).toEqual(['Squad › Gun: needs at least 1 (has 0)']);
  });

  it('a min scoped to the parent at the root is met by a nested copy', () => {
    const w = rootToken(MIN_PARENT);
    expect(w.errors()).toEqual(['Token: needs at least 1 (has 0)']);
    w.pick(w.add('Carrier'), 'Token');
    expect(w.errors()).toEqual([]);
  });

  it('a min on the list is met by a nested copy in any detachment', () => {
    const w = rootToken(MIN_ROSTER);
    expect(w.errors()).toEqual(['Token: needs at least 1 in the list (has 0)']);
    w.pick(w.add('Carrier', 1, w.addForce('f2', 'ally')), 'Token');
    expect(w.errors()).toEqual([]);
  });

  it('a min on the detachment is not met by a copy in another detachment', () => {
    const w = rootToken(MIN_FORCE);
    w.pick(w.add('Carrier', 1, w.addForce('f2', 'ally')), 'Token');
    expect(w.errors()).toEqual(['Token: needs at least 1 in this detachment (has 0)']);
    w.pick(w.add('Carrier'), 'Token');
    expect(w.errors()).toEqual([]);
  });

  it('a min on a category link counts entries of that category nested in a unit', () => {
    const w = world(unit('c', 'Carrier', 0, children(entry('t', 'Trooper', 0, category('tr')))), {
      gst: `<categoryEntries><categoryEntry id="tr" name="Troops"/></categoryEntries>
        <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks>
          <categoryLink id="l-tr" name="Troops" targetId="tr"><constraints>
            <constraint id="c" type="min" value="1" field="selections" scope="force" includeChildSelections="true"/>
          </constraints></categoryLink>
        </categoryLinks></forceEntry></forceEntries>`,
    });
    const c = w.add('Carrier');
    expect(w.errors()).toEqual(['Troops: needs at least 1 in this detachment (has 0)']);
    w.pick(c, 'Trooper');
    expect(w.errors()).toEqual([]);
  });
});

describe('points limits with child selections', () => {
  const squad = (limit: string) => world(unit('s', 'Squad', 100, cons(limit) + children(entry('g', 'Gear', 50))));

  it('a max on an entry weighs it with what it holds', () => {
    const w = squad(
      '<constraint id="c" type="max" value="120" field="pts" scope="parent" includeChildSelections="true"/>',
    );
    const s = w.add('Squad');
    expect(w.errors()).toEqual([]);
    w.pick(s, 'Gear');
    expect(w.errors()).toEqual(['Squad: at most 120 pts allowed (has 150)']);
  });

  it('a max of -1 sets no limit', () => {
    const w = squad(
      '<constraint id="c" type="max" value="-1" field="pts" scope="parent" includeChildSelections="true"/>',
    );
    w.add('Squad');
    expect(w.errors()).toEqual([]);
  });

  it('a max of 0 on a category link allows no points in that category', () => {
    const w = world(unit('h', 'Hero', 50, category('hq')) + unit('o', 'Other', 50), {
      gst: `<categoryEntries><categoryEntry id="hq" name="HQ"/></categoryEntries>
        <forceEntries><forceEntry id="det" name="Detachment"><categoryLinks>
          <categoryLink id="l-hq" name="HQ" targetId="hq"><constraints>
            <constraint id="c" type="max" value="0" field="pts" scope="parent" includeChildSelections="true"/>
          </constraints></categoryLink>
        </categoryLinks></forceEntry></forceEntries>`,
    });
    w.add('Other');
    expect(w.errors()).toEqual([]);
    w.add('Hero');
    expect(w.errors()).toEqual(['HQ: at most 0 pts allowed (has 50)']);
  });

  it('a min on an entry is met by what it holds', () => {
    const w = squad(
      '<constraint id="c" type="min" value="120" field="pts" scope="parent" includeChildSelections="true"/>',
    );
    const s = w.add('Squad');
    expect(w.errors()).toEqual(['Squad: needs at least 120 pts (has 100)']);
    w.pick(s, 'Gear');
    expect(w.errors()).toEqual([]);
  });

  it('a min of 0 asks for nothing', () => {
    const w = squad(
      '<constraint id="c" type="min" value="0" field="pts" scope="parent" includeChildSelections="true"/>',
    );
    expect(w.errors()).toEqual([]);
  });
});

describe('selection limits scoped to an entry id', () => {
  const armoury = (vox: string) =>
    world(unit('squad', 'Squad', 0, children(entry('m', 'Model', 0, children(entry('v', 'Vox', 0, vox))))));
  const MAX_ONE = cons(
    '<constraint id="c" type="max" value="1" field="selections" scope="squad" includeChildSelections="true"/>',
  );

  it('caps picks across every model in the unit', () => {
    const w = armoury(MAX_ONE);
    const s = w.add('Squad');
    w.pick(w.pick(s, 'Model'), 'Vox');
    expect(w.errors()).toEqual([]);
    w.pick(w.pick(s, 'Model'), 'Vox');
    expect(w.errors()).toEqual(['Vox: at most 1 allowed (has 2)']);
  });

  it('puts the error on the unit, not on each model', () => {
    const w = armoury(MAX_ONE);
    const s = w.add('Squad');
    w.pick(w.pick(s, 'Model'), 'Vox');
    w.pick(w.pick(s, 'Model'), 'Vox');
    expect(w.ev().issues.map((i) => i.selUid)).toEqual([s]);
  });

  it('gives each unit its own cap', () => {
    const w = armoury(MAX_ONE);
    w.pick(w.pick(w.add('Squad'), 'Model'), 'Vox');
    w.pick(w.pick(w.add('Squad'), 'Model'), 'Vox');
    expect(w.errors()).toEqual([]);
  });

  it('gives each unit over the cap its own issue', () => {
    const w = armoury(MAX_ONE);
    const voxTwice = () => {
      const s = w.add('Squad');
      w.pick(w.pick(s, 'Model'), 'Vox');
      w.pick(w.pick(s, 'Model'), 'Vox');
      return s;
    };
    const [first, second] = [voxTwice(), voxTwice()];
    expect(w.ev().issues.map((i) => i.selUid)).toEqual([first, second]);
  });

  it('sets no limit on an option outside the entry it names', () => {
    const inOtherUnit = cons('<constraint id="c" type="max" value="1" field="selections" scope="other"/>');
    const w = world(unit('squad', 'Squad', 0, children(entry('g', 'Gun', 0, inOtherUnit))) + unit('other', 'Other'));
    w.pick(w.add('Squad'), 'Gun', 2);
    expect(w.errors()).toEqual([]);
  });

  it('reads no entry from a scope that is a word, not an id', () => {
    const inSelf = cons('<constraint id="c" type="max" value="1" field="selections" scope="self"/>');
    const w = world(unit('squad', 'Squad', 0, children(entry('g', 'Gun', 0, inSelf))));
    w.pick(w.add('Squad'), 'Gun', 2);
    expect(w.errors()).toEqual([]);
  });

  it('multiplies by the number of the selections in between', () => {
    const w = armoury(MAX_ONE);
    w.pick(w.pick(w.add('Squad'), 'Model', 2), 'Vox');
    expect(w.errors()).toEqual(['Vox: at most 1 allowed (has 2)']);
  });

  it('reads the limit after modifiers, as "one in five models" does', () => {
    const w = armoury(
      cons('<constraint id="c" type="max" value="0" field="selections" scope="squad" includeChildSelections="true"/>') +
        mods(
          '<modifier type="increment" field="c" value="1"><repeats><repeat value="5" repeats="1" field="selections" scope="squad" childId="m" includeChildSelections="true"/></repeats></modifier>',
        ),
    );
    const s = w.add('Squad');
    const others = w.pick(s, 'Model', 4);
    w.pick(w.pick(s, 'Model'), 'Vox');
    expect(w.errors()).toEqual([]);
    removeSel(w.roster, others);
    expect(w.errors()).toEqual(['Vox: at most 0 allowed (has 1)']);
  });

  it('without child selections counts only direct picks in that entry', () => {
    const w = world(
      unit(
        'squad',
        'Squad',
        0,
        children(
          entry('g', 'Gun', 0, cons('<constraint id="c" type="max" value="1" field="selections" scope="squad"/>')),
        ),
      ),
    );
    w.pick(w.add('Squad'), 'Gun', 2);
    expect(w.errors()).toEqual(['Gun: at most 1 allowed (has 2)']);
  });

  it('without child selections leaves out picks nested deeper', () => {
    const gun = entry(
      'g',
      'Gun',
      0,
      cons('<constraint id="c" type="max" value="1" field="selections" scope="squad"/>'),
    );
    const w = world(unit('squad', 'Squad', 0, children(entry('m', 'Model', 0, children(gun)))));
    const s = w.add('Squad');
    w.pick(w.pick(s, 'Model'), 'Gun');
    w.pick(w.pick(s, 'Model'), 'Gun');
    expect(w.errors()).toEqual([]);
  });
});
