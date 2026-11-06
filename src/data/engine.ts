// Roster evaluation: option trees, modifiers/conditions, costs, and validation.
import type { Context, Opt, RNode } from './catalog';
import type { SavedUnit } from './db';
import type { Condition, ConditionGroup, Constraint, EntryNode, Modifier, Profile, Repeat, Rule } from './model';

export interface Sel {
  uid: string;
  key: string;
  number: number;
  children: Sel[];
  /** root selections: category it was added under */
  categoryId?: string;
  /** the player's name for this unit or model */
  name?: string;
  /** root selections: id of the saved unit this is a copy of */
  saved?: string;
}
export interface Force {
  uid: string;
  forceEntryId: string;
  catalogueId: string;
  selections: Sel[];
}
export interface Roster {
  uid: string;
  name: string;
  repo: string;
  gameSystemId: string;
  costLimit: number;
  forces: Force[];
  created: number;
  updated: number;
}

export interface RSel {
  sel: Sel;
  opt: Opt;
  node: RNode;
  parent: RSel | null;
  force: RForce;
  children: RSel[];
  /** saved children the data no longer has */
  broken: Sel[];
  eff: Eff;
  total: number;
}
export interface RForce {
  force: Force;
  ctx: Context;
  entry: EntryNode;
  roots: RSel[];
  broken: Sel[];
  total: number;
}
export interface Eff {
  name: string;
  hidden: boolean;
  costs: Map<string, number>;
  constraints: Constraint[];
  categories: Set<string>;
  primary?: string;
  /** set by a defaultSelectionEntryId modifier */
  defaultId?: string;
}
/** How far an issue applies, and so where it shows. Issues merge only within this. */
type IssuePlace =
  | { reach: 'list'; forceUid?: string; selUid?: string }
  | { reach: 'force'; forceUid: string; selUid?: string }
  | { reach: 'unit'; forceUid: string; selUid: string };
