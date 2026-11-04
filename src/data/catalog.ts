// Builds a resolved view over a game system + one catalogue (and everything it links to).
import type { CostType, DataFile, EntryNode, Profile, Rule } from './model';

export interface RNode extends EntryNode {
  /** id of the entryLink this came through, if any */
  linkId?: string;
}

export interface Opt {
  /** unique key within its parent entry */
  key: string;
  kind: 'entry' | 'group';
  node: RNode;
  /** group: member options */
  members: Opt[];
  /** ids of the enclosing groups (both resolved ids and link ids) */
  groupIds: string[];
}

export class Context {
  readonly gst: DataFile;
  readonly cat: DataFile;
  readonly files: DataFile[];
  private index = new Map<string, EntryNode>();
  private profileIdx = new Map<string, Profile>();
  private ruleIdx = new Map<string, Rule>();
  private resolved = new WeakMap<EntryNode, RNode>();
  private optCache = new WeakMap<EntryNode, Opt[]>();
  readonly costTypes: CostType[];
  readonly profileColumns = new Map<string, { name: string; columns: string[] }>();

  constructor(gst: DataFile, cat: DataFile, linked: DataFile[]) {
    this.gst = gst;
    this.cat = cat;
    // order matters: catalogue first so its ids win over library duplicates
    this.files = [cat, ...linked.filter((f) => f !== cat && f !== gst), gst];
    for (const f of [...this.files].reverse()) this.indexFile(f);
    this.costTypes = gst.costTypes;
  }

  private indexFile(f: DataFile) {
    const walk = (n: EntryNode) => {
      if (n.id) this.index.set(n.id, n);
      for (const p of n.profiles) this.profileIdx.set(p.id, p);
      for (const r of n.rules) this.ruleIdx.set(r.id, r);
      n.children.forEach(walk);
      n.forces?.forEach(walk);
    };
    f.sharedEntries.forEach(walk);
    f.rootEntries.forEach(walk);
    f.categoryEntries.forEach(walk);
    f.forceEntries.forEach(walk);
    f.sharedInfoGroups.forEach(walk);
    for (const p of f.sharedProfiles) this.profileIdx.set(p.id, p);
    for (const r of f.sharedRules) this.ruleIdx.set(r.id, r);
    for (const pt of f.profileTypes) this.profileColumns.set(pt.id, { name: pt.name, columns: pt.columns.map((c) => c.name) });
  }

  get(id: string) {
    return this.index.get(id);
  }
  profile(id: string) {
    return this.profileIdx.get(id);
  }
  rule(id: string) {
    return this.ruleIdx.get(id);
  }

  categoryName(id: string) {
    return this.index.get(id)?.name ?? '';
  }

  /** Resolve an entryLink into a merged node; plain entries are returned as-is. */
  resolve(n: EntryNode): RNode | null {
    if (n.tag !== 'entryLink') return n;
    const hit = this.resolved.get(n);
    if (hit) return hit;
    let target = n.targetId ? this.index.get(n.targetId) : undefined;
    if (!target) return null;
    if (target.tag === 'entryLink') target = this.resolve(target) ?? undefined;
    if (!target) return null;
    const costs = target.costs.map((c) => ({ ...c }));
    for (const c of n.costs) {
      const ex = costs.find((x) => x.typeId === c.typeId);
      if (ex) ex.value = c.value || ex.value;
      else costs.push({ ...c });
    }
    const merged: RNode = {
      ...target,
      tag: target.tag,
      id: target.id,
      linkId: n.id,
      // links often carry an editor placeholder name; the target's name is the real one
      name: n.name && !/^new entry ?link$/i.test(n.name) ? n.name : target.name,
      hidden: n.hidden || target.hidden,
      collective: n.collective || target.collective,
      constraints: [...target.constraints, ...n.constraints],
      costs,
      modifiers: [...target.modifiers, ...n.modifiers],
      categoryLinks: [...target.categoryLinks, ...n.categoryLinks],
      profiles: [...target.profiles, ...n.profiles],
      rules: [...target.rules, ...n.rules],
      infoLinks: [...target.infoLinks, ...n.infoLinks],
      children: [...target.children, ...n.children],
      defaultSelectionEntryId: n.defaultSelectionEntryId || target.defaultSelectionEntryId,
      sortIndex: n.sortIndex ?? target.sortIndex,
    };
    this.resolved.set(n, merged);
    return merged;
  }

  /** Selectable options beneath an entry (entries + groups). */
  options(n: EntryNode): Opt[] {
    const hit = this.optCache.get(n);
    if (hit) return hit;
    const out = this.buildOptions(n.children, [], '');
    this.optCache.set(n, out);
    return out;
  }

