import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { decodeXml, entry, readHeader } from './parse';
import { catalogue, gameSystem, parseXml } from '../test/fixture';

const el = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml').documentElement as unknown as Element;

describe('parseDataFile', () => {
  it('reads a game system', () => {
    const g = gameSystem('<profileTypes><profileType id="pt" name="Unit"><characteristicTypes><characteristicType id="m" name="M"/><characteristicType id="s" name="S"/></characteristicTypes></profileType></profileTypes>');
    expect(g).toMatchObject({ kind: 'gameSystem', id: 'gst', name: 'Test Game', revision: 1, library: false });
    expect(g.costTypes.map((c) => c.name)).toEqual(['pts', 'PL']);
    expect(g.costTypes[1].defaultCostLimit).toBe(-1);
    expect(g.profileTypes[0]).toEqual({ id: 'pt', name: 'Unit', columns: [{ id: 'm', name: 'M' }, { id: 's', name: 'S' }] });
  });

  it('reads a catalogue and its links', () => {
    const c = catalogue('<catalogueLinks><catalogueLink targetId="lib" name="Library" importRootEntries="true"/></catalogueLinks>', 'c1', 'library="true"');
    expect(c).toMatchObject({ kind: 'catalogue', id: 'c1', gameSystemId: 'gst', library: true });
    expect(c.catalogueLinks).toEqual([{ targetId: 'lib', name: 'Library', importRootEntries: true }]);
  });

  it('sorts entries into root and shared', () => {
    const c = catalogue(`
      <selectionEntries><selectionEntry id="r1" name="Root"/></selectionEntries>
      <entryLinks><entryLink id="r2" targetId="s1" type="selectionEntry"/></entryLinks>
      <sharedSelectionEntries><selectionEntry id="s1" name="Shared"/></sharedSelectionEntries>
      <sharedSelectionEntryGroups><selectionEntryGroup id="s2" name="Shared Group"/></sharedSelectionEntryGroups>
      <sharedRules><rule id="ru" name="Rule"><description>  Text  </description></rule></sharedRules>
      <sharedProfiles><profile id="pr" name="Stat" typeId="t" typeName="T"/></sharedProfiles>
      <sharedInfoGroups><infoGroup id="ig" name="Info"/></sharedInfoGroups>`);
    expect(c.rootEntries.map((e) => [e.id, e.tag])).toEqual([['r1', 'selectionEntry'], ['r2', 'entryLink']]);
    expect(c.sharedEntries.map((e) => [e.id, e.tag])).toEqual([['s1', 'selectionEntry'], ['s2', 'selectionEntryGroup']]);
    expect(c.sharedRules[0].description).toBe('Text');
    expect(c.sharedProfiles[0].typeName).toBe('T');
    expect(c.sharedInfoGroups[0].id).toBe('ig');
  });

  it('reads nested force entries', () => {
    const g = gameSystem('<forceEntries><forceEntry id="a" name="A"><forceEntries><forceEntry id="b" name="B"/></forceEntries></forceEntry></forceEntries>');
    expect(g.forceEntries[0].forces![0].name).toBe('B');
  });

  it('tolerates an empty file', () => {
    expect(parseXml('<catalogue/>')).toMatchObject({ id: '', name: '', revision: 0, rootEntries: [] });
  });

  it('falls back to the default for a number it cannot read', () => {
    expect(parseXml('<catalogue revision="abc"/>').revision).toBe(0);
    expect(parseXml('<catalogue revision=""/>').revision).toBe(0);
  });
});