export type Issue = IssuePlace & { level: 'error' | 'warn'; message: string };

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function rootOf(rs: RSel): RSel {
  let top = rs;
  while (top.parent) top = top.parent;
  return top;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

interface Where {
  self: RSel | null;
  parent: RSel | null;
  force: RForce;
  /** candidate (not yet selected) option being evaluated */
  opt?: Opt;
}

/** The place of a limit that counts across units, so it belongs to no one unit. */
const widePlace = (c: Constraint, forceUid: string, selUid?: string): IssuePlace =>
  c.scope === 'roster' ? { reach: 'list', forceUid, selUid } : { reach: 'force', forceUid, selUid };

/** Issues with the same text are one issue when this matches. */
function reachId(i: Issue): string | undefined {
  switch (i.reach) {
    case 'list':
      return undefined;
    case 'force':
      return i.forceUid;
    case 'unit':
      return i.selUid;
    default: {
      const unknown: never = i;
      throw new Error(`Unknown issue reach: ${JSON.stringify(unknown)}`);
    }
  }
}

/** A list whose modifiers never settle stops here. */
const MAX_EFF_PASSES = 5;

export class Evaluator {
  forces: RForce[] = [];
  issues: Issue[] = [];
  total = 0;
  pointsTypeId = '';
  private bySel = new Map<string, RSel>();

  constructor(
    public roster: Roster,
    private contexts: Map<string, Context>,
  ) {
    this.build();
  }

  ctxFor(f: Force): Context {
    const ctx = this.contexts.get(f.catalogueId);
    if (!ctx) throw new Error('This army is no longer in the synced data');
    return ctx;
  }

  find(selUid: string) {
    return this.bySel.get(selUid);
  }

  // ---------- build runtime tree ----------
  private build() {
    for (const f of this.roster.forces) {
      const ctx = this.contexts.get(f.catalogueId);
      if (!ctx) continue;
      this.pointsTypeId = ctx.pointsType()?.id ?? '';
      const entry = ctx.get(f.forceEntryId) ?? standInForceEntry(f.forceEntryId);
      const rf: RForce = { force: f, ctx, entry, roots: [], broken: [], total: 0 };
      const roots = rootOptionsCached(ctx);
      for (const s of f.selections) {
        const opt = ctx.findOption(null, s.key, roots);
        if (!opt) {
          rf.broken.push(s);
          continue;
        }
        rf.roots.push(this.buildSel(s, opt, null, rf));
      }
      this.forces.push(rf);
    }
    // effective properties need the full tree, so compute after building
    this.computeEffs();
    for (const rf of this.forces) {
      rf.total = rf.roots.reduce((t, r) => t + this.computeTotal(r), 0);
      this.total += rf.total;
    }
    this.validate();
  }

  private buildSel(s: Sel, opt: Opt, parent: RSel | null, force: RForce): RSel {
    const rs: RSel = {
      sel: s,
      opt,
      node: opt.node,
      parent,
      force,
      children: [],
      broken: [],
      total: 0,
      eff: { name: opt.node.name, hidden: false, costs: new Map(), constraints: [], categories: new Set() },
    };
    this.bySel.set(s.uid, rs);
    for (const c of s.children) {
      const o = force.ctx.findOption(opt.node, c.key);
      if (o?.kind === 'entry') rs.children.push(this.buildSel(c, o, rs, force));
      else rs.broken.push(c);
    }
    // base categories (needed before modifiers can be evaluated anywhere)
    for (const cl of rs.node.categoryLinks) rs.eff.categories.add(cl.targetId);
    rs.eff.primary = s.categoryId ?? rs.node.categoryLinks.find((c) => c.primary)?.targetId;
    return rs;
  }

  /** Each pass reads only the pass before, so the order it visits selections in can't change a result. */
  private computeEffs() {
    const sels = [...this.bySel.values()];
    for (let pass = 0; pass < MAX_EFF_PASSES; pass++) {
      const next = sels.map((rs) => ({
        rs,
        eff: this.effective(rs.node, { self: rs, parent: rs.parent, force: rs.force }, rs.sel.categoryId),
      }));
      const settled = next.every(({ rs, eff }) => sameEff(rs.eff, eff));
      for (const { rs, eff } of next) rs.eff = eff;
      if (settled) return;
    }
  }

  /** A selection with number N stands for N identical models/items; its children are per one of them. */
  private computeTotal(rs: RSel): number {
    const own = rs.eff.costs.get(this.pointsTypeId) ?? 0;
    rs.total = rs.sel.number * (own + rs.children.reduce((t, c) => t + this.computeTotal(c), 0));
    return rs.total;
  }

  // ---------- effective values (modifiers) ----------
  effective(node: EntryNode, w: Where, primaryOverride?: string): Eff {
    const eff: Eff = {
      name: node.name,
      hidden: node.hidden,
      costs: new Map(node.costs.map((c) => [c.typeId, c.value])),
      constraints: node.constraints.map((c) => ({ ...c })),
      categories: new Set(node.categoryLinks.map((c) => c.targetId)),
      primary: primaryOverride ?? node.categoryLinks.find((c) => c.primary)?.targetId,
    };
    for (const m of node.modifiers) {
      const times = this.modTimes(m, w);
      if (!times) continue;
      this.applyMod(eff, m, times);
    }
    return eff;
  }

  private applyMod(eff: Eff, m: Modifier, times: number) {
    const v = m.value;
    const n = Number(v);
    switch (m.field) {
      case 'hidden':
        if (m.type === 'set') eff.hidden = v === 'true';
        return;
      case 'name':
        if (m.type === 'set') eff.name = v;
        else if (m.type === 'append') eff.name = `${eff.name} ${v}`;
        return;
      case 'defaultSelectionEntryId':
        if (m.type === 'set') eff.defaultId = v;
        return;
      case 'category':
        if (m.type === 'add') eff.categories.add(v);
        else if (m.type === 'remove') eff.categories.delete(v);
        else if (m.type === 'set-primary') {
          eff.categories.add(v);
          eff.primary = v;
        } else if (m.type === 'unset-primary' && eff.primary === v) eff.primary = undefined;
        return;
    }
    if (eff.costs.has(m.field) || this.isCostType(m.field)) {
      const cur = eff.costs.get(m.field) ?? 0;
      eff.costs.set(m.field, numOp(m.type, cur, n, times));
      return;
    }
    const c = eff.constraints.find((x) => x.id === m.field);
    if (c) c.value = numOp(m.type, c.value, n, times);
  }

  private isCostType(id: string) {
    for (const rf of this.forces) if (rf.ctx.costTypes.some((c) => c.id === id)) return true;
    for (const c of this.contexts.values()) return c.costTypes.some((x) => x.id === id);
    return false;
  }

  private modTimes(m: Modifier, w: Where): number {
    for (const g of m.guards) if (!this.group(g, w)) return 0;
    if (!m.repeats.length) return 1;
    let t = 0;
    for (const r of m.repeats) t += this.repeatTimes(r, w);
    return t;
  }

  private repeatTimes(r: Repeat, w: Where) {
    const c = this.measure(r, w);
    if (r.value <= 0) return 0;
    const q = c / r.value;
    return (r.roundUp ? Math.ceil(q) : Math.floor(q)) * r.repeats;
  }

  private group(g: ConditionGroup, w: Where): boolean {
    const results = [...g.conditions.map((c) => this.cond(c, w)), ...g.groups.map((x) => this.group(x, w))];
    if (!results.length) return true;
    return g.type === 'or' ? results.some(Boolean) : results.every(Boolean);
  }

  cond(c: Condition, w: Where): boolean {
    if (c.type === 'instanceOf' || c.type === 'notInstanceOf') {
      const r = this.instanceOf(c, w);
      return c.type === 'instanceOf' ? r : !r;
    }
    const v = this.measure(c, w);
    switch (c.type) {
      case 'lessThan':
        return v < c.value;
      case 'greaterThan':
        return v > c.value;
      case 'equalTo':
        return v === c.value;
      case 'notEqualTo':
        return v !== c.value;
      case 'atLeast':
        return v >= c.value;
      case 'atMost':
        return v <= c.value;
      default:
        return false;
    }
  }

  private instanceOf(c: Condition, w: Where): boolean {
    const id = c.childId;
    const selfMatch = (rs: RSel | null) => !!rs && this.matches(rs, id);
    switch (c.scope) {
      case 'self':
        if (w.self) return selfMatch(w.self);
        return (
          !!w.opt &&
          (w.opt.node.id === id ||
            w.opt.node.linkId === id ||
            w.opt.groupIds.includes(id) ||
            w.opt.node.categoryLinks.some((l) => l.targetId === id))
        );
      case 'parent':
        return w.parent ? selfMatch(w.parent) : this.forceMatches(w.force, id);
      case 'force':
        return this.forceMatches(w.force, id);
      case 'roster':
        return this.forces.some((f) => this.forceMatches(f, id)) || id === this.roster.gameSystemId;
      case 'ancestor':
      default: {
        for (let p = w.parent; p; p = p.parent) if (this.matches(p, id)) return true;
        return this.forceMatches(w.force, id);
      }
    }
  }

  private forceMatches(f: RForce, id: string) {
    return id === 'any' || f.force.forceEntryId === id || f.force.catalogueId === id || f.ctx.gst.id === id;
  }

  matches(rs: RSel, id: string): boolean {
    if (id === 'any') return true;
    const n = rs.node;
    return n.id === id || n.linkId === id || rs.opt.groupIds.includes(id) || rs.eff.categories.has(id) || n.type === id;
  }

  /** count / cost measured for a condition or repeat */
  private measure(c: Condition | Repeat, w: Where): number {
    if (c.field === 'forces') {
      const fs = c.scope === 'roster' || c.scope === 'force' ? this.forces : this.forces;
      return fs.filter((f) => this.forceMatches(f, c.childId)).length;
    }
    if (c.field === 'selections' && (c.scope === 'roster' || c.scope === 'force')) {
      // the data also counts a detachment as a selection of its force entry
      const inScope = c.scope === 'force' ? [w.force] : this.forces;
      const detachments = inScope.filter((f) => f.force.forceEntryId === c.childId).length;
      if (detachments) return detachments;
    }
    const containers = this.scopeContainers(c.scope, w);
    const deep =
      c.includeChildSelections || c.scope === 'force' || c.scope === 'roster' ? c.includeChildSelections : false;
    const isCost = c.field !== 'selections';
    let total = 0;
    for (const items of containers) total += this.countIn(items, c.childId, deep, isCost ? c.field : null);
    if (c.percentValue && isCost) {
      const all = containers.reduce((t, items) => t + this.countIn(items, 'any', false, c.field), 0);
      return all ? (total / all) * 100 : 0;
    }
    return total;
  }

  private scopeContainers(scope: string, w: Where): RSel[][] {
    switch (scope) {
      case 'self':
        return w.self ? [w.self.children] : [];
      case 'parent':
        return [w.parent ? w.parent.children : w.force.roots];
      case 'primary-category': {
        // units in the force that share this unit's primary category (e.g. "other Elites")
        const inside = w.self ?? w.parent;
        const prim = inside ? rootOf(inside).eff.primary : w.opt?.node.categoryLinks.find((c) => c.primary)?.targetId;
        return prim ? [w.force.roots.filter((r) => r.eff.primary === prim)] : [w.force.roots];
      }
      case 'force':
        return [w.force.roots];
      case 'primary-catalogue':
        return this.forces.filter((f) => f.force.catalogueId === w.force.force.catalogueId).map((f) => f.roots);
      case 'roster':
        return this.forces.map((f) => f.roots);
      case 'ancestor':
        return [w.parent ? w.parent.children : w.force.roots];
      default: {
        // scope is an entry/category/force id: nearest matching ancestor
        for (let p: RSel | null = w.self ?? w.parent; p; p = p.parent) if (this.matches(p, scope)) return [p.children];
        if (this.forceMatches(w.force, scope)) return [w.force.roots];
        return [];
      }
    }
  }

  /** mult: how many copies of these items exist (product of the numbers of the selections above them) */
  private countIn(items: RSel[], childId: string, deep: boolean, costField: string | null, mult = 1): number {
    let t = 0;
    for (const rs of items) {
      if (this.matches(rs, childId)) {
        t += mult * (costField ? this.totalOf(rs, costField) : rs.sel.number);
        if (!deep || costField) continue;
      }
      if (deep) t += this.countIn(rs.children, childId, deep, costField, mult * rs.sel.number);
    }
    return t;
  }

  private totalOf(rs: RSel, costTypeId: string): number {
    const own = rs.eff.costs.get(costTypeId) ?? 0;
    return rs.sel.number * (own + rs.children.reduce((t, c) => t + this.totalOf(c, costTypeId), 0));
  }

  // ---------- options shown to the user ----------
  /** effective view of a (possibly unselected) option beneath parent */
  optionEff(opt: Opt, parent: RSel | null, force: RForce): Eff {
    return this.effective(opt.node, { self: null, parent, force, opt });
  }

  /** current selections under parent that came from this option (entry) or any of a group's members */
  selected(opt: Opt, parent: RSel | null, force: RForce): RSel[] {
    const list = parent ? parent.children : force.roots;
    if (opt.kind === 'entry') return list.filter((c) => c.opt.key === opt.key);
    return list.filter((c) => c.opt.key.startsWith(opt.key + '/'));
  }

  /** min/max (parent scope, selections) after modifiers. max -1 = unlimited */
  limits(opt: Opt, parent: RSel | null, force: RForce, eff?: Eff) {
    const e = eff ?? this.optionEff(opt, parent, force);
    let min = 0;
    let max = -1;
    for (const c of e.constraints) {
      if (c.field !== 'selections' || c.scope !== 'parent') continue;
      if (c.type === 'min') min = Math.max(min, c.value);
      if (c.type === 'max' && c.value >= 0) max = max < 0 ? c.value : Math.min(max, c.value);
    }
    return { min, max };
  }

  /** false when a force- or roster-wide max on this option is already reached */
  roomBeyondParent(opt: Opt, parent: RSel | null, force: RForce, eff?: Eff): boolean {
    const e = eff ?? this.optionEff(opt, parent, force);
    for (const c of e.constraints) {
      if (c.type !== 'max' || c.field !== 'selections' || c.value < 0) continue;
      if (c.scope !== 'force' && c.scope !== 'roster') continue;
      const containers = c.scope === 'roster' ? this.forces.map((f) => f.roots) : [force.roots];
      const n = containers.reduce((t, items) => t + this.countIn(items, opt.node.id, true, null), 0);
      if (n >= c.value) return false;
    }
    return true;
  }

  // ---------- validation ----------
  private validate() {
    for (const rf of this.forces) {
      this.warnSkippedUnits(rf);
      this.checkCategoryLimits(rf);
      for (const o of entryGone(rf) ? [] : forceRootOptions(rf.ctx, rf.entry)) this.checkRootEntry(rf, o);
      for (const r of rf.roots) this.validateSel(r);
    }
    this.warnGoneData();
    this.issues = mergeByReach(this.issues);
    if (this.roster.costLimit > 0 && this.total > this.roster.costLimit) {
      this.issues.push({
        level: 'error',
        reach: 'list',
        message: `Over points limit by ${fmt(this.total - this.roster.costLimit)}`,
      });
    }
  }

  private warnSkippedUnits(rf: RForce) {
    if (rf.broken.length)
      this.issues.push({
        level: 'warn',
        reach: 'force',
        forceUid: rf.force.uid,
        message: `${rf.broken.length} unit(s) no longer exist in the data and were skipped`,
      });
  }

  /** force-org limits on each category of a force */
  private checkCategoryLimits(rf: RForce) {
    for (const cl of rf.entry.categoryLinks) {
      const w: Where = { self: null, parent: null, force: rf };
      const effCons = this.effectiveConstraints(cl.constraints, cl.modifiers, w);
      const cat = rf.ctx.get(cl.targetId);
      const catCons = cat ? this.effectiveConstraints(cat.constraints, cat.modifiers, w) : [];
      const name = cl.name || cat?.name || 'Category';
      for (const c of [...effCons, ...catCons]) this.checkForceConstraint(c, rf, cl.targetId, name);
    }
  }

  /** the limits on a root entry, and a warning on each pick of one that's now hidden */
  private checkRootEntry(rf: RForce, o: Opt) {
    const w: Where = { self: null, parent: null, force: rf, opt: o };
    const eff = this.effective(o.node, w);
    // data can link an entry more than once, often switching one link off: judge each link by its own picks
    const have = rf.roots.filter((r) => r.opt.key === o.key);
    if ((eff.hidden || unavailable(eff)) && !have.length) return;
    for (const c of eff.constraints) {
      if (c.field !== 'selections' && !this.isCostType(c.field)) continue;
      const containers = c.scope === 'roster' ? this.forces.map((f) => f.roots) : [rf.roots];
      if (c.scope !== 'roster' && c.scope !== 'force' && c.scope !== 'parent') continue;
      const field = c.field === 'selections' ? null : c.field;
      const n = containers.reduce((t, items) => t + this.countIn(items, o.node.id, c.includeChildSelections, field), 0);
      this.report(this.pct(c, containers), n, eff.name, widePlace(c, rf.force.uid, have[0]?.sel.uid));
    }
    if (eff.hidden && have.length && this.hiddenByOthers(o.node, w))
      for (const h of have)
        this.issues.push({
          level: 'warn',
          reach: 'unit',
          forceUid: rf.force.uid,
          selUid: h.sel.uid,
          message: `${eff.name} is not available with the current choices`,
        });
  }

  /** what a saved list holds that the data no longer has */
  private warnGoneData() {
    for (const rf of this.forces)
      if (entryGone(rf))
        this.issues.push({
          level: 'warn',
          reach: 'force',
          forceUid: rf.force.uid,
          message: "This detachment's type is no longer in the data",
        });
    for (const rs of this.bySel.values())
      if (rs.broken.length)
        this.issues.push({
          level: 'warn',
          reach: 'unit',
          forceUid: rs.force.force.uid,
          selUid: rs.sel.uid,
          message: `${rs.eff.name}: ${rs.broken.length} item(s) no longer exist in the data and were skipped`,
        });
  }

  /** Data hides an entry once a list has one, to stop a second. That doesn't make the first unavailable. */
  private hiddenByOthers(node: RNode, w: Where): boolean {
    const onItself = (g: ConditionGroup): boolean =>
      g.conditions.some((c) => c.childId === node.id || c.childId === node.linkId) || g.groups.some(onItself);
    let hidden = node.hidden;
    for (const m of node.modifiers) {
      if (m.field !== 'hidden' || m.type !== 'set' || m.guards.some(onItself)) continue;
      if (this.modTimes(m, w)) hidden = m.value === 'true';
    }
    return hidden;
  }

  /** force-org limits for a category in a force, after modifiers */
  categoryLimits(rf: RForce, catId: string) {
    const w: Where = { self: null, parent: null, force: rf };
    const cl = rf.entry.categoryLinks.find((c) => c.targetId === catId);
    const cat = rf.ctx.get(catId);
    const cons = [
      ...(cl ? this.effectiveConstraints(cl.constraints, cl.modifiers, w) : []),
      ...(cat ? this.effectiveConstraints(cat.constraints, cat.modifiers, w) : []),
    ].filter((c) => c.field === 'selections' && (c.scope === 'force' || c.scope === 'parent'));
    let min = 0;
    let max = -1;
    for (const c of cons) {
      if (c.type === 'min') min = Math.max(min, c.value);
      if (c.type === 'max' && c.value >= 0) max = max < 0 ? c.value : Math.min(max, c.value);
    }
    const n = this.countCat(rf.roots, catId, true, null);
    return { min, max, n, bad: (min > 0 && n < min) || (max >= 0 && n > max) };
  }

  private effectiveConstraints(cons: Constraint[], mods: Modifier[], w: Where) {
    const eff: Eff = {
      name: '',
      hidden: false,
      costs: new Map(),
      constraints: cons.map((c) => ({ ...c })),
      categories: new Set(),
    };
    for (const m of mods) {
      const t = this.modTimes(m, w);
      if (t) this.applyMod(eff, m, t);
    }
    return eff.constraints;
  }

  private checkForceConstraint(c: Constraint, rf: RForce, catId: string, name: string) {
    if (c.field !== 'selections' && !this.isCostType(c.field)) return;
    const containers = c.scope === 'roster' ? this.forces.map((f) => f.roots) : [rf.roots];
    const n = containers.reduce(
      (t, items) =>
        t + this.countCat(items, catId, c.includeChildSelections, c.field === 'selections' ? null : c.field),
      0,
    );
    this.report(this.pct(c, containers), n, name, widePlace(c, rf.force.uid));
  }

  /** percentage limits (e.g. "no more than 25% of the army's points") become absolute numbers */
  private pct(c: Constraint, containers: RSel[][]): Constraint {
    if (!c.percentValue) return c;
    const field = c.field === 'selections' ? null : c.field;
    const all = containers.reduce((t, items) => t + this.countIn(items, 'any', false, field), 0);
    return { ...c, value: Math.round((c.value / 100) * all * 100) / 100 };
  }

  /** count selections in a category (root selections use their primary category) */
  private countCat(items: RSel[], catId: string, deep: boolean, costField: string | null, mult = 1): number {
    let t = 0;
    for (const rs of items) {
      if (rs.eff.categories.has(catId) || rs.eff.primary === catId) {
        t += mult * (costField ? this.totalOf(rs, costField) : rs.sel.number);
        continue;
      }
      if (deep) t += this.countCat(rs.children, catId, deep, costField, mult * rs.sel.number);
    }
    return t;
  }

  private report(c: Constraint, n: number, name: string, place: IssuePlace) {
    // say where a wide limit applies ("one per 1,000 points" style caps live at list level)
    const where = c.scope === 'roster' ? ' in the list' : c.scope === 'force' ? ' in this detachment' : '';
    const unit = c.field === 'selections' ? '' : ' pts';
    if (c.type === 'min' && c.value > 0 && n < c.value) {
      this.issues.push({
        level: 'error',
        ...place,
        message: `${name}: needs at least ${fmt(c.value)}${unit}${where} (has ${fmt(n)})`,
      });
    }
    if (c.type === 'max' && c.value >= 0 && n > c.value) {
      this.issues.push({
        level: 'error',
        ...place,
        message: `${name}: at most ${fmt(c.value)}${unit} allowed${where} (has ${fmt(n)})`,
      });
    }
  }

  private validateSel(rs: RSel) {
    this.checkOptions(rs, rs.force.ctx.options(rs.node));
    rs.children.forEach((c) => this.validateSel(c));
  }

  private checkOptions(rs: RSel, opts: Opt[]) {
    for (const o of opts) {
      const eff = this.optionEff(o, rs, rs.force);
      const n = this.selected(o, rs, rs.force).reduce((t, h) => t + h.sel.number, 0);
      if ((eff.hidden || unavailable(eff)) && !n) continue;
      for (const c of eff.constraints) {
        if (c.field !== 'selections') continue;
        if (c.scope === 'parent') this.checkParentLimit(rs, eff.name, c, n);
        else if (c.scope === 'force' || c.scope === 'roster') this.checkWideLimit(rs, o, eff.name, c, n);
        else if (rs.force.ctx.get(c.scope)) this.checkEntryLimit(rs, o, eff.name, c, n);
      }
      if (o.kind === 'group') this.checkOptions(rs, o.members);
    }
  }

  private checkParentLimit(rs: RSel, name: string, c: Constraint, n: number) {
    this.report(c, n, `${rs.eff.name} › ${name}`, {
      reach: 'unit',
      forceUid: rs.force.force.uid,
      selUid: rs.sel.uid,
    });
  }

  private checkWideLimit(rs: RSel, o: Opt, name: string, c: Constraint, n: number) {
    const containers = c.scope === 'roster' ? this.forces.map((f) => f.roots) : [rs.force.roots];
    const total = containers.reduce((t, items) => t + this.countIn(items, o.node.id, true, null), 0);
    if (c.type === 'max' && n) this.report(c, total, name, widePlace(c, rs.force.force.uid, rs.sel.uid));
  }

  /** the scope is an id, not a word: the limit covers what sits inside the nearest selection of that entry */
  private checkEntryLimit(rs: RSel, o: Opt, name: string, c: Constraint, n: number) {
    const [items = []] = this.scopeContainers(c.scope, { self: rs, parent: rs.parent, force: rs.force });
    const total = this.countIn(items, o.node.id, c.includeChildSelections, null);
    if (c.type === 'max' && n) {
      this.report(c, total, name, { reach: 'unit', forceUid: rs.force.force.uid, selUid: rootOf(rs).sel.uid });
    }
  }

  // ---------- display helpers ----------
  /** Profiles for a selection and its selected descendants, with modifiers applied. */
  profilesFor(rs: RSel): Profile[] {
    const out: Profile[] = [];
    const seen = new Set<string>();
    const ctx = rs.force.ctx;
    const visit = (r: RSel) => {
      const w: Where = { self: r, parent: r.parent, force: r.force };
      const list: Profile[] = [...r.node.profiles];
      for (const l of r.node.infoLinks) {
        if (l.type !== 'profile') continue;
        const p = ctx.profile(l.targetId);
        if (p)
          list.push({
            ...p,
            name: l.name || p.name,
            hidden: p.hidden || l.hidden,
            modifiers: [...p.modifiers, ...l.modifiers],
          });
      }
      for (const p of list) {
        const eff = this.profileEff(p, w);
        if (!eff || seen.has(eff.typeId + eff.name)) continue;
        seen.add(eff.typeId + eff.name);
        out.push(eff);
      }
      r.children.forEach(visit);
    };
    visit(rs);
    return out;
  }

  /** rules on a force's set-up entries (e.g. the Legion's "Legiones Astartes" rule), which apply to the whole army */
  armyRules(rf: RForce): Rule[] {
    const out: Rule[] = [];
    const seen = new Set<string>();
    for (const r of rf.roots) {
      if (r.node.type === 'unit' || r.node.type === 'model') continue;
      for (const x of this.rulesFor(r))
        if (!seen.has(x.name)) {
          seen.add(x.name);
          out.push(x);
        }
    }
    return out;
  }

  ruleEff(r: Rule, w: Where): Rule | null {
    if (!r.modifiers.length) return r.hidden ? null : r;
    const q: Rule = { ...r };
    for (const m of r.modifiers) {
      if (!this.modTimes(m, w)) continue;
      if (m.field === 'hidden') {
        if (m.type === 'set') q.hidden = m.value === 'true';
      } else if (m.field === 'name')
        q.name = m.type === 'append' ? `${q.name} ${m.value}` : m.type === 'set' ? m.value : q.name;
      else if (m.field === 'description')
        q.description =
          m.type === 'append' ? `${q.description} ${m.value}`.trim() : m.type === 'set' ? m.value : q.description;
    }
    return q.hidden ? null : q;
  }

  profileEff(p: Profile, w: Where): Profile | null {
    if (!p.modifiers.length) return p.hidden ? null : p;
    const q: Profile = { ...p, characteristics: p.characteristics.map((c) => ({ ...c })) };
    for (const m of p.modifiers) {
      const t = this.modTimes(m, w);
      if (!t) continue;
      if (m.field === 'hidden') {
        if (m.type === 'set') q.hidden = m.value === 'true';
        continue;
      }
      if (m.field === 'name') {
        q.name = m.type === 'append' ? `${q.name} ${m.value}` : m.value;
        continue;
      }
      const ch = q.characteristics.find((c) => c.typeId === m.field);
      if (!ch) continue;
      if (m.type === 'set') ch.value = m.value;
      else if (m.type === 'append') ch.value = `${ch.value} ${m.value}`.trim();
      else if (m.type === 'increment' || m.type === 'decrement') {
        const mm = ch.value.match(/-?\d+/);
        if (mm) ch.value = ch.value.replace(mm[0], String(numOp(m.type, Number(mm[0]), Number(m.value), t)));
      }
    }
    return q.hidden ? null : q;
  }

  rulesFor(rs: RSel): Rule[] {
    const out: Rule[] = [];
    const seen = new Set<string>();
    const ctx = rs.force.ctx;
    const visit = (r: RSel) => {
      const w: Where = { self: r, parent: r.parent, force: r.force };
      const list: Rule[] = [...r.node.rules];
      const links = [...r.node.infoLinks];
      // rules that come with a category (e.g. "Independent Character", "Character")
      for (const catId of r.eff.categories) {
        const cat = ctx.get(catId);
        if (!cat || cat.tag !== 'categoryEntry') continue;
        list.push(...cat.rules);
        links.push(...cat.infoLinks);
      }
      for (const l of links) {
        if (l.type !== 'rule') continue;
        const rr = ctx.rule(l.targetId);
        if (rr)
          list.push({
            ...rr,
            name: l.name || rr.name,
            hidden: rr.hidden || l.hidden,
            modifiers: [...rr.modifiers, ...l.modifiers],
          });
      }
      for (const x0 of list) {
        const x = this.ruleEff(x0, w);
        if (!x || seen.has(x.name)) continue;
        seen.add(x.name);
        out.push(x);
      }
      r.children.forEach(visit);
    };
    visit(rs);
    return out;
  }
}

/** Each unit with the entry checks a wide limit, so the limit comes up many times: keep one within its reach. */
function mergeByReach(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = [i.level, i.reach, reachId(i), i.message].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function sameEff(a: Eff, b: Eff): boolean {
  if (a.name !== b.name || a.hidden !== b.hidden || a.primary !== b.primary || a.defaultId !== b.defaultId)
    return false;
  if (a.costs.size !== b.costs.size || a.categories.size !== b.categories.size) return false;
  if (a.constraints.length !== b.constraints.length) return false;
  for (const [id, value] of a.costs) if (b.costs.get(id) !== value) return false;
  for (const id of a.categories) if (!b.categories.has(id)) return false;
  return a.constraints.every((c, i) => c.value === b.constraints[i].value);
}

/** an option whose max is 0 can't be taken right now (data uses this instead of hiding) */
export function unavailable(eff: Eff) {
  return eff.constraints.some((c) => c.type === 'max' && c.value === 0 && c.field === 'selections');
}

/** switched off by the option's own limit (as opposed to a list-wide cap that's currently 0) */
export function unavailableHere(eff: Eff) {
  return eff.constraints.some(
    (c) => c.type === 'max' && c.value === 0 && c.field === 'selections' && c.scope === 'parent',
  );
}

/** Takes the place of a force entry the data no longer has: it sets no limits on the force. */
function standInForceEntry(id: string): EntryNode {
  return {
    id,
    tag: 'forceEntry',
    name: 'Force',
    type: '',
    hidden: false,
    collective: false,
    importable: true,
    constraints: [],
    costs: [],
    modifiers: [],
    categoryLinks: [],
    profiles: [],
    rules: [],
    infoLinks: [],
    children: [],
  };
}

/** with its entry gone, nothing says which root entries belong to a force */
function entryGone(rf: RForce): boolean {
  return !rf.ctx.get(rf.force.forceEntryId);
}

const holds = (rs: RSel, selUid: string): boolean => rs.sel.uid === selUid || rs.children.some((c) => holds(c, selUid));

/** The issues on a selection and on anything beneath it. */
export function issuesOn(ev: Evaluator, rs: RSel): Issue[] {
  return ev.issues.filter((i) => i.selUid && holds(rs, i.selUid));
}

const forceRootCache = new WeakMap<EntryNode, Map<Context, Opt[]>>();
/** root options whose primary category belongs to this force type, and those with no category */
export function forceRootOptions(ctx: Context, forceEntry: EntryNode): Opt[] {
  let m = forceRootCache.get(forceEntry);
  if (!m) forceRootCache.set(forceEntry, (m = new Map()));
  let r = m.get(ctx);
  if (!r) {
    const cats = new Set(forceEntry.categoryLinks.map((c) => c.targetId));
    r = rootOptionsCached(ctx).filter((o) => {
      if (!cats.size) return true;
      const prim = o.node.categoryLinks.find((c) => c.primary) ?? o.node.categoryLinks[0];
      // an entry with no category (e.g. the choice of Chapter) takes no slot, so every force can have it
      return prim ? cats.has(prim.targetId) : true;
    });
    m.set(ctx, r);
  }
  return r;
}

const rootCache = new WeakMap<Context, Opt[]>();
export function rootOptionsCached(ctx: Context) {
  let r = rootCache.get(ctx);
  if (!r) {
    r = ctx.rootOptions();
    rootCache.set(ctx, r);
  }
  return r;
}

function numOp(type: string, cur: number, n: number, times: number) {
  if (!Number.isFinite(n)) return cur;
  switch (type) {
    case 'set':
      return n;
    case 'increment':
      return cur + n * times;
    case 'decrement':
      return cur - n * times;
    case 'multiply':
      return cur * n;
    default:
      return cur;
  }
}

export function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------- roster mutations ----------
function findSelIn(list: Sel[], selUid: string): { list: Sel[]; sel: Sel } | null {
  for (const s of list) {
    if (s.uid === selUid) return { list, sel: s };
    const r = findSelIn(s.children, selUid);
    if (r) return r;
  }
  return null;
}

export function locate(roster: Roster, selUid: string) {
  for (const f of roster.forces) {
    const r = findSelIn(f.selections, selUid);
    if (r) return { force: f, ...r };
  }
  return null;
}

export function removeSel(roster: Roster, selUid: string) {
  const r = locate(roster, selUid);
  if (r) r.list.splice(r.list.indexOf(r.sel), 1);
}

function giveNewUids(s: Sel): Sel {
  s.uid = uid();
  s.children.forEach(giveNewUids);
  return s;
}

/**
 * A copy of a selection, with new uids throughout, placed straight after it.
 * A copy of a root unit drops its name and saved unit, as a list holds a saved unit at most once.
 */
export function duplicateSel(roster: Roster, selUid: string): Sel | null {
  const loc = locate(roster, selUid);
  if (!loc) return null;
  const copy = giveNewUids(structuredClone(loc.sel));
  if (loc.list === loc.force.selections) unlinkCopy(copy);
  loc.list.splice(loc.list.indexOf(loc.sel) + 1, 0, copy);
  return copy;
}

/** Makes a copy of a saved unit a normal unit: it keeps its build and loses the link and the name. */
export function unlinkCopy(sel: Sel): void {
  delete sel.saved;
  delete sel.name;
}

/** Whether a list holds a copy of saved unit `id`, in any detachment. */
export function holdsSaved(roster: Roster, id: string): boolean {
  return roster.forces.some((f) => f.selections.some((s) => s.saved === id));
}

/** The name to show for a selection: the player's name for it, else the data's. */
export function displayName(rs: RSel): string {
  return rs.sel.name ?? rs.eff.name;
}

/** The data's name, to show under the player's name for a selection, or undefined when it has none. */
export function dataNameIfNamed(rs: RSel): string | undefined {
  return rs.sel.name === undefined ? undefined : rs.eff.name;
}

/**
 * Add an option under parent (or as a root unit), then fill in mandatory defaults.
 * Returns the new selection's uid, or null, adding nothing, when the roster lacks the force or parent.
 */
export function addSel(
  roster: Roster,
  contexts: Map<string, Context>,
  forceUid: string,
  parentUid: string | null,
  opt: Opt,
  number = 1,
  categoryId?: string,
): string | null {
  const force = roster.forces.find((f) => f.uid === forceUid);
  const list = parentUid ? locate(roster, parentUid)?.sel.children : force?.selections;
  if (!force || !list) return null;
  const s: Sel = { uid: uid(), key: opt.key, number, children: [] };
  if (categoryId) s.categoryId = categoryId;
  list.push(s);
  fillDefaults(roster, contexts, s.uid, 0);
  // second pass: one model's picks can unlock another's (e.g. a sergeant's weapon mirrors the squad's choice)
  fillDefaults(roster, contexts, s.uid, 0, true);
  return s.uid;
}

export type AddSavedResult =
  | { added: true; uid: string; dropped: number }
  | { added: false; reason: 'no-detachment' | 'other-army-file' | 'already-in-list' | 'unit-gone' };

/**
 * Add a copy of a saved unit to a detachment, rebuilt against the current data: options the data
 * no longer has are left out and counted in `dropped`, and mandatory defaults filled.
 * A list holds a saved unit at most once.
 */
export function addSavedUnit(
  roster: Roster,
  contexts: Map<string, Context>,
  forceUid: string,
  unit: SavedUnit,
): AddSavedResult {
  const force = roster.forces.find((f) => f.uid === forceUid);
  if (!force) return { added: false, reason: 'no-detachment' };
  if (roster.repo !== unit.repo || force.catalogueId !== unit.catalogueId)
    return { added: false, reason: 'other-army-file' };
  if (holdsSaved(roster, unit.id)) return { added: false, reason: 'already-in-list' };
  const s = giveNewUids(structuredClone(unit.build));
  s.categoryId = unit.categoryId;
  s.name = unit.name;
  s.saved = unit.id;
  force.selections.push(s);
  const ev = new Evaluator(roster, contexts);
  if (ev.forces.some((rf) => rf.broken.includes(s))) {
    force.selections.pop();
    return { added: false, reason: 'unit-gone' };
  }
  const rs = ev.find(s.uid);
  const dropped = rs ? dropBroken(rs) : 0;
  fillDefaults(roster, contexts, s.uid, 0);
  fillDefaults(roster, contexts, s.uid, 0, true);
  return { added: true, uid: s.uid, dropped };
}

/** Removes the selections the data no longer has, under rs at any depth, and returns how many. */
function dropBroken(rs: RSel): number {
  rs.sel.children = rs.sel.children.filter((c) => !rs.broken.includes(c));
  let n = rs.broken.length;
  for (const c of rs.children) n += dropBroken(c);
  return n;
}

/** One step of `fillDefaults`: the selection it fills, read through a fresh evaluator. */
interface Filling {
  ev: Evaluator;
  rs: RSel;
}

const countUnder = (rs: RSel, pred: (key: string) => boolean) =>
  rs.sel.children.filter((c) => pred(c.key)).reduce((t, c) => t + c.number, 0);

function visibleOf({ ev, rs }: Filling, g: Opt): Opt[] {
  return g.members.filter((m) => {
    const e = ev.optionEff(m, rs, rs.force);
    return !e.hidden && !unavailable(e);
  });
}

/** cost after modifiers (a link can make a 'free' weapon cost points); a group costs its cheapest offer */
function optionCost(f: Filling, m: Opt): number {
  if (m.kind === 'entry') return f.ev.optionEff(m, f.rs, f.rs.force).costs.get(f.ev.pointsTypeId) ?? 0;
  const costs = visibleOf(f, m).map((x) => optionCost(f, x));
  return costs.length ? Math.min(...costs) : 0;
}

const baseMin = (m: Opt) => (m.node.constraints.some((c) => c.type === 'min' && c.value > 0) ? 0 : 1);

/** in a capped group, a nested group that holds a pick has had its default, so the next group's comes first */
function offeredIn({ ev, rs }: Filling, g: Opt, visible: Opt[]): Opt[] {
  if (ev.limits(g, rs, rs.force).max < 0) return visible;
  return visible.filter((m) => m.kind !== 'group' || countUnder(rs, (k) => k.startsWith(m.key + '/')) === 0);
}

/** one entry inside group g (searching nested groups) that can take another selection */
function pickIn(f: Filling, g: Opt, d = 0): Opt | undefined {
  if (d > 6) return undefined;
  const { ev, rs } = f;
  const visible = visibleOf(f, g);
  const cheapest = [...visible].sort((x, y) => baseMin(x) - baseMin(y) || optionCost(f, x) - optionCost(f, y));
  const def = defaultMember(g, offeredIn(f, g, visible), true, ev.optionEff(g, rs, rs.force).defaultId);
  const ordered = [...(def ? [def] : []), ...cheapest];
  // prefer nested groups that carry their own default
  ordered.sort((x, y) => Number(y === def) - Number(x === def));
  for (const m of ordered) {
    const lim = ev.limits(m, rs, rs.force);
    if (m.kind === 'entry') {
      const cur = countUnder(rs, (k) => k === m.key);
      if ((lim.max < 0 || cur < lim.max) && ev.roomBeyondParent(m, rs, rs.force)) return m;
    } else {
      const cur = countUnder(rs, (k) => k.startsWith(m.key + '/'));
      if (lim.max >= 0 && cur >= lim.max) continue;
      const hit = pickIn(f, m, d + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** revisit: also walk into children that were already there (second pass over a newly added unit) */
function fillDefaults(roster: Roster, contexts: Map<string, Context>, selUid: string, depth: number, revisit = false) {
  if (depth > 12) return;
  const added: string[] = [];
  // Fill one step at a time and re-evaluate: limits often change once a default is picked
  // (e.g. "min 2 unless the default is taken").
  for (let pass = 0; pass < 60; pass++) {
    const ev = new Evaluator(roster, contexts);
    const rs = ev.find(selUid);
    if (!rs) return;
    const ctx = rs.force.ctx;
    const addChild = (o: Opt, n: number) => {
      if (n <= 0) return false;
      const ex = rs.sel.children.find((c) => c.key === o.key && !c.children.length);
      if (ex) {
        ex.number += n;
        return true;
      }
      const child: Sel = { uid: uid(), key: o.key, number: n, children: [] };
      rs.sel.children.push(child);
      added.push(child.uid);
      return true;
    };
    let changed = false;
    const walk = (opts: Opt[]): boolean => {
      for (const o of opts) {
        const eff = ev.optionEff(o, rs, rs.force);
        if (eff.hidden) continue;
        const { min, max } = ev.limits(o, rs, rs.force, eff);
        // something the unit must take (e.g. a Praetor's Master of the Legion) is added even when a list-wide cap
        // is 0 right now ("one per 1,000 points"): the cap shows as an issue instead. Choices are still skipped.
        if (o.kind === 'entry' ? (min < 1 ? unavailable(eff) : unavailableHere(eff)) : unavailable(eff)) continue;
        if (o.kind === 'entry') {
          const have = countUnder(rs, (k) => k === o.key);
          if (addChild(o, Math.min(min, max < 0 ? min : max) - have)) changed = true;
          continue;
        }
        if (walk(o.members)) return true;
        const have = countUnder(rs, (k) => k.startsWith(o.key + '/'));
        if (min > have && (max < 0 || have < max)) {
          const m = pickIn({ ev, rs }, o);
          if (m && addChild(m, 1)) return true; // re-evaluate before picking more
        }
      }
      return false;
    };
    if (walk(ctx.options(rs.node))) changed = true;
    if (!changed) break;
  }
  const next = revisit ? (locate(roster, selUid)?.sel.children.map((c) => c.uid) ?? []) : added;
  for (const a of next) fillDefaults(roster, contexts, a, depth + 1, revisit);
}

export function defaultMember(group: Opt, visible: Opt[], strict = false, override?: string): Opt | undefined {
  const d = override || group.node.defaultSelectionEntryId;
  if (d) {
    const hit = visible.find((m) => m.node.id === d || m.node.linkId === d || m.key.endsWith('/' + d));
    if (hit) return hit;
  }
  // no default of its own: a nested group that has one
  const nested = visible.find((m) => m.kind === 'group' && m.node.defaultSelectionEntryId);
  if (nested) return nested;
  return strict ? undefined : visible[0];
}
