import { describe, expect, it, vi } from 'vitest';
import { buildSnapshot, decodeSnapshot, encodeSnapshot, viewUrl, type Snapshot } from './snapshot';
import { rosterText } from './exporter';
import type { RepoState } from '../data/db';
import type { RosterCtl } from '../store';
import { children, entry, unit, world } from '../test/fixture';

vi.mock('./Lists', () => ({ catalogueName: () => 'Orks', systemName: () => 'Test Game' }));
vi.mock('../store', () => ({ toast: vi.fn() }));

const repos: RepoState[] = [];
const ctlOf = (w: ReturnType<typeof world>) => ({ roster: w.roster, ev: w.ev() }) as unknown as RosterCtl;
const cat = (id: string) => `<categoryLinks><categoryLink id="l" targetId="${id}" primary="true"/></categoryLinks>`;
const gst = `<categoryEntries><categoryEntry id="hq" name="HQ:"/><categoryEntry id="tr" name="1. Troops"/></categoryEntries>
  <forceEntries><forceEntry id="det" name="Detachment:"><categoryLinks><categoryLink id="a" targetId="hq"/><categoryLink id="b" targetId="tr"/></categoryLinks></forceEntry></forceEntries>`;

const profile = '<profiles><profile id="p" name="Stat" typeId="t" typeName="Unit"><characteristics><characteristic name="M" typeId="m">6</characteristic></characteristics></profile></profiles>';
const rule = '<rules><rule id="r" name="Fearless"><description>Never runs</description></rule></rules>';
const army = world(
  unit('t', 'Boyz', 10, cat('tr') + children(entry('g', 'Choppa', 2))) +
  unit('b', 'Boss', 50, cat('hq') + profile + rule) +
  entry('s', 'Allegiance:', 0, `${cat('tr')}${children(entry('x', 'Loyalist'))}`, 'type="upgrade"') +
  entry('p', 'Expanded', 0, `${cat('tr')}${children(entry('on', 'Legacy On'))}`, 'type="upgrade"') +
  entry('e', 'Warlord Trait', 0, cat('tr'), 'type="upgrade"'),
  { gst, costLimit: 100 },
);
const boyz = army.add('Boyz', 2);
army.pick(boyz, 'Choppa', 3);
army.add('Boss');
army.pick(army.add('Allegiance:'), 'Loyalist');
army.pick(army.add('Expanded'), 'Legacy On');
army.add('Warlord Trait');

describe('buildSnapshot', () => {
  const s = buildSnapshot(ctlOf(army), repos);

  it('carries the headline figures', () => {
    expect(s).toMatchObject({ v: 1, name: 'Test list', game: 'Test Game', pts: 82, limit: 100, issues: 0 });
    expect(s.forces[0]).toMatchObject({ name: 'Detachment', army: 'Orks', pts: 82 });
  });
  it('lists units in force-org order with cleaned up category names', () => {
    expect(s.forces[0].units.map((u) => [u.name, u.cat, u.pts])).toEqual([['Boss', 'HQ', 50], ['2× Boyz', 'Troops', 32]]);
  });
  it('totals wargear across the unit', () => {
    expect(s.forces[0].units[1].gear).toEqual([{ d: 0, t: '6× Choppa (12)' }]);
  });
  it('carries profiles and rules', () => {
    const boss = s.forces[0].units[0];
    expect(boss.profiles).toEqual([{ name: 'Stat', type: 'Unit', chars: [['M', '6']] }]);
    expect(boss.rules).toEqual(['Fearless']);
    expect(s.rules).toEqual([['Fearless', 'Never runs']]);
  });
  it('sums up set-up entries, leaving out switch panels', () => {
    expect(s.forces[0].setup).toEqual(['Allegiance: Loyalist', 'Warlord Trait']);
  });
  it('counts errors', () => {
    const w = world(unit('u', 'Boss', 150), { costLimit: 100 });
    w.add('Boss');
    expect(buildSnapshot(ctlOf(w), repos).issues).toBe(1);
  });
});

describe('rosterText', () => {
  it('is a readable list in force-org order', () => {
    expect(rosterText(ctlOf(army), repos).split('\n')).toEqual([
      'Test list — 82/100 pts', '',
      '== Detachment: · Orks (82 pts) ==', '',
      '-- HQ --', 'Boss [50]', '',
      '-- 1. Troops --', '2× Boyz [32]', '  • 6× Choppa (12)',
      'Allegiance: [0]', '  • Loyalist', 'Expanded [0]', '  • Legacy On', 'Warlord Trait [0]', '',
      'Built with Muster',
    ]);
  });
  it('puts units from no listed category under Other, and flags problems', () => {
    const w = world(unit('u', 'Boss', 150), { costLimit: 100 });
    w.add('Boss');
    expect(rosterText(ctlOf(w), repos).split('\n')).toEqual([
      'Test list — 150/100 pts', '', '== Detachment · Orks (150 pts) ==', '', '-- Other --', 'Boss [150]', '', '(1 unresolved issue)', '', 'Built with Muster',
    ]);
  });
  it('leaves out a limit of zero', () => {
    const w = world(unit('u', 'Boss', 1.5));
    w.add('Boss');
    expect(rosterText(ctlOf(w), repos).split('\n')[0]).toBe('Test list — 1.5 pts');
  });
});

describe('share links', () => {
  const snap = (rules?: [string, string][]): Snapshot => ({ v: 1, name: 'List — ✓', game: 'G', pts: 1, limit: 0, forces: [], rules, issues: 0, at: 1 });

  it('survive a round trip, including non-Latin text', async () => {
    const s = snap([['Rule', 'Text ⚔']]);
    const { data, withRules } = await encodeSnapshot(s);
    expect(withRules).toBe(true);
    expect(data).toMatch(/^[\w-]+$/);
    expect(await decodeSnapshot(data)).toEqual(s);
  });
  it('report no rules when there were none', async () => {
    expect((await encodeSnapshot(snap())).withRules).toBe(false);
    expect((await encodeSnapshot(snap([]))).withRules).toBe(false);
  });
  it('drop the rules text from a link that would be too long', async () => {
    const noise = Array.from({ length: 6000 }, (_, i) => [`Rule ${i}`, Math.random().toString(36).repeat(3)] as [string, string]);
    const { data, withRules } = await encodeSnapshot(snap(noise));
    expect(withRules).toBe(false);
    expect((await decodeSnapshot(data)).rules).toBeUndefined();
  });
  it('reject a link that is not a list', async () => {
    const wrong = (await encodeSnapshot({ v: 2, forces: [] } as unknown as Snapshot)).data;
    await expect(decodeSnapshot(wrong)).rejects.toThrow('Not a Muster list');
    const noForces = (await encodeSnapshot({ v: 1 } as unknown as Snapshot)).data;
    await expect(decodeSnapshot(noForces)).rejects.toThrow('Not a Muster list');
  });
  it('reject garbage', async () => {
    await expect(decodeSnapshot('not-really-a-link')).rejects.toThrow();
  });
  it('point at this app', () => {
    vi.stubGlobal('location', { origin: 'https://x.test', pathname: '/muster/' });
    expect(viewUrl('abc')).toBe('https://x.test/muster/#/view/abc');
    vi.unstubAllGlobals();
  });
});
