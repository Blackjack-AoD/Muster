// A self-contained picture of a list (units, stats, wargear, rules) that needs no game data to show.
// Used for the printable army sheet (PDF) and for share links that friends can open without Muster's data.
import type { RepoState } from '../data/db';
import { isRecord, type RSel } from '../data/engine';
import type { RosterCtl } from '../store';
import { catalogueName, systemName } from './Lists';

export interface SnapProfile {
  name: string;
  type: string;
  chars: [string, string][];
}
export interface SnapUnit {
  name: string;
  cat: string;
  pts: number;
  /** wargear and upgrades as indented lines, totals across the unit ("5× Bolter") */
  gear: { d: number; t: string }[];
  profiles: SnapProfile[];
  rules: string[];
}
export interface SnapForce {
  name: string;
  army: string;
  pts: number;
  units: SnapUnit[];
  /** set-up choices shown as one line, e.g. "Allegiance: Traitor" */
  setup?: string[];
}
export interface Snapshot {
  v: 1;
  name: string;
  game: string;
  pts: number;
  limit: number;
  forces: SnapForce[];
  /** rule text, once per rule name (left out of links when they'd get too long) */
  rules?: [string, string][];
  issues: number;
  at: number;
}

const clean = (s: string) => s.replace(/[:\s]+$/, '').replace(/^\d+\.\s*/, '');

export function buildSnapshot(ctl: RosterCtl, repos: RepoState[]): Snapshot {
  const { roster, ev } = ctl;
  const ruleText = new Map<string, string>();
  const unit = (u: RSel): SnapUnit => {
    const gear: { d: number; t: string }[] = [];
    const walk = (r: RSel, d: number, mult: number) => {
      for (const c of r.children) {
        const k = c.sel.number * mult;
        gear.push({ d, t: `${k > 1 ? k + '× ' : ''}${c.eff.name}${c.total ? ` (${fmt(c.total * mult)})` : ''}` });
        walk(c, d + 1, k);
      }
    };
    walk(u, 0, u.sel.number);
    const rules = ev.rulesFor(u);
    for (const r of rules) if (!ruleText.has(r.name)) ruleText.set(r.name, r.description);
    return {
      name: `${u.sel.number > 1 ? u.sel.number + '× ' : ''}${u.eff.name}`,
      cat: u.eff.primary ? clean(u.force.ctx.categoryName(u.eff.primary)) : '',
      pts: u.total,
      gear,
      profiles: ev.profilesFor(u).map((p) => ({
        name: p.name,
        type: p.typeName,
        chars: p.characteristics.map((c) => [c.name, c.value] as [string, string]),
      })),
      rules: rules.map((r) => r.name),
    };
  };
  const forces: SnapForce[] = ev.forces.map((rf) => {
    // units in force-org order (HQ, Troops...), set-up entries first as they appear
    const order = rf.entry.categoryLinks.map((c) => c.targetId);
    const rank = (u: RSel) => {
      const i = order.indexOf(u.eff.primary ?? '');
      return i < 0 ? 999 : i;
    };
    // set-up entries (Legion, Allegiance, Rite of War...) aren't units: summarise their choices instead
    const isUnit = (u: RSel) => u.node.type === 'unit' || u.node.type === 'model' || u.total > 0;
    const setup = rf.roots
      .filter((u) => !isUnit(u))
      .map((u) => {
        const picks = u.children.map((c) => c.eff.name).filter((n) => !/\b(on|off)$/i.test(n));
        const label = clean(u.eff.name);
        if (picks.length) return `${label}: ${picks.join(', ')}`;
        // entries with nothing chosen inside: just the name, unless it's a switch panel (Expanded Army Lists)
        return u.children.length ? '' : label;
      })
      .filter(Boolean);
    return {
      name: clean(rf.entry.name),
      army: catalogueName(repos, roster.repo, rf.force.catalogueId).replace(/^\d{4}\s*-\s*/, ''),
      pts: rf.total,
      units: rf.roots
        .filter(isUnit)
        .sort((a, b) => rank(a) - rank(b))
        .map(unit),
      setup,
    };
  });
  return {
    v: 1,
    name: roster.name,
    game: systemName(repos, roster.repo, roster.gameSystemId),
    pts: ev.total,
    limit: roster.costLimit,
    forces,
    rules: [...ruleText].filter(([, d]) => d).sort((a, b) => a[0].localeCompare(b[0])),
    issues: ev.issues.filter((i) => i.level === 'error').length,
    at: Date.now(),
  };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---------- links: snapshot → compressed, URL-safe text ----------
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());
}

/** Links longer than this get the rules text left out (names stay on each unit). */
const MAX_LINK_DATA = 24_000;

export async function encodeSnapshot(s: Snapshot): Promise<{ data: string; withRules: boolean }> {
  const pack = async (x: Snapshot) =>
    b64url(await pipe(new TextEncoder().encode(JSON.stringify(x)), new CompressionStream('deflate-raw')));
  const full = await pack(s);
  if (full.length <= MAX_LINK_DATA || !s.rules?.length) return { data: full, withRules: !!s.rules?.length };
  return { data: await pack({ ...s, rules: undefined }), withRules: false };
}

const isText = (v: unknown) => typeof v === 'string';
const isTextPair = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isText);
const isListOf = (v: unknown, each: (x: unknown) => boolean) => Array.isArray(v) && v.every(each);

const isGearLine = (g: unknown) => isRecord(g) && typeof g.d === 'number';
const isSnapProfile = (p: unknown) => isRecord(p) && typeof p.type === 'string' && isListOf(p.chars, isTextPair);
const isSnapUnit = (u: unknown) =>
  isRecord(u) &&
  typeof u.pts === 'number' &&
  isListOf(u.gear, isGearLine) &&
  isListOf(u.profiles, isSnapProfile) &&
  isListOf(u.rules, isText);
const isSnapForce = (f: unknown) =>
  isRecord(f) &&
  typeof f.pts === 'number' &&
  isListOf(f.units, isSnapUnit) &&
  (f.setup === undefined || isListOf(f.setup, isText));

/** The fields the sheet uses as numbers or joins as text. Only `rules` and `setup` may be absent from a link. */
function isSnapshot(s: unknown): s is Snapshot {
  return (
    isRecord(s) &&
    s.v === 1 &&
    typeof s.pts === 'number' &&
    typeof s.limit === 'number' &&
    typeof s.issues === 'number' &&
    typeof s.at === 'number' &&
    isListOf(s.forces, isSnapForce) &&
    (s.rules === undefined || isListOf(s.rules, isTextPair))
  );
}

export async function decodeSnapshot(data: string): Promise<Snapshot> {
  const json = new TextDecoder().decode(await pipe(unb64url(data), new DecompressionStream('deflate-raw')));
  const s: unknown = JSON.parse(json);
  if (!isSnapshot(s)) throw new Error('Not a Muster list');
  return s;
}

/** Address of the web view for a snapshot: this app's own URL plus the packed list. */
export function viewUrl(data: string) {
  return `${location.origin}${location.pathname}#/view/${data}`;
}