describe('entry', () => {
  it('reads the attributes of an entry', () => {
    const n = entry(el('<selectionEntry id="a" name="A" type="unit" hidden="true" collective="true" import="false" page="12" sortIndex="3" defaultSelectionEntryId="d"/>'));
    expect(n).toMatchObject({ id: 'a', name: 'A', tag: 'selectionEntry', type: 'unit', hidden: true, collective: true, importable: false, page: '12', sortIndex: 3, defaultSelectionEntryId: 'd' });
  });
  it('leaves optional attributes out, and is importable unless told otherwise', () => {
    const n = entry(el('<selectionEntry id="a" name="A" sortIndex="oops"/>'));
    expect(n.importable).toBe(true);
    expect(n.sortIndex).toBeUndefined();
    expect(n.targetId).toBeUndefined();
    expect(n.page).toBeUndefined();
  });
  it('keeps the target of a link', () => {
    expect(entry(el('<entryLink id="a" targetId="t"/>')).targetId).toBe('t');
  });
  it('gathers children of all three kinds', () => {
    const n = entry(el(`<selectionEntry id="a">
      <selectionEntries><selectionEntry id="b"/></selectionEntries>
      <selectionEntryGroups><selectionEntryGroup id="c"/></selectionEntryGroups>
      <entryLinks><entryLink id="d"/></entryLinks></selectionEntry>`));
    expect(n.children.map((c) => c.tag)).toEqual(['selectionEntry', 'selectionEntryGroup', 'entryLink']);
  });
  it('reads a constraint, defaulting field and scope', () => {
    const n = entry(el(`<selectionEntry><constraints>
      <constraint id="c" type="max" value="3" shared="true" includeChildSelections="true" includeChildForces="true" percentValue="true"/>
    </constraints></selectionEntry>`));
    expect(n.constraints[0]).toEqual({ id: 'c', type: 'max', value: 3, field: 'selections', scope: 'parent', shared: true, includeChildSelections: true, includeChildForces: true, percentValue: true });
  });
  it('reads conditions and groups into a modifier guard', () => {
    const n = entry(el(`<selectionEntry><modifiers><modifier type="set" field="hidden" value="true">
      <conditions><condition type="equalTo" value="2" field="selections" scope="force" childId="x"/></conditions>
      <conditionGroups><conditionGroup type="or"><conditions><condition type="atLeast"/></conditions><conditionGroups><conditionGroup/></conditionGroups></conditionGroup></conditionGroups>
    </modifier></modifiers></selectionEntry>`));
    const [g] = n.modifiers[0].guards;
    expect(g.type).toBe('and');
    expect(g.conditions[0]).toMatchObject({ type: 'equalTo', value: 2, scope: 'force', childId: 'x' });
    expect(g.groups[0].type).toBe('or');
    expect(g.groups[0].conditions[0]).toMatchObject({ field: 'selections', scope: 'parent', childId: 'any' });
    expect(g.groups[0].groups[0]).toEqual({ type: 'and', conditions: [], groups: [] });
  });
  it('gives an unguarded modifier no guards', () => {
    const n = entry(el('<selectionEntry><modifiers><modifier type="set" field="name" value="x"/></modifiers></selectionEntry>'));
    expect(n.modifiers[0]).toEqual({ type: 'set', field: 'name', value: 'x', guards: [], repeats: [] });
  });
  it('reads a repeat with defaults', () => {
    const n = entry(el('<selectionEntry><modifiers><modifier type="increment" field="pts" value="1"><repeats><repeat/></repeats></modifier></modifiers></selectionEntry>'));
    expect(n.modifiers[0].repeats[0]).toMatchObject({ value: 1, repeats: 1, field: 'selections', scope: 'parent', childId: 'any', roundUp: false });
  });
  it('flattens modifier groups, combining guards and repeats', () => {
    const cond = (v: number) => `<conditions><condition type="atLeast" value="${v}"/></conditions>`;
    const n = entry(el(`<selectionEntry><modifierGroups><modifierGroup>${cond(1)}<repeats><repeat value="2"/></repeats>
      <modifiers><modifier type="set" field="a" value="1">${cond(2)}<repeats><repeat value="3"/></repeats></modifier><modifier type="set" field="b" value="1"/></modifiers>
      <modifierGroups><modifierGroup><modifiers><modifier type="set" field="c" value="1"/></modifiers></modifierGroup></modifierGroups>
    </modifierGroup></modifierGroups></selectionEntry>`));
    const [a, b, c] = n.modifiers;
    expect(a.guards.map((g) => g.conditions[0].value)).toEqual([1, 2]);
    expect(a.repeats.map((r) => r.value)).toEqual([2, 3]);
    expect(b.guards).toHaveLength(1);
    expect(c.guards).toHaveLength(1);
    expect(c.repeats.map((r) => r.value)).toEqual([2]);
  });
  it('reads profiles, rules, links and category links', () => {
    const n = entry(el(`<selectionEntry>
      <profiles><profile id="p" name="Stat" typeId="t" typeName="T" hidden="true" page="9"><characteristics><characteristic name="M" typeId="m"> 6 </characteristic></characteristics></profile></profiles>
      <rules><rule id="r" name="Rule" hidden="true"/></rules>
      <infoLinks><infoLink id="i" name="L" targetId="t" type="rule" hidden="true"/></infoLinks>
      <categoryLinks><categoryLink id="c" name="HQ" targetId="hq" primary="true"/></categoryLinks>
    </selectionEntry>`));
    expect(n.profiles[0]).toMatchObject({ hidden: true, page: '9', characteristics: [{ name: 'M', typeId: 'm', value: '6' }] });
    expect(n.rules[0]).toMatchObject({ id: 'r', hidden: true, description: '' });
    expect(n.infoLinks[0]).toMatchObject({ targetId: 't', type: 'rule', hidden: true });
    expect(n.categoryLinks[0]).toMatchObject({ targetId: 'hq', primary: true, hidden: false });
  });
});

describe('readHeader', () => {
  it('reads a catalogue header without parsing the file', () => {
    expect(readHeader('<?xml version="1.0"?><catalogue id="c" name="Orks &amp; Goblins" revision="7" gameSystemId="g" library="true"><broken')).toEqual({
      kind: 'catalogue', id: 'c', name: 'Orks & Goblins', revision: 7, gameSystemId: 'g', library: true,
    });
  });
  it('reads a game system header with defaults', () => {
    expect(readHeader('<gameSystem>')).toEqual({ kind: 'gameSystem', id: '', name: '', revision: 0, gameSystemId: undefined, library: false });
  });
  it('gives up on anything else', () => {
    expect(readHeader('<html></html>')).toBeNull();
  });
  it('does not confuse gameSystemId with id', () => {
    expect(readHeader('<catalogue gameSystemId="g" id="c">')?.id).toBe('c');
  });
});

describe('decodeXml', () => {
  it('decodes the five named entities', () => {
    expect(decodeXml('&quot;&apos;&lt;&gt;&amp;')).toBe(`"'<>&`);
  });
  it('decodes once only', () => {
    expect(decodeXml('&amp;lt;')).toBe('&lt;');
  });
});
