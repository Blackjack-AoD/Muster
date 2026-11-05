import { afterEach, describe, expect, it, vi } from 'vitest';
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

const profile =
  '<profiles><profile id="p" name="Stat" typeId="t" typeName="Unit"><characteristics><characteristic name="M" typeId="m">6</characteristic></characteristics></profile></profiles>';
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
    expect(s.forces[0].units.map((u) => [u.name, u.cat, u.pts])).toEqual([
      ['Boss', 'HQ', 50],
      ['2× Boyz', 'Troops', 32],
    ]);
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
      'Test list — 82/100 pts',
      '',
      '== Detachment: · Orks (82 pts) ==',
      '',
      '-- HQ --',
      'Boss [50]',
      '',
      '-- 1. Troops --',
      '2× Boyz [32]',
      '  • 6× Choppa (12)',
      'Allegiance: [0]',
      '  • Loyalist',
      'Expanded [0]',
      '  • Legacy On',
      'Warlord Trait [0]',
      '',
      'Built with Muster',
    ]);
  });
  it('puts units from no listed category under Other, and flags problems', () => {
    const w = world(unit('u', 'Boss', 150), { costLimit: 100 });
    w.add('Boss');
    expect(rosterText(ctlOf(w), repos).split('\n')).toEqual([
      'Test list — 150/100 pts',
      '',
      '== Detachment · Orks (150 pts) ==',
      '',
      '-- Other --',
      'Boss [150]',
      '',
      '(1 unresolved issue)',
      '',
      'Built with Muster',
    ]);
  });
  it('leaves out a limit of zero', () => {
    const w = world(unit('u', 'Boss', 1.5));
    w.add('Boss');
    expect(rosterText(ctlOf(w), repos).split('\n')[0]).toBe('Test list — 1.5 pts');
  });
});

