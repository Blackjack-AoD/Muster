// Parse BattleScribe XML (.gst/.cat) into the light model.
// Works with any W3C-style DOM (browser DOMParser or @xmldom/xmldom in tests).
import type {
  CategoryLink, Characteristic, Condition, ConditionGroup, Constraint, Cost, DataFile,
  EntryNode, InfoLink, Modifier, NodeTag, Profile, Repeat, Rule,
} from './model';

type El = Element;

function kids(el: El | null | undefined, name?: string): El[] {
  const out: El[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const e = n as El;
      if (!name || (e.localName || e.nodeName) === name) out.push(e);
    }
  }
  return out;
}
function kid(el: El | null | undefined, name: string): El | undefined {
  if (!el) return undefined;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && ((n as El).localName || n.nodeName) === name) return n as El;
  }
  return undefined;
}
/** children of a wrapper element, e.g. <constraints><constraint/></constraints> */
function list(el: El, wrapper: string, item: string): El[] {
  return kids(kid(el, wrapper), item);
}
const a = (el: El, n: string, d = '') => el.getAttribute(n) ?? d;
const b = (el: El, n: string) => el.getAttribute(n) === 'true';
const num = (el: El, n: string, d = 0) => {
  const v = el.getAttribute(n);
  if (v == null || v === '') return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const text = (el: El | undefined) => (el ? (el.textContent ?? '').trim() : '');

function constraint(el: El): Constraint {
  return {
    id: a(el, 'id'),
    type: a(el, 'type') as 'min' | 'max',
    value: num(el, 'value'),
    field: a(el, 'field', 'selections'),
    scope: a(el, 'scope', 'parent'),
    shared: b(el, 'shared'),
    includeChildSelections: b(el, 'includeChildSelections'),
    includeChildForces: b(el, 'includeChildForces'),
    percentValue: b(el, 'percentValue'),
  };
}

function condition(el: El): Condition {
  return {
    type: a(el, 'type'),
    value: num(el, 'value'),
    field: a(el, 'field', 'selections'),
    scope: a(el, 'scope', 'parent'),
    childId: a(el, 'childId', 'any'),
    shared: b(el, 'shared'),
    includeChildSelections: b(el, 'includeChildSelections'),
    includeChildForces: b(el, 'includeChildForces'),
    percentValue: b(el, 'percentValue'),
  };
}

function conditionGroup(el: El): ConditionGroup {
  return {
    type: (a(el, 'type', 'and') as 'and' | 'or'),
    conditions: list(el, 'conditions', 'condition').map(condition),
    groups: list(el, 'conditionGroups', 'conditionGroup').map(conditionGroup),
  };
}

function repeat(el: El): Repeat {
  return {
    value: num(el, 'value', 1),
    repeats: num(el, 'repeats', 1),
    field: a(el, 'field', 'selections'),
    scope: a(el, 'scope', 'parent'),
    childId: a(el, 'childId', 'any'),
    shared: b(el, 'shared'),
    roundUp: b(el, 'roundUp'),
    includeChildSelections: b(el, 'includeChildSelections'),
    includeChildForces: b(el, 'includeChildForces'),
    percentValue: b(el, 'percentValue'),
  };
}

function guardOf(el: El): ConditionGroup | null {
  const conditions = list(el, 'conditions', 'condition').map(condition);
  const groups = list(el, 'conditionGroups', 'conditionGroup').map(conditionGroup);
  if (!conditions.length && !groups.length) return null;
  return { type: 'and', conditions, groups };
}

function modifiers(el: El, inherited: ConditionGroup[] = [], inheritedRepeats: Repeat[] = []): Modifier[] {
  const out: Modifier[] = [];
  for (const m of list(el, 'modifiers', 'modifier')) {
    const g = guardOf(m);
    out.push({
      type: a(m, 'type'),
      field: a(m, 'field'),
      value: a(m, 'value'),
      guards: g ? [...inherited, g] : inherited,
      repeats: [...inheritedRepeats, ...list(m, 'repeats', 'repeat').map(repeat)],
    });
  }
  for (const mg of list(el, 'modifierGroups', 'modifierGroup')) {
    const g = guardOf(mg);
    const guards = g ? [...inherited, g] : inherited;
    out.push(...modifiers(mg, guards, [...inheritedRepeats, ...list(mg, 'repeats', 'repeat').map(repeat)]));
  }
  return out;
}

function costs(el: El): Cost[] {
  return list(el, 'costs', 'cost').map((c) => ({ typeId: a(c, 'typeId'), value: num(c, 'value') }));
}

function profile(el: El): Profile {
  return {
    id: a(el, 'id'),
    name: a(el, 'name'),
    typeId: a(el, 'typeId'),
    typeName: a(el, 'typeName'),
    hidden: b(el, 'hidden'),
    page: a(el, 'page') || undefined,
    characteristics: list(el, 'characteristics', 'characteristic').map(
      (c): Characteristic => ({ name: a(c, 'name'), typeId: a(c, 'typeId'), value: text(c) }),
    ),
    modifiers: modifiers(el),
  };
}

function rule(el: El): Rule {
  return {
    id: a(el, 'id'),
    name: a(el, 'name'),
    hidden: b(el, 'hidden'),
    page: a(el, 'page') || undefined,
    description: text(kid(el, 'description')),
    modifiers: modifiers(el),
  };
}

function infoLink(el: El): InfoLink {
  return {
    id: a(el, 'id'),
    name: a(el, 'name'),
    targetId: a(el, 'targetId'),
    type: a(el, 'type'),
    hidden: b(el, 'hidden'),
    modifiers: modifiers(el),
  };
}

function categoryLink(el: El): CategoryLink {
  return {
    id: a(el, 'id'),
    name: a(el, 'name'),
    targetId: a(el, 'targetId'),
    primary: b(el, 'primary'),
    hidden: b(el, 'hidden'),
    constraints: list(el, 'constraints', 'constraint').map(constraint),
    modifiers: modifiers(el),
  };
}

const CHILD_WRAPPERS: [string, string][] = [
  ['selectionEntries', 'selectionEntry'],
  ['selectionEntryGroups', 'selectionEntryGroup'],
  ['entryLinks', 'entryLink'],
];

export function entry(el: El, tag?: NodeTag): EntryNode {
  const t = (tag || el.localName || el.nodeName) as NodeTag;
  const children: EntryNode[] = [];
  for (const [w, i] of CHILD_WRAPPERS) for (const c of list(el, w, i)) children.push(entry(c, i as NodeTag));
  const n: EntryNode = {
    id: a(el, 'id'),
    tag: t,
    name: a(el, 'name'),
    type: a(el, 'type'),
    hidden: b(el, 'hidden'),
    collective: b(el, 'collective'),
    importable: el.getAttribute('import') !== 'false',
    page: a(el, 'page') || undefined,
    constraints: list(el, 'constraints', 'constraint').map(constraint),
    costs: costs(el),
    modifiers: modifiers(el),
    categoryLinks: list(el, 'categoryLinks', 'categoryLink').map(categoryLink),
    profiles: list(el, 'profiles', 'profile').map(profile),
    rules: list(el, 'rules', 'rule').map(rule),
    infoLinks: list(el, 'infoLinks', 'infoLink').map(infoLink),
    children,
  };
  const tid = el.getAttribute('targetId');
  if (tid) n.targetId = tid;
  const def = el.getAttribute('defaultSelectionEntryId');
  if (def) n.defaultSelectionEntryId = def;
  if (t === 'forceEntry') n.forces = list(el, 'forceEntries', 'forceEntry').map((f) => entry(f, 'forceEntry'));
  return n;
}

export function parseDataFile(root: El): DataFile {
  const kind = (root.localName || root.nodeName) === 'gameSystem' ? 'gameSystem' : 'catalogue';
  const shared: EntryNode[] = [];
  for (const c of list(root, 'sharedSelectionEntries', 'selectionEntry')) shared.push(entry(c, 'selectionEntry'));
  for (const c of list(root, 'sharedSelectionEntryGroups', 'selectionEntryGroup')) shared.push(entry(c, 'selectionEntryGroup'));
  const rootEntries: EntryNode[] = [];
  for (const c of list(root, 'selectionEntries', 'selectionEntry')) rootEntries.push(entry(c, 'selectionEntry'));
  for (const c of list(root, 'entryLinks', 'entryLink')) rootEntries.push(entry(c, 'entryLink'));
  return {
    kind,
    id: a(root, 'id'),
    name: a(root, 'name'),
    revision: num(root, 'revision'),
    gameSystemId: a(root, 'gameSystemId') || undefined,
    library: b(root, 'library'),
    costTypes: list(root, 'costTypes', 'costType').map((c) => ({
      id: a(c, 'id'), name: a(c, 'name'), defaultCostLimit: num(c, 'defaultCostLimit', -1),
    })),
    categoryEntries: list(root, 'categoryEntries', 'categoryEntry').map((c) => entry(c, 'categoryEntry')),
    forceEntries: list(root, 'forceEntries', 'forceEntry').map((c) => entry(c, 'forceEntry')),
    rootEntries,
    sharedEntries: shared,
    sharedProfiles: list(root, 'sharedProfiles', 'profile').map(profile),
    sharedRules: list(root, 'sharedRules', 'rule').map(rule),
    sharedInfoGroups: list(root, 'sharedInfoGroups', 'infoGroup').map((c) => entry(c, 'selectionEntry')),
    catalogueLinks: list(root, 'catalogueLinks', 'catalogueLink').map((c) => ({
      targetId: a(c, 'targetId'), name: a(c, 'name'), importRootEntries: b(c, 'importRootEntries'),
    })),
    profileTypes: list(root, 'profileTypes', 'profileType').map((p) => ({
      id: a(p, 'id'), name: a(p, 'name'),
      columns: list(p, 'characteristicTypes', 'characteristicType').map((c) => ({ id: a(c, 'id'), name: a(c, 'name') })),
    })),
  };
}

/** Quick header read without a full parse (used for the library listing). */
export function readHeader(xml: string): { kind: 'gameSystem' | 'catalogue'; id: string; name: string; revision: number; gameSystemId?: string; library: boolean } | null {
  const m = xml.slice(0, 4000).match(/<(gameSystem|catalogue)\b([^>]*)>/);
  if (!m) return null;
  const attrs = m[2];
  const get = (n: string) => attrs.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1];
  return {
    kind: m[1] as 'gameSystem' | 'catalogue',
    id: get('id') || '',
    name: decodeXml(get('name') || ''),
    revision: Number(get('revision') || 0),
    gameSystemId: get('gameSystemId'),
    library: get('library') === 'true',
  };
}

export function decodeXml(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
