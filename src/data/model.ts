// Light in-memory model of BattleScribe / New Recruit data files (.gst / .cat)

export interface Constraint {
  id: string;
  type: 'min' | 'max';
  value: number;
  field: string; // "selections" | "forces" | costTypeId
  scope: string; // "parent" | "force" | "roster" | entry id ...
  shared: boolean;
  includeChildSelections: boolean;
  includeChildForces: boolean;
  percentValue: boolean;
}

export interface Condition {
  type: string; // lessThan greaterThan equalTo notEqualTo atLeast atMost instanceOf notInstanceOf
  value: number;
  field: string;
  scope: string;
  childId: string;
  shared: boolean;
  includeChildSelections: boolean;
  includeChildForces: boolean;
  percentValue: boolean;
}

export interface ConditionGroup {
  type: 'and' | 'or';
  conditions: Condition[];
  groups: ConditionGroup[];
}

export interface Repeat {
  value: number;
  repeats: number;
  field: string;
  scope: string;
  childId: string;
  shared: boolean;
  roundUp: boolean;
  includeChildSelections: boolean;
  includeChildForces: boolean;
  percentValue: boolean;
}

export interface Modifier {
  type: string; // set increment decrement append add remove set-primary unset-primary multiply
  field: string;
  value: string;
  /** every guard must pass (modifierGroup conditions are flattened into guards) */
  guards: ConditionGroup[];
  repeats: Repeat[];
}

export interface Cost {
  typeId: string;
  value: number;
}

export interface Characteristic {
  name: string;
  typeId: string;
  value: string;
}

export interface Profile {
  id: string;
  name: string;
  typeId: string;
  typeName: string;
  hidden: boolean;
  characteristics: Characteristic[];
  modifiers: Modifier[];
  page?: string;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  hidden: boolean;
  modifiers: Modifier[];
  page?: string;
}

export interface InfoLink {
  id: string;
  name: string;
  targetId: string;
  type: string; // rule | profile | infoGroup
  hidden: boolean;
  modifiers: Modifier[];
}

export interface CategoryLink {
  id: string;
  name: string;
  targetId: string;
  primary: boolean;
  hidden: boolean;
  constraints: Constraint[];
  modifiers: Modifier[];
}

export type NodeTag = 'selectionEntry' | 'selectionEntryGroup' | 'entryLink' | 'forceEntry' | 'categoryEntry';

export interface EntryNode {
  id: string;
  tag: NodeTag;
  name: string;
  /** selectionEntry: unit | model | upgrade; entryLink: selectionEntry | selectionEntryGroup */
  type: string;
  targetId?: string;
  hidden: boolean;
  collective: boolean;
  /** false when import="false": not visible to catalogues that link this file */
  importable: boolean;
  defaultSelectionEntryId?: string;
  constraints: Constraint[];
  costs: Cost[];
  modifiers: Modifier[];
  categoryLinks: CategoryLink[];
  profiles: Profile[];
  rules: Rule[];
  infoLinks: InfoLink[];
  /** selectionEntries, selectionEntryGroups and entryLinks, in file order */
  children: EntryNode[];
  /** display order set by the data author (lower first) */
  sortIndex?: number;
  /** forceEntry only: nested forceEntries */
  forces?: EntryNode[];
  page?: string;
}

export interface CostType {
  id: string;
  name: string;
  defaultCostLimit: number;
}

export interface CatalogueLink {
  targetId: string;
  name: string;
  importRootEntries: boolean;
}

export interface DataFile {
  kind: 'gameSystem' | 'catalogue';
  id: string;
  name: string;
  revision: number;
  gameSystemId?: string;
  library: boolean;
  costTypes: CostType[];
  categoryEntries: EntryNode[];
  forceEntries: EntryNode[];
  /** root selectionEntries + entryLinks */
  rootEntries: EntryNode[];
  sharedEntries: EntryNode[];
  sharedProfiles: Profile[];
  sharedRules: Rule[];
  sharedInfoGroups: EntryNode[];
  catalogueLinks: CatalogueLink[];
  /** profile type id -> characteristic names in order */
  profileTypes: { id: string; name: string; columns: { id: string; name: string }[] }[];
}
