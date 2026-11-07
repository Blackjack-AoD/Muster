import { describe, expect, it } from 'vitest';
import type { SavedUnit } from './db';
import { Evaluator, type Sel } from './engine';
import { clashIn, duplicateSaved, follow, newSavedUnit, savedFrom, setUpOf, unitList } from './units';
import { children, cons, entry, unit, world } from '../test/fixture';

const ALLEGIANCE = entry(
  'al',
  'Allegiance',
  0,
  `<constraints><constraint id="al-min" type="min" value="1" field="selections" scope="force"/></constraints>
  <selectionEntryGroups>
    <selectionEntryGroup id="side" name="Side">
      ${cons('<constraint id="side-max" type="max" value="1" field="selections" scope="parent"/>')}
      ${children(entry('loy', 'Loyalist'), entry('tra', 'Traitor'))}
    </selectionEntryGroup>
  </selectionEntryGroups>`,
);
/** Only a Traitor list offers the Warp Blade. */
const BLADE = entry(
  'blade',
  'Warp Blade',
  10,
  `<modifiers>
    <modifier type="set" field="hidden" value="true">
      <conditions>
        <condition type="equalTo" value="0" field="selections" scope="roster" childId="tra" includeChildSelections="true"/>
      </conditions>
    </modifier>
  </modifiers>`,
);
const TAC = unit('tac', 'Tactical Squad', 100, children(BLADE, entry('sword', 'Sword', 5)));
const DATA = ALLEGIANCE + TAC;

const sel = (key: string, kids: Sel[] = [], number = 1): Sel => ({ uid: `u-${key}`, key, number, children: kids });
const saved = (build: Sel, extra: Partial<SavedUnit> = {}): SavedUnit => ({
  id: 'su1',
  name: '',
  kind: 'preconfigured',
  repo: 'test/repo',
  gameSystemId: 'gst',
  catalogueId: 'cat',
  key: build.key,
  categoryId: '',
  build,
  created: 0,
  updated: 0,
  ...extra,
});

/** The names of the roots of a unit's own list, and the side its Allegiance picked. */
function look(w: ReturnType<typeof world>, u: SavedUnit, army = 'Iron Warriors') {
  const list = unitList(u, w.contexts, army, 3000);
  const ev = new Evaluator(list.roster, w.contexts);
  const roots = ev.forces[0].roots;
  return {
    list,
    ev,
    roots: roots.map((r) => r.eff.name),
    side: roots.find((r) => r.eff.name === 'Allegiance')?.children.map((c) => c.eff.name),
    unit: ev.find(list.unitUid),
  };
}

describe('unitList', () => {
  it("gives a unit saved without a set-up a new list's set-up, with the army's side in the lore", () => {
    const w = world(DATA);
    const { roots, side, list } = look(w, saved(sel('tac')));
    expect(roots).toEqual(['Allegiance', 'Tactical Squad']);
    expect(side).toEqual(['Traitor']);
    expect(list.roster.costLimit).toBe(3000);
  });

  it('builds the set-up the unit was saved with', () => {
    const w = world(DATA);
    const setUp = { forceEntryId: 'det', selections: [sel('al', [sel('side/loy')])] };
    const keys = (s: Sel): string[] => [s.key, ...s.children.flatMap(keys)];
    const { side, list } = look(w, saved(sel('tac'), { setUp }));
    expect(list.roster.forces[0].selections.flatMap(keys)).toEqual(['al', 'side/loy', 'tac']);
    expect(side).toEqual(['Loyalist']);
  });

  it("names the unit of a unique unit with the unit's name", () => {
    const w = world(DATA);
    const { unit: u } = look(w, saved(sel('tac'), { name: 'Squad Thrax', kind: undefined }));
    expect(u?.sel.name).toBe('Squad Thrax');
  });
});