describe('share links', () => {
  const snap = (rules?: [string, string][]): Snapshot => ({
    v: 1,
    name: 'List — ✓',
    game: 'G',
    pts: 1,
    limit: 0,
    forces: [],
    rules,
    issues: 0,
    at: 1,
  });

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
    const noise = Array.from(
      { length: 6000 },
      (_, i) => [`Rule ${i}`, Math.random().toString(36).repeat(3)] as [string, string],
    );
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
  describe('from any v1 list', () => {
    const FULL = {
      v: 1,
      name: 'Friendly Fire',
      game: 'Test Game',
      pts: 25,
      limit: 2000,
      forces: [
        {
          name: 'Detachment',
          army: 'Test Army',
          pts: 25,
          setup: ['Allegiance: Loyalist'],
          units: [
            {
              name: 'Servitor',
              cat: 'Elites',
              pts: 25,
              gear: [{ d: 0, t: 'Servo Arm' }],
              profiles: [{ name: 'Servitor', type: 'Unit', chars: [['M', '6']] }],
              rules: ['Mindlock'],
            },
          ],
        },
      ],
      rules: [['Mindlock', 'Moves slowly.']],
      issues: 0,
      at: 0,
    };
    const force = FULL.forces[0];
    const servitor = force.units[0];
    const withForce = (change: object) => ({ ...FULL, forces: [{ ...force, ...change }] });
    const withUnit = (change: object) => withForce({ units: [{ ...servitor, ...change }] });
    const pack = async (value: unknown) => (await encodeSnapshot(value as Snapshot)).data;

    it('opens a list with everything in it', async () => {
      expect(await decodeSnapshot(await pack(FULL))).toEqual(FULL);
    });

    it('opens a list with no rule text and no set-up line, as older links have', async () => {
      const { rules: _rules, ...noRules } = withForce({ setup: undefined });
      expect(await decodeSnapshot(await pack(noRules))).toEqual(noRules);
    });

    it.each([
      ['no points', { ...FULL, pts: undefined }],
      ['points as text', { ...FULL, pts: '25' }],
      ['a limit as text', { ...FULL, limit: '2000' }],
      ['rule text that is not a list', { ...FULL, rules: 'Mindlock' }],
      ['a rule that is not a name and a text', { ...FULL, rules: ['Mindlock'] }],
      ['a detachment with nothing in it', { ...FULL, forces: [{}] }],
      ['a detachment that is null', { ...FULL, forces: [null] }],
      ['a detachment with no points', withForce({ pts: undefined })],
      ['a set-up line as text', withForce({ setup: 'Allegiance' })],
      ['units that are not a list', withForce({ units: 'Servitor' })],
      ['a unit that is null', withForce({ units: [null] })],
      ['a unit with points as text', withUnit({ pts: '25' })],
      ['a unit with no gear', withUnit({ gear: undefined })],
      ['a gear line that is null', withUnit({ gear: [null] })],
      ['a unit with no profiles', withUnit({ profiles: undefined })],
      ['a profile that is null', withUnit({ profiles: [null] })],
      ['a profile with no stats', withUnit({ profiles: [{ name: 'Servitor', type: 'Unit' }] })],
      ['a stat that is not a name and a value', withUnit({ profiles: [{ type: 'Gear', chars: [['M']] }] })],
      ['a stat value that is a number', withUnit({ profiles: [{ type: 'Gear', chars: [['M', 6]] }] })],
      ['a rule text that is a number', { ...FULL, rules: [['Mindlock', 1]] }],
      ['a gear line that is text', withUnit({ gear: ['Servo Arm'] })],
      ['a unit with no rules', withUnit({ rules: undefined })],
      ['a unit rule that is an object', withUnit({ rules: [{}] })],
      ['no count of issues', { ...FULL, issues: undefined }],
      ['a count of issues that is an object', { ...FULL, issues: {} }],
      ['no date', { ...FULL, at: undefined }],
      ['a date that is an object', { ...FULL, at: {} }],
      ['a set-up line that is an object', withForce({ setup: [{}] })],
      ['a gear line with no depth', withUnit({ gear: [{ t: 'Servo Arm' }] })],
      ['a gear depth that is an object', withUnit({ gear: [{ d: {}, t: 'Servo Arm' }] })],
      ['a profile with no type', withUnit({ profiles: [{ name: 'Servitor', chars: [] }] })],
      ['a profile type that is an object', withUnit({ profiles: [{ type: {}, chars: [] }] })],
    ])('reject a list with %s', async (_what, broken) => {
      await expect(decodeSnapshot(await pack(broken))).rejects.toThrow('Not a Muster list');
    });

    describe('that a link unpacks to', () => {
      const MB5 = 5_000_000;
      const ofSize = (bytes: number) => {
        const padding = bytes - JSON.stringify({ ...FULL, name: '' }).length;
        return { ...FULL, name: 'x'.repeat(padding) };
      };
      afterEach(() => {
        vi.unstubAllGlobals();
      });
      it('opens at exactly 5 MB', async () => {
        const link = await pack(ofSize(MB5));
        expect((await decodeSnapshot(link)).name).toHaveLength(ofSize(MB5).name.length);
      });
      it('stops one byte past 5 MB', async () => {
        await expect(decodeSnapshot(await pack(ofSize(MB5 + 1)))).rejects.toThrow('too big');
      });
      it('stops reading soon after 5 MB, however much more the link holds', async () => {
        const Real = DecompressionStream;
        let unpacked = 0;
        const counted = () =>
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, out) {
              unpacked += chunk.length;
              out.enqueue(chunk);
            },
          });
        vi.stubGlobal(
          'DecompressionStream',
          class {
            private real = new Real('deflate-raw');
            writable = this.real.writable;
            readable = this.real.readable.pipeThrough(counted());
          },
        );
        const link = await pack(ofSize(10 * MB5));
        await expect(decodeSnapshot(link)).rejects.toThrow('too big');
        expect(unpacked).toBeGreaterThan(MB5);
        expect(unpacked).toBeLessThan(1.1 * MB5);
      });
    });

    describe('with many units', () => {
      const units = (n: number) => Array.from({ length: n }, () => servitor);
      it('opens at 2,000 units', async () => {
        const link = await pack(withForce({ units: units(2000) }));
        expect((await decodeSnapshot(link)).forces[0].units).toHaveLength(2000);
      });
      it('rejects 2,001 units, counted across every detachment', async () => {
        const split = {
          ...FULL,
          forces: [
            { ...force, units: units(1001) },
            { ...force, units: units(1000) },
          ],
        };
        await expect(decodeSnapshot(await pack(split))).rejects.toThrow('Not a Muster list');
      });
    });
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
