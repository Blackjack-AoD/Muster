import { describe, expect, it } from 'vitest';
import { Context } from './catalog';
import { catalogue, children, entry, gameSystem, parseXml, unit } from '../test/fixture';

const ctxOf = (cat: string, gst = '', linked: ReturnType<typeof catalogue>[] = []) =>
  new Context(gameSystem(gst), catalogue(cat), linked);
const link = (id: string, targetId: string, attrs = '', inner = '') =>
  `<entryLink id="${id}" targetId="${targetId}" type="selectionEntry" ${attrs}>${inner}</entryLink>`;
const shared = (...e: string[]) => `<sharedSelectionEntries>${e.join('')}</sharedSelectionEntries>`;

describe('resolving links', () => {
  const linked = (attrs: string, inner: string, target = entry('t', 'Target', 10)) => {
    const c = ctxOf(`<entryLinks>${link('l', 't', attrs, inner)}</entryLinks>${shared(target)}`);
    return c.resolve(c.cat.rootEntries[0])!;
  };

  it('returns a plain entry unchanged', () => {
    const c = ctxOf(`<selectionEntries>${entry('a', 'A')}</selectionEntries>`);
    expect(c.resolve(c.cat.rootEntries[0])).toBe(c.cat.rootEntries[0]);
  });
  it('returns the same merged node each time', () => {
    const c = ctxOf(`<entryLinks>${link('l', 't')}</entryLinks>${shared(entry('t', 'Target'))}`);
    expect(c.resolve(c.cat.rootEntries[0])).toBe(c.resolve(c.cat.rootEntries[0]));
  });
  it('gives nothing for a link to nowhere', () => {
    const c = ctxOf(`<entryLinks>${link('l', 'gone')}</entryLinks>`);
    expect(c.resolve(c.cat.rootEntries[0])).toBeNull();
  });
  it('keeps the target id and remembers the link id', () => {
    expect(linked('', '')).toMatchObject({ id: 't', linkId: 'l', tag: 'selectionEntry' });
  });
  it('prefers the link name, unless it is the editor placeholder', () => {
    expect(linked('name="Better"', '').name).toBe('Better');
    expect(linked('name="New EntryLink"', '').name).toBe('Target');
    expect(linked('name=""', '').name).toBe('Target');
  });
  it('is hidden if either side is', () => {
    expect(linked('hidden="true"', '').hidden).toBe(true);
    expect(linked('', '', entry('t', 'Target', 0, '', 'hidden="true"')).hidden).toBe(true);
    expect(linked('', '').hidden).toBe(false);
  });
  it('merges constraints, modifiers, categories, and children from both sides', () => {
    const r = linked(
      '',
      `<constraints><constraint id="c2" type="max" value="1"/></constraints><modifiers><modifier type="set" field="name" value="x"/></modifiers><categoryLinks><categoryLink id="cl" targetId="z"/></categoryLinks><rules><rule id="r2" name="R2"/></rules>`,
      entry(
        't',
        'Target',
        0,
        `<constraints><constraint id="c1" type="min" value="1"/></constraints><rules><rule id="r1" name="R1"/></rules>${children(entry('kid', 'Kid'))}`,
      ),
    );
    expect(r.constraints.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(r.modifiers).toHaveLength(1);
    expect(r.categoryLinks[0].targetId).toBe('z');
    expect(r.rules.map((x) => x.id)).toEqual(['r1', 'r2']);
    expect(r.children[0].id).toBe('kid');
  });
  it('overrides a cost from the link, and adds one the target lacks', () => {
    const r = linked('', '<costs><cost typeId="pts" value="25"/><cost typeId="pl" value="2"/></costs>');
    expect(r.costs).toEqual([
      { typeId: 'pts', value: 25 },
      { typeId: 'pl', value: 2 },
    ]);
  });
  it('keeps the cost of the target when the link says 0', () => {
    expect(linked('', '<costs><cost typeId="pts" value="0"/></costs>').costs[0].value).toBe(10);
  });
  it('does not change the shared target', () => {
    const c = ctxOf(
      `<entryLinks>${link('l', 't', '', '<costs><cost typeId="pts" value="25"/></costs>')}</entryLinks>${shared(entry('t', 'Target', 10))}`,
    );
    c.resolve(c.cat.rootEntries[0]);
    expect(c.get('t')!.costs[0].value).toBe(10);
  });
  it('follows a link to a link', () => {
    const c = ctxOf(
      `<entryLinks>${link('l', 'm')}</entryLinks><sharedSelectionEntries>${entry('t', 'Target')}</sharedSelectionEntries><sharedSelectionEntryGroups><selectionEntryGroup id="sg"><entryLinks>${link('m', 't', 'name="Middle"')}</entryLinks></selectionEntryGroup></sharedSelectionEntryGroups>`,
    );
    expect(c.resolve(c.cat.rootEntries[0])).toMatchObject({ id: 't', name: 'Middle' });
  });
  it('gives nothing for a link to a broken link', () => {
    const c = ctxOf(
      `<entryLinks>${link('l', 'm')}</entryLinks><sharedSelectionEntryGroups><selectionEntryGroup id="sg"><entryLinks>${link('m', 'gone')}</entryLinks></selectionEntryGroup></sharedSelectionEntryGroups>`,
    );
    expect(c.resolve(c.cat.rootEntries[0])).toBeNull();
  });
  it('merges the default and sort order, the link winning', () => {
    const r = linked(
      'sortIndex="2" defaultSelectionEntryId="d"',
      '',
      entry('t', 'Target', 0, '', 'sortIndex="9" defaultSelectionEntryId="e"'),
    );
    expect(r).toMatchObject({ sortIndex: 2, defaultSelectionEntryId: 'd' });
  });
});

describe('the index across files', () => {
  it('lets the catalogue win over a library, and a library over the game system', () => {
    const gst = gameSystem(shared(entry('a', 'From game'), entry('b', 'From game')));
    const lib = catalogue(shared(entry('a', 'From library'), entry('b', 'From library')), 'lib');
    const cat = catalogue(shared(entry('a', 'From army')));
    const c = new Context(gst, cat, [lib]);
    expect(c.get('a')!.name).toBe('From army');
    expect(c.get('b')!.name).toBe('From library');
  });
  it('finds nested entries, profiles and rules', () => {
    const inner = `<profiles><profile id="p" name="P"/></profiles><rules><rule id="r" name="R"/></rules>`;
    const c = ctxOf(
      `<selectionEntries>${entry('a', 'A', 0, children(entry('b', 'B', 0, inner)))}</selectionEntries><sharedProfiles><profile id="sp" name="SP"/></sharedProfiles><sharedRules><rule id="sr" name="SR"/></sharedRules>`,
    );
    expect(c.get('b')!.name).toBe('B');
    expect([c.profile('p')?.name, c.profile('sp')?.name, c.rule('r')?.name, c.rule('sr')?.name]).toEqual([
      'P',
      'SP',
      'R',
      'SR',
    ]);
  });
  it('names categories, and copes with unknown ones', () => {
    const c = ctxOf('', '<categoryEntries><categoryEntry id="hq" name="HQ"/></categoryEntries>');
    expect(c.categoryName('hq')).toBe('HQ');
    expect(c.categoryName('nope')).toBe('');
  });
  it('lists the columns of each profile type', () => {
    const c = ctxOf(
      '',
      '<profileTypes><profileType id="pt" name="Unit"><characteristicTypes><characteristicType id="m" name="M"/></characteristicTypes></profileType></profileTypes>',
    );
    expect(c.profileColumns.get('pt')).toEqual({ name: 'Unit', columns: ['M'] });
  });
  it('picks points by name, whatever order the costs are in', () => {
    const g = parseXml(
      '<gameSystem><costTypes><costType id="a" name="CP"/><costType id="b" name="Points"/></costTypes></gameSystem>',
    );
    expect(new Context(g, catalogue(), []).pointsType()?.id).toBe('b');
  });
  it('falls back to the first cost type, or none', () => {
    const one = parseXml('<gameSystem><costTypes><costType id="a" name="Gold"/></costTypes></gameSystem>');
    expect(new Context(one, catalogue(), []).pointsType()?.id).toBe('a');
    expect(new Context(parseXml('<gameSystem/>'), catalogue(), []).pointsType()).toBeUndefined();
  });
  it('lists force entries from the game and army, nested ones too', () => {
    const c = ctxOf(
      '<forceEntries><forceEntry id="b" name="B"/></forceEntries>',
      '<forceEntries><forceEntry id="a" name="A"><forceEntries><forceEntry id="n" name="N"/></forceEntries></forceEntry></forceEntries>',
    );
    expect(c.forceEntries().map((f) => f.id)).toEqual(['a', 'n', 'b']);
  });
});

describe('options', () => {
  const owner = (inner: string, rest = '') => {
    const c = ctxOf(`<selectionEntries>${entry('o', 'Owner', 0, inner)}</selectionEntries>${rest}`);
    return { c, node: c.cat.rootEntries[0] };
  };
  const group = (id: string, inner: string, attrs = '') =>
    `<selectionEntryGroups><selectionEntryGroup id="${id}" name="Group ${id}" ${attrs}>${inner}</selectionEntryGroup></selectionEntryGroups>`;

  it('lists entries and groups, with members keyed by their path', () => {
    const { c, node } = owner(children(entry('a', 'A')) + group('g', children(entry('b', 'B'))));
    const opts = c.options(node);
    expect(opts.map((o) => [o.key, o.kind])).toEqual([
      ['a', 'entry'],
      ['g', 'group'],
    ]);
    expect(opts[1].members[0]).toMatchObject({ key: 'g/b', kind: 'entry', groupIds: ['g'] });
  });
  it('is cached', () => {
    const { c, node } = owner(children(entry('a', 'A')));
    expect(c.options(node)).toBe(c.options(node));
  });
  it('skips broken links', () => {
    const { c, node } = owner(`<entryLinks>${link('l', 'gone')}</entryLinks>`);
    expect(c.options(node)).toEqual([]);
  });
  it('keys a link by its link id, so two links to one entry stay apart', () => {
    const { c, node } = owner(
      `<entryLinks>${link('l1', 't')}${link('l2', 't')}</entryLinks>`,
      shared(entry('t', 'Target')),
    );
    expect(c.options(node).map((o) => o.key)).toEqual(['l1', 'l2']);
  });
  it('records both the group id and the link id on members of a linked group', () => {
    const { c, node } = owner(
      '<entryLinks><entryLink id="gl" targetId="sg" type="selectionEntryGroup"/></entryLinks>',
      `<sharedSelectionEntryGroups><selectionEntryGroup id="sg" name="Shared">${children(entry('b', 'B'))}</selectionEntryGroup></sharedSelectionEntryGroups>`,
    );
    expect(c.options(node)[0].members[0].groupIds).toEqual(['sg', 'gl']);
  });
  it('sorts by sortIndex, with the rest after in file order', () => {
    const { c, node } = owner(
      children(
        entry('a', 'A'),
        entry('b', 'B', 0, '', 'sortIndex="2"'),
        entry('c', 'C'),
        entry('d', 'D', 0, '', 'sortIndex="1"'),
      ),
    );
    expect(c.options(node).map((o) => o.key)).toEqual(['d', 'b', 'a', 'c']);
  });
  it('finds an option by key, searching groups', () => {
    const { c, node } = owner(group('g', group('h', children(entry('b', 'B')))));
    expect(c.findOption(node, 'g/h/b')?.node.name).toBe('B');
    expect(c.findOption(node, 'nope')).toBeUndefined();
    expect(c.findOption(null, 'nope')).toBeUndefined();
  });
});

describe('root options', () => {
  it('gathers the army and the game system', () => {
    const c = ctxOf(
      `<selectionEntries>${unit('a', 'A')}</selectionEntries>`,
      `<selectionEntries>${unit('b', 'B')}</selectionEntries>`,
    );
    expect(c.rootOptions().map((o) => o.key)).toEqual(['a', 'b']);
  });
  it('takes importable root entries from a library only when the link asks', () => {
    const lib = (id: string) =>
      catalogue(
        `<selectionEntries>${unit(id + 'yes', 'Yes')}${entry(id + 'no', 'No', 0, '', 'import="false"')}</selectionEntries>`,
        id,
      );
    const make = (flag: boolean, id: string) =>
      new Context(
        gameSystem(),
        catalogue(`<catalogueLinks><catalogueLink targetId="${id}" importRootEntries="${flag}"/></catalogueLinks>`),
        [lib(id)],
      );
    expect(
      make(true, 'x')
        .rootOptions()
        .map((o) => o.key),
    ).toEqual(['xyes']);
    expect(make(false, 'y').rootOptions()).toEqual([]);
  });
  it('follows links between libraries, and survives a loop', () => {
    const a = catalogue(
      `<catalogueLinks><catalogueLink targetId="b" importRootEntries="true"/></catalogueLinks><selectionEntries>${unit('ua', 'UA')}</selectionEntries>`,
      'a',
    );
    const b = catalogue(
      `<catalogueLinks><catalogueLink targetId="a" importRootEntries="true"/></catalogueLinks><selectionEntries>${unit('ub', 'UB')}</selectionEntries>`,
      'b',
    );
    const c = new Context(
      gameSystem(),
      catalogue('<catalogueLinks><catalogueLink targetId="a" importRootEntries="true"/></catalogueLinks>'),
      [a, b],
    );
    expect(c.rootOptions().map((o) => o.key)).toEqual(['ua', 'ub']);
  });
  it('flattens root groups and removes duplicates', () => {
    const g = `<selectionEntryGroup id="sg" name="G">${children(unit('m', 'M'))}</selectionEntryGroup>`;
    const c = ctxOf(
      `<entryLinks><entryLink id="l" targetId="sg" type="selectionEntryGroup"/><entryLink id="l" targetId="sg" type="selectionEntryGroup"/></entryLinks><sharedSelectionEntryGroups>${g}</sharedSelectionEntryGroups>`,
    );
    expect(c.rootOptions().map((o) => o.key)).toEqual(['l/m']);
  });
});

describe('startCost', () => {
  const cost = (inner: string, rest = '') => {
    const c = ctxOf(`<selectionEntries>${unit('u', 'Unit', 10, inner)}</selectionEntries>${rest}`);
    return c.startCost(c.get('u')!, 'pts');
  };
  const min = (n: number) =>
    `<constraints><constraint id="m" type="min" value="${n}" field="selections" scope="parent"/></constraints>`;
  const group = (inner: string, attrs = '') =>
    `<selectionEntryGroups><selectionEntryGroup id="g" name="G" ${attrs}>${inner}</selectionEntryGroup></selectionEntryGroups>`;

  it('is the entry cost when nothing is mandatory', () => {
    expect(cost(children(entry('a', 'A', 5)))).toBe(10);
  });
  it('adds mandatory models', () => {
    expect(cost(children(entry('a', 'A', 5, min(3))))).toBe(25);
  });
  it('uses the default of a mandatory group', () => {
    expect(cost(group(min(1) + children(entry('a', 'A', 1), entry('b', 'B', 7)), 'defaultSelectionEntryId="b"'))).toBe(
      17,
    );
  });
  it('uses the cheapest of a mandatory group without a default', () => {
    expect(cost(group(min(2) + children(entry('a', 'A', 9), entry('b', 'B', 3))))).toBe(16);
  });
  it('does not charge twice for mandatory picks inside a mandatory group', () => {
    expect(cost(group(min(2) + children(entry('a', 'A', 4, min(1)), entry('b', 'B', 3))))).toBe(17);
  });
  it('ignores hidden options', () => {
    expect(cost(children(entry('a', 'A', 5, min(1), 'hidden="true"')))).toBe(10);
  });
  it('ignores an entry with no cost of that type', () => {
    const c = ctxOf(`<selectionEntries>${unit('u', 'Unit', 10)}</selectionEntries>`);
    expect(c.startCost(c.get('u')!, 'pl')).toBe(0);
  });
  it('copes with a mandatory group that has nothing visible', () => {
    expect(cost(group(min(1)))).toBe(10);
  });
  it('survives an entry that contains itself', () => {
    const c = ctxOf(
      `<selectionEntries>${unit('u', 'Unit', 1, `<entryLinks>${link('l', 'u', '', min(1))}</entryLinks>`)}</selectionEntries>`,
    );
    expect(c.startCost(c.get('u')!, 'pts')).toBeGreaterThan(0);
  });
});