describe('savedFrom', () => {
  it('takes the build, and the rest of the list as the set-up', () => {
    const w = world(DATA);
    const before = saved(sel('tac'));
    const { list } = look(w, before);
    const unitSel = list.roster.forces[0].selections.find((s) => s.uid === list.unitUid);
    unitSel?.children.push(sel('sword'));
    const after = savedFrom(before, list, 5);
    expect(after.build.children.map((c) => c.key)).toEqual(['sword']);
    expect(after.setUp?.forceEntryId).toBe('det');
    expect(after.setUp?.selections.map((s) => s.key)).toEqual(['al']);
    expect(after.updated).toBe(5);
    expect(after).toMatchObject({ id: 'su1', name: '', kind: 'preconfigured' });
  });

  it('makes a named unit unique, and an unnamed one preconfigured', () => {
    const w = world(DATA);
    const before = saved(sel('tac'));
    const { list } = look(w, before);
    const unitSel = list.roster.forces[0].selections.find((s) => s.uid === list.unitUid);
    if (unitSel) unitSel.name = 'Squad Thrax';
    const named = savedFrom(before, list, 1);
    expect(named.name).toBe('Squad Thrax');
    expect(named).not.toHaveProperty('kind');
    expect(named.build).not.toHaveProperty('name');
    if (unitSel) delete unitSel.name;
    expect(savedFrom(named, list, 2)).toMatchObject({ name: '', kind: 'preconfigured' });
  });
});

describe('newSavedUnit', () => {
  it("is a preconfigured unit of the data's unit, with a new list's set-up", () => {
    const w = world(DATA);
    const u = newSavedUnit(
      w.contexts,
      { repo: 'test/repo', catalogueId: 'cat', armyName: 'Ultramarines', costLimit: 3000 },
      w.root('Tactical Squad'),
      7,
    );
    expect(u).toMatchObject({ name: '', kind: 'preconfigured', key: w.root('Tactical Squad').key, created: 7 });
    expect(u?.setUp?.selections.map((s) => s.children.map((c) => c.key))).toEqual([['side/loy']]);
  });
});

describe('duplicateSaved', () => {
  it('copies a saved unit under a new id, marking a unique copy in its name', () => {
    const thrax = saved(sel('tac', [sel('sword')]), { name: 'Squad Thrax', kind: undefined });
    const copy = duplicateSaved(thrax, 9);
    expect(copy.id).not.toBe(thrax.id);
    expect(copy).toMatchObject({ name: 'Squad Thrax (copy)', created: 9, updated: 9 });
    expect(copy.build).toEqual(thrax.build);
    expect(copy.build).not.toBe(thrax.build);
  });
});

describe('clashIn', () => {
  const loyalList = () => {
    const w = world(DATA);
    w.add('Allegiance');
    const al = w.roster.forces[0].selections[0];
    w.pick(al.uid, 'Loyalist');
    return w;
  };

  it("names an option that the list's set-up doesn't allow", () => {
    const w = loyalList();
    const traitorBuilt = saved(sel('tac', [sel('blade')]));
    expect(clashIn(w.roster, w.contexts, 'f1', traitorBuilt)).toBe("Warp Blade isn't allowed in this list");
  });

  it('finds no clash for a unit whose options the list allows', () => {
    const w = loyalList();
    expect(clashIn(w.roster, w.contexts, 'f1', saved(sel('tac', [sel('sword')])))).toBeUndefined();
  });
});

describe('follow', () => {
  const before = saved(sel('tac', [sel('sword')]), { name: 'Squad Thrax', kind: undefined });
  const after = { ...before, name: 'Squad Iron', build: sel('tac', [sel('blade')]) };
  const copy = (kids: Sel[]): Sel => ({
    uid: 'c',
    key: 'tac',
    number: 1,
    name: 'Squad Thrax',
    saved: 'su1',
    children: kids,
  });

  it('gives a copy that matched its saved unit the new build and name', () => {
    const c = copy([sel('sword')]);
    follow(c, before, after);
    expect(c).toMatchObject({ uid: 'c', name: 'Squad Iron', saved: 'su1', children: [sel('blade')] });
  });

  it('keeps the build of a copy changed in its list, and gives it the new name', () => {
    const c = copy([]);
    follow(c, before, after);
    expect(c).toMatchObject({ name: 'Squad Iron', children: [] });
  });
});

describe('setUpOf', () => {
  it("takes a detachment's set-up picks, and none of its units", () => {
    const w = world(DATA);
    w.add('Allegiance');
    w.add('Tactical Squad');
    expect(setUpOf(w.ev().forces[0].roots).map((s) => s.key)).toEqual(['al']);
  });
});
