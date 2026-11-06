import { describe, expect, it } from 'vitest';
import { Context } from './catalog';
import type { SavedUnit } from './db';
import {
  addModels,
  addSavedUnit,
  canNameModel,
  nameSel,
  nameToSet,
  splitOff,
  tryAddSaved,
  unavailableHere,
  unsplit,
  type Sel,
} from './engine';
import { FORCE, SWORD, catalogue, children, cons, entry, group, mods, unit, world } from '../test/fixture';

const rules = (...names: string[]) =>
  `<rules>${names.map((n) => `<rule id="r-${n}" name="${n}"><description>Text</description></rule>`).join('')}</rules>`;

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

  it('keeps one issue for each limit the list breaks', () => {
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
    return w.ev().rulesFor(w.sel(w.add('Praetor')));
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
  const namesUnder = (w: ReturnType<typeof world>, uid: string) => w.sel(uid).children.map((c) => c.eff.name);

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

describe('addSavedUnit', () => {
  const once = (id: string) =>
    cons(
      `<constraint id="${id}-min" type="min" field="selections" scope="parent" value="1"/>`,
      `<constraint id="${id}-max" type="max" field="selections" scope="parent" value="1"/>`,
    );
  const SQUAD = unit(
    'sq',
    'Breacher Squad',
    50,
    children(
      entry('sgt', 'Sergeant', 10, once('sgt') + children(entry('fist', 'Power Fist', 5))),
      entry('mar', 'Marine', 10),
    ),
  );
  const sel = (key: string, number = 1, kids: Sel[] = []): Sel => ({ uid: `old-${key}`, key, number, children: kids });
  const savedUnit = (build: Sel): SavedUnit => ({
    id: 'su1',
    name: 'Squad Thrax',
    repo: 'test/repo',
    gameSystemId: 'gst',
    catalogueId: 'cat',
    key: build.key,
    categoryId: 'troops',
    build,
    created: 0,
    updated: 0,
  });
  const thrax = () => savedUnit(sel('sq', 1, [sel('sgt', 1, [sel('fist')]), sel('mar', 4)]));
  /** What a selection holds, without its uids. */
  type Shape = Pick<Sel, 'key' | 'number'> & { children: Shape[] };
  const shape = (s: Sel): Shape => ({ key: s.key, number: s.number, children: s.children.map(shape) });
  const uidsIn = (s: Sel): string[] => [s.uid, ...s.children.flatMap(uidsIn)];
  const addedUid = (r: ReturnType<typeof addSavedUnit>) => {
    expect(r).toMatchObject({ added: true });
    return r.added ? r.uid : '';
  };
  const onlyRoot = (w: ReturnType<typeof world>, force = 0) => {
    expect(w.roster.forces[force].selections).toHaveLength(1);
    return w.roster.forces[force].selections[0];
  };

  it('adds the saved build as a root unit with its name, link and category', () => {
    const w = world(SQUAD);
    const uid = addedUid(addSavedUnit(w.roster, w.contexts, 'f1', thrax()));
    const root = onlyRoot(w);
    expect(root.uid).toBe(uid);
    expect(shape(root)).toEqual(shape(thrax().build));
    expect(root).toMatchObject({ name: 'Squad Thrax', saved: 'su1', categoryId: 'troops' });
  });

  it('gives the copy and every selection in it new uids', () => {
    const w = world(SQUAD);
    addSavedUnit(w.roster, w.contexts, 'f1', thrax());
    const uids = uidsIn(onlyRoot(w));
    expect(uids).toHaveLength(4);
    expect(new Set(uids).size).toBe(4);
    expect(uids.filter((u) => u.startsWith('old-'))).toEqual([]);
  });

  it("leaves the saved unit's build as it was", () => {
    const w = world(SQUAD);
    const unit = thrax();
    addSavedUnit(w.roster, w.contexts, 'f1', unit);
    expect(unit.build).toEqual(thrax().build);
  });

  it('leaves out an option the data no longer has, at any depth', () => {
    const w = world(SQUAD);
    const unit = savedUnit(sel('sq', 1, [sel('sgt', 1, [sel('fist'), sel('gone-fist')]), sel('gone-banner')]));
    addSavedUnit(w.roster, w.contexts, 'f1', unit);
    expect(shape(onlyRoot(w))).toEqual(shape(sel('sq', 1, [sel('sgt', 1, [sel('fist')])])));
  });

  it('reports no options left out when the data still has every one', () => {
    const w = world(SQUAD);
    expect(addSavedUnit(w.roster, w.contexts, 'f1', thrax())).toMatchObject({ added: true, dropped: 0 });
  });

  it('counts each option it leaves out, at any depth', () => {
    const w = world(SQUAD);
    const unit = savedUnit(sel('sq', 1, [sel('sgt', 1, [sel('fist'), sel('gone-fist')]), sel('gone-banner')]));
    expect(addSavedUnit(w.roster, w.contexts, 'f1', unit)).toMatchObject({ added: true, dropped: 2 });
  });

  it('counts a left-out option with options under it as one', () => {
    const w = world(SQUAD);
    const unit = savedUnit(sel('sq', 1, [sel('mar', 4), sel('gone-banner', 1, [sel('fist'), sel('gone-pole')])]));
    expect(addSavedUnit(w.roster, w.contexts, 'f1', unit)).toMatchObject({ added: true, dropped: 1 });
  });

  it('adds nothing when the data no longer has the unit', () => {
    const w = world(SQUAD);
    const unit = savedUnit(sel('gone-sq', 1, [sel('sgt', 1, [sel('fist')])]));
    expect(addSavedUnit(w.roster, w.contexts, 'f1', unit)).toEqual({ added: false, reason: 'unit-gone' });
    expect(w.roster.forces[0].selections).toEqual([]);
  });

  it('fills in a mandatory option the saved build lacks', () => {
    const w = world(unit('sq', 'Breacher Squad', 50, children(SWORD, entry('mar', 'Marine', 10))));
    addSavedUnit(w.roster, w.contexts, 'f1', savedUnit(sel('sq', 1, [sel('mar', 4)])));
    expect(shape(onlyRoot(w))).toEqual(shape(sel('sq', 1, [sel('mar', 4), sel('sword')])));
  });

  it('fills in a mandatory option under a model the saved build already holds', () => {
    const w = world(unit('sq', 'Breacher Squad', 50, children(entry('sgt', 'Sergeant', 10, children(SWORD)))));
    addSavedUnit(w.roster, w.contexts, 'f1', savedUnit(sel('sq', 1, [sel('sgt')])));
    expect(shape(onlyRoot(w))).toEqual(shape(sel('sq', 1, [sel('sgt', 1, [sel('sword')])])));
  });

  it('adds nothing to a detachment of another army file', () => {
    const w = world(SQUAD);
    const other = catalogue(`<selectionEntries>${SQUAD}</selectionEntries>`, 'cat2');
    w.contexts.set(other.id, new Context(w.gst, other, []));
    w.roster.forces.push({ uid: 'f2', forceEntryId: 'det', catalogueId: 'cat2', selections: [] });
    expect(addSavedUnit(w.roster, w.contexts, 'f2', thrax())).toEqual({ added: false, reason: 'other-army-file' });
    expect(w.roster.forces[1].selections).toEqual([]);
  });

  it('adds nothing to a detachment of the same army file id in another repo', () => {
    const w = world(SQUAD);
    w.roster.repo = 'someone/fork';
    expect(addSavedUnit(w.roster, w.contexts, 'f1', thrax())).toEqual({ added: false, reason: 'other-army-file' });
    expect(w.roster.forces[0].selections).toEqual([]);
  });

  it.each([
    ['the same detachment', 'f1'],
    ['another detachment', 'f2'],
  ])('adds nothing when %s of the list already holds the saved unit', (_, forceUid) => {
    const w = world(SQUAD);
    w.addForce();
    addedUid(addSavedUnit(w.roster, w.contexts, 'f1', thrax()));
    expect(addSavedUnit(w.roster, w.contexts, forceUid, thrax())).toEqual({ added: false, reason: 'already-in-list' });
    expect(w.roster.forces.map((f) => f.selections.length)).toEqual([1, 0]);
  });

  it('adds nothing when the list has no such detachment', () => {
    const w = world(SQUAD);
    expect(addSavedUnit(w.roster, w.contexts, 'nope', thrax())).toEqual({ added: false, reason: 'no-detachment' });
    expect(w.roster.forces[0].selections).toEqual([]);
  });
});

describe('naming and splitting models', () => {
  const MARINE = entry('marine', 'Marine', 10, children(entry('grenade', 'Frag Grenade', 5)), 'type="model"');
  /** A squad holding Marine rows of these counts, where `named` gives the name of each row by its index. */
  function squad(counts: number[], named: Record<number, string> = {}) {
    const w = world(unit('tac', 'Tactical Squad', 100, children(MARINE)));
    const tac = w.add('Tactical Squad');
    for (const n of counts) w.pick(tac, 'Marine', n);
    const root = w.roster.forces[0].selections[0];
    root.children.forEach((c, i) => {
      if (named[i]) c.name = named[i];
    });
    const rows = () => root.children.map((c) => [c.number, c.name]);
    return { w, tac, root, rows };
  }

  it('splits one model off a group as a row of 1 straight after it, with its own uids and wargear', () => {
    const { w, root, rows } = squad([3]);
    const group = root.children[0];
    w.pick(group.uid, 'Frag Grenade');
    const copy = splitOff(w.roster, group.uid);
    expect(rows()).toEqual([
      [2, undefined],
      [1, undefined],
    ]);
    expect(copy).toBe(root.children[1]);
    expect(copy?.uid).not.toBe(group.uid);
    expect(copy?.children.map((c) => c.key)).toEqual(['grenade']);
    expect(copy?.children[0]?.uid).not.toBe(group.children[0]?.uid);
  });

  it('splits nothing off a row of 1', () => {
    const { w, root, rows } = squad([1]);
    expect(splitOff(w.roster, root.children[0].uid)).toBeNull();
    expect(rows()).toEqual([[1, undefined]]);
  });

  it('names a unit, and clears its name', () => {
    const { w, tac, root } = squad([]);
    nameSel(w.roster, tac, 'Squad Thrax');
    expect(root.name).toBe('Squad Thrax');
    nameSel(w.roster, tac, undefined);
    expect(Object.keys(root)).not.toContain('name');
  });

  it('names one model of a group of 5 as a row of its own', () => {
    const { w, root, rows } = squad([5]);
    nameSel(w.roster, root.children[0].uid, 'Brother Kael');
    expect(rows()).toEqual([
      [4, undefined],
      [1, 'Brother Kael'],
    ]);
  });

  it('names a model on a row of 1 where it is, and clears it there', () => {
    const { w, root, rows } = squad([1], { 0: 'Brother Kael' });
    nameSel(w.roster, root.children[0].uid, 'Brother Vorr');
    expect(rows()).toEqual([[1, 'Brother Vorr']]);
    nameSel(w.roster, root.children[0].uid, undefined);
    expect(rows()).toEqual([[1, undefined]]);
  });

  it('gives the name the player typed, or none when they cleared it', () => {
    const { w, tac } = squad([]);
    expect(nameToSet(w.sel(tac), 'Squad Thrax')).toBe('Squad Thrax');
    expect(nameToSet(w.sel(tac), undefined)).toBeUndefined();
  });

  it('gives a linked copy the data name when the player clears its name, as a saved unit always has one', () => {
    const { w, tac, root } = squad([]);
    Object.assign(root, { saved: 'thrax', name: 'Squad Thrax' });
    expect(nameToSet(w.sel(tac), undefined)).toBe('Tactical Squad');
  });

  it('adds new models to an unnamed row, never a named one before it', () => {
    const { w, tac, rows } = squad([1, 1], { 0: 'Brother Kael' });
    addModels(w.roster, w.contexts, w.sel(tac), w.beneath(tac, 'Marine'), 2);
    expect(rows()).toEqual([
      [1, 'Brother Kael'],
      [3, undefined],
    ]);
  });

  it('adds new models to the biggest unnamed row', () => {
    const { w, tac, rows } = squad([1, 1, 3], { 0: 'Brother Kael' });
    addModels(w.roster, w.contexts, w.sel(tac), w.beneath(tac, 'Marine'), 2);
    expect(rows()).toEqual([
      [1, 'Brother Kael'],
      [1, undefined],
      [5, undefined],
    ]);
  });

  it("offers no name for the main row of the squad's bulk model, and one for a row split off it", () => {
    const { w, tac } = squad([4, 1]);
    expect(w.sel(tac).children.map(canNameModel)).toEqual([false, true]);
  });

  it('offers a name for a model other than the bulk, such as a sergeant', () => {
    const sgt = entry('sgt', 'Sergeant', 20, children(entry('sword', 'Sword', 5)), 'type="model"');
    const w = world(unit('tac', 'Tactical Squad', 100, children(sgt, MARINE)));
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Sergeant');
    w.pick(tac, 'Marine', 4);
    expect(w.sel(tac).children.map((c) => [c.node.name, canNameModel(c)])).toEqual([
      ['Sergeant', true],
      ['Marine', false],
    ]);
  });

  it('offers a name for a named row, so it can be changed or cleared', () => {
    const { w, tac } = squad([1, 3], { 0: 'Brother Kael' });
    expect(w.sel(tac).children.map(canNameModel)).toEqual([true, false]);
  });

  it('offers a name for every model when two models tie for the most', () => {
    const scout = entry('scout', 'Scout', 5, children(entry('knife', 'Knife', 1)), 'type="model"');
    const w = world(unit('tac', 'Tactical Squad', 100, children(MARINE, scout)));
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Marine', 2);
    w.pick(tac, 'Scout', 2);
    expect(w.sel(tac).children.map(canNameModel)).toEqual([true, true]);
  });

  it('undoes a split: the row rejoins the first unnamed row of its model, taking its wargear', () => {
    const { w, root, rows } = squad([2, 1]);
    w.pick(root.children[1].uid, 'Frag Grenade');
    expect(unsplit(w.roster, root.children[1].uid)).toBe(true);
    expect(rows()).toEqual([[3, undefined]]);
    expect(root.children[0].children).toEqual([]);
  });

  it('undoing the split of a named model drops its name', () => {
    const { w, root, rows } = squad([2, 1], { 1: 'Brother Kael' });
    unsplit(w.roster, root.children[1].uid);
    expect(rows()).toEqual([[3, undefined]]);
  });

  it('undoes no split of a row with no unnamed row of its model before it', () => {
    const { w, root, rows } = squad([1, 2], { 0: 'Brother Kael' });
    expect(unsplit(w.roster, root.children[1].uid)).toBe(false);
    expect(rows()).toEqual([
      [1, 'Brother Kael'],
      [2, undefined],
    ]);
  });

  it('adds new models as a new unnamed row when every row is named', () => {
    const { w, tac, rows } = squad([1], { 0: 'Brother Kael' });
    addModels(w.roster, w.contexts, w.sel(tac), w.beneath(tac, 'Marine'), 2);
    expect(rows()).toEqual([
      [1, 'Brother Kael'],
      [2, undefined],
    ]);
  });
});

describe('tryAddSaved', () => {
  const SQUAD = unit('sq', 'Breacher Squad', 50, children(entry('mar', 'Marine', 10)));
  const saved = (build: Sel, id = 'su1'): SavedUnit => ({
    id,
    name: 'Squad Thrax',
    repo: 'test/repo',
    gameSystemId: 'gst',
    catalogueId: 'cat',
    key: build.key,
    categoryId: '',
    build,
    created: 0,
    updated: 0,
  });
  const sel = (key: string, number = 1, kids: Sel[] = []): Sel => ({ uid: `old-${key}`, key, number, children: kids });

  it("gives the points of the saved build against today's data, and leaves the list as it is", () => {
    const w = world(SQUAD);
    const before = structuredClone(w.roster);
    expect(tryAddSaved(w.roster, w.contexts, 'f1', saved(sel('sq', 1, [sel('mar', 4), sel('gone')])))).toEqual({
      added: true,
      pts: 90,
    });
    expect(w.roster).toEqual(before);
  });

  it('refuses a saved unit the list already holds', () => {
    const w = world(SQUAD);
    const unit = saved(sel('sq'));
    addSavedUnit(w.roster, w.contexts, 'f1', unit);
    expect(tryAddSaved(w.roster, w.contexts, 'f1', unit)).toEqual({ added: false, reason: 'already-in-list' });
  });

  it('refuses a saved unit whose unit is gone from the data', () => {
    const w = world(SQUAD);
    expect(tryAddSaved(w.roster, w.contexts, 'f1', saved(sel('gone')))).toEqual({ added: false, reason: 'unit-gone' });
  });

  it('offers nothing for a saved unit of another army file', () => {
    const w = world(SQUAD);
    expect(tryAddSaved(w.roster, w.contexts, 'f1', { ...saved(sel('sq')), catalogueId: 'other' })).toBeNull();
  });
});

describe("rules on the list's points", () => {
  const LORD = entry(
    'lord',
    'Lord',
    10,
    `<modifiers>
      <modifier type="increment" field="lord-max" value="1">
        <repeats>
          <repeat field="pts" scope="roster" value="1000" repeats="1" childId="any"/>
        </repeats>
      </modifier>
    </modifiers>
    <constraints>
      <constraint id="lord-max" type="max" field="selections" scope="roster" value="0"/>
    </constraints>`,
  );
  const lords = (costLimit: number, n: number) => {
    const w = world(LORD, { costLimit });
    for (let i = 0; i < n; i++) w.add('Lord');
    return w.errors();
  };

  it("counts a step per points in the list against the list's points limit", () => {
    expect(lords(3000, 3)).toEqual([]);
    expect(lords(3000, 4)).toEqual(['Lord: at most 3 allowed in the list (has 4)']);
  });

  it('counts the points in the list when it has no points limit', () => {
    expect(lords(0, 1)).toEqual(['Lord: at most 0 allowed in the list (has 1)']);
  });

  it("checks a condition on the list's points against its points limit", () => {
    const hero = entry(
      'hero',
      'Hero',
      10,
      `<modifiers>
        <modifier type="set" field="hidden" value="true">
          <conditions>
            <condition type="lessThan" value="1000" field="pts" scope="roster" childId="any"/>
          </conditions>
        </modifier>
      </modifiers>`,
    );
    const hidden = (costLimit: number) => {
      const w = world(hero, { costLimit });
      const ev = w.ev();
      return ev.optionEff(w.root('Hero'), null, ev.forces[0]).hidden;
    };
    expect(hidden(2000)).toBe(false);
    expect(hidden(0)).toBe(true);
  });
});
