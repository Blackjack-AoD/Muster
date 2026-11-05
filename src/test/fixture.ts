// Small worlds for tests: real BattleScribe XML through the real parser, so a test reads like the data it stands for.
import { DOMParser } from '@xmldom/xmldom';
import { Context, type Opt } from '../data/catalog';
import { Evaluator, addSel, forceRootOptions, type Roster } from '../data/engine';
import type { DataFile } from '../data/model';
import { parseDataFile } from '../data/parse';

export const parseXml = (xml: string) =>
  parseDataFile(new DOMParser().parseFromString(xml, 'text/xml').documentElement as unknown as Element);

export const COST_TYPES =
  '<costTypes><costType id="pts" name="pts" defaultCostLimit="2000"/><costType id="pl" name="PL" defaultCostLimit="-1"/></costTypes>';

export const gameSystem = (inner = '') =>
  parseXml(`<gameSystem id="gst" name="Test Game" revision="1">${COST_TYPES}${inner}</gameSystem>`);
export const catalogue = (inner = '', id = 'cat', attrs = '') =>
  parseXml(`<catalogue id="${id}" name="Test Army" revision="1" gameSystemId="gst" ${attrs}>${inner}</catalogue>`);

export const FORCE = '<forceEntries><forceEntry id="det" name="Detachment"/></forceEntries>';

/** A selection entry; `inner` holds its modifiers, constraints, child entries and so on. */
export const entry = (id: string, name: string, pts = 0, inner = '', attrs = 'type="upgrade"') =>
  `<selectionEntry id="${id}" name="${name}" ${attrs}><costs><cost name="pts" typeId="pts" value="${pts}"/></costs>${inner}</selectionEntry>`;
export const unit = (id: string, name: string, pts = 0, inner = '') => entry(id, name, pts, inner, 'type="unit"');
export const children = (...entries: string[]) => `<selectionEntries>${entries.join('')}</selectionEntries>`;

export interface WorldOptions {
  /** extra XML inside the game system; defaults to a force entry with no category limits */
  gst?: string;
  /** extra XML inside the catalogue, e.g. shared entries or rules */
  cat?: string;
  linked?: DataFile[];
  costLimit?: number;
}

/** A catalogue with `units` at its root and an empty one-force roster to build in. */
export function world(units: string, o: WorldOptions = {}) {
  const gst = gameSystem(o.gst ?? FORCE);
  const cat = catalogue(`<selectionEntries>${units}</selectionEntries>${o.cat ?? ''}`);
  const ctx = new Context(gst, cat, o.linked ?? []);
  const contexts = new Map([[cat.id, ctx]]);
  const fe = ctx.forceEntries()[0];
  const roster: Roster = {
    uid: 'r',
    name: 'Test list',
    repo: 'test/repo',
    gameSystemId: gst.id,
    costLimit: o.costLimit ?? 0,
    forces: [{ uid: 'f1', forceEntryId: fe.id, catalogueId: cat.id, selections: [] }],
    created: 0,
    updated: 0,
  };
  const root = (name: string, forceEntry = fe) => {
    const opt = forceRootOptions(ctx, forceEntry).find((o) => o.node.name === name);
    if (!opt) throw new Error(`no root entry called ${name}`);
    return opt;
  };
  const beneath = (parentUid: string, name: string) => {
    const rs = ev().find(parentUid)!;
    const walk = (opts: Opt[]): Opt | undefined => {
      for (const o of opts) {
        if (o.node.name === name) return o;
        const hit = walk(o.members);
        if (hit) return hit;
      }
      return undefined;
    };
    const opt = walk(ctx.options(rs.node));
    if (!opt) throw new Error(`no option called ${name}`);
    return opt;
  };
  const ev = () => new Evaluator(roster, contexts);
  return {
    gst,
    cat,
    ctx,
    contexts,
    roster,
    ev,
    root,
    beneath,
    /** add a root unit, filling its mandatory defaults */
    add: (name: string, number = 1, forceUid = 'f1') => {
      const opt = root(name);
      return addSel(
        roster,
        contexts,
        forceUid,
        null,
        opt,
        number,
        opt.node.categoryLinks.find((c) => c.primary)?.targetId,
      );
    },
    /** add an option beneath a selection */
    pick: (parentUid: string, name: string, number = 1) =>
      addSel(roster, contexts, 'f1', parentUid, beneath(parentUid, name), number),
    /** a second detachment of the same catalogue */
    addForce: (uid = 'f2') => {
      roster.forces.push({ uid, forceEntryId: fe.id, catalogueId: cat.id, selections: [] });
      return uid;
    },
    pts: (selUid: string) => ev().find(selUid)!.total,
    errors: () =>
      ev()
        .issues.filter((i) => i.level === 'error')
        .map((i) => i.message),
    warnings: () =>
      ev()
        .issues.filter((i) => i.level === 'warn')
        .map((i) => i.message),
  };
}