  private buildOptions(children: EntryNode[], groupIds: string[], prefix: string): Opt[] {
    const out: Opt[] = [];
    for (const c of children) {
      const r = this.resolve(c);
      if (!r) continue;
      const key = prefix + (r.linkId ?? r.id);
      if (r.tag === 'selectionEntryGroup') {
        const gids = [...groupIds, r.id, ...(r.linkId ? [r.linkId] : [])];
        out.push({ key, kind: 'group', node: r, groupIds, members: this.buildOptions(r.children, gids, key + '/') });
      } else if (r.tag === 'selectionEntry') {
        out.push({ key, kind: 'entry', node: r, groupIds, members: [] });
      }
    }
    // honour the data's sortIndex; anything without one keeps file order, after the indexed ones
    if (out.some((o) => o.node.sortIndex != null)) {
      const pos = new Map(out.map((o, i) => [o, i]));
      out.sort((x, y) => (x.node.sortIndex ?? Infinity) - (y.node.sortIndex ?? Infinity) || pos.get(x)! - pos.get(y)!);
    }
    return out;
  }

  /** Find an option by key beneath a node (searches inside groups). */
  findOption(parent: EntryNode | null, key: string, roots?: Opt[]): Opt | undefined {
    const list = parent ? this.options(parent) : roots ?? [];
    const stack = [...list];
    while (stack.length) {
      const o = stack.pop()!;
      if (o.key === key) return o;
      if (o.kind === 'group') stack.push(...o.members);
    }
    return undefined;
  }

  /** All options that can be added at the root of a force. */
  rootOptions(): Opt[] {
    const seen = new Set<DataFile>();
    const out: Opt[] = [];
    const add = (f: DataFile, includeRoots: boolean) => {
      if (seen.has(f)) return;
      seen.add(f);
      if (includeRoots) {
        const own = f === this.cat || f === this.gst;
        out.push(...this.buildOptions(own ? f.rootEntries : f.rootEntries.filter((e) => e.importable), [], ''));
      }
      for (const l of f.catalogueLinks) {
        const t = this.files.find((x) => x.id === l.targetId);
        if (t) add(t, l.importRootEntries);
      }
    };
    add(this.cat, true);
    add(this.gst, true);
    // flatten any root groups (rare)
    const flat: Opt[] = [];
    const walk = (o: Opt) => (o.kind === 'group' ? o.members.forEach(walk) : flat.push(o));
    out.forEach(walk);
    // de-duplicate by key
    const byKey = new Map<string, Opt>();
    for (const o of flat) if (!byKey.has(o.key)) byKey.set(o.key, o);
    return [...byKey.values()];
  }

  forceEntries(): EntryNode[] {
    const out: EntryNode[] = [];
    const walk = (f: EntryNode) => {
      out.push(f);
      f.forces?.forEach(walk);
    };
    for (const f of [...this.gst.forceEntries, ...this.cat.forceEntries]) walk(f);
    return out;
  }

  private startCache = new Map<string, number>();

  /**
   * Points for an entry as it comes by default: its own cost plus the minimum number of each mandatory
   * model / upgrade inside it (a group's default, or its cheapest option). Quick estimate from the data,
   * without conditions, for showing a price before the unit is added.
   */
  startCost(n: EntryNode, ptsId: string, depth = 0): number {
    const key = ptsId + '|' + n.id + '|' + ((n as RNode).linkId ?? '');
    const hit = this.startCache.get(key);
    if (hit != null) return hit;
    const own = n.costs.find((c) => c.typeId === ptsId)?.value ?? 0;
    let total = own;
    if (depth < 8) {
      const minOf = (o: Opt) => o.node.constraints
        .filter((c) => c.type === 'min' && c.field === 'selections' && c.scope === 'parent' && !c.percentValue)
        .reduce((m, c) => Math.max(m, c.value), 0);
      const visible = (o: Opt) => !o.node.hidden;
      const cost = (o: Opt): number => {
        if (o.kind === 'entry') return this.startCost(o.node, ptsId, depth + 1);
        const ms = o.members.filter(visible);
        const d = o.node.defaultSelectionEntryId;
        const def = d ? ms.find((m) => m.node.id === d || m.node.linkId === d) : undefined;
        if (def) return cost(def);
        const costs = ms.map(cost);
        return costs.length ? Math.min(...costs) : 0;
      };
      const walk = (opts: Opt[]) => {
        for (const o of opts) {
          if (!visible(o)) continue;
          const min = minOf(o);
          if (o.kind === 'entry') { if (min > 0) total += min * cost(o); continue; }
          // group: mandatory picks inside it, plus the group's own minimum
          const inner = o.members.filter((m) => visible(m) && minOf(m) > 0);
          walk(inner);
          const innerCount = inner.reduce((t, m) => t + minOf(m), 0);
          if (min > innerCount) total += (min - innerCount) * cost(o);
        }
      };
      walk(this.options(n));
    }
    this.startCache.set(key, total);
    return total;
  }

  pointsType(): CostType | undefined {
    return this.costTypes.find((c) => /^(pts|points)$/i.test(c.name)) ?? this.costTypes[0];
  }
}
