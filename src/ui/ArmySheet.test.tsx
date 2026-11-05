// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { getState } from '../store';
import { children, entry, unit, world } from '../test/fixture';
import { expectToast, linkHash, openHash, press, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';
import type { SnapProfile, Snapshot } from './snapshot';

const UNITS =
  unit('tac', 'Tactical Squad', 100, children(entry('melta', 'Melta Gun', 15))) + unit('assault', 'Assault Squad', 80);

const SHARED: Snapshot = {
  v: 1,
  name: 'Friendly Fire',
  game: 'Test Game',
  pts: 1275,
  limit: 2000,
  forces: [
    {
      name: 'Detachment',
      army: 'Test Army',
      pts: 1275,
      units: [
        { name: 'Land Raider', cat: 'Heavy', pts: 1250, gear: [], profiles: [], rules: [] },
        { name: 'Servitor', cat: 'Elites', pts: 25, gear: [], profiles: [], rules: [] },
      ],
    },
  ],
  issues: 0,
  at: 0,
};

/** Packs a value no Snapshot type allows, as a damaged or hand-made link would hold. */
const linkHashOf = (value: unknown) => linkHash(value as Snapshot);
const tooManyUnits: Snapshot = {
  ...SHARED,
  forces: [{ ...SHARED.forces[0], units: Array.from({ length: 2001 }, () => SHARED.forces[0].units[0]) }],
};
/** Each unit on the sheet as its name and the points it shows. */
const sheetUnits = () =>
  [...document.querySelectorAll('.as-unit')].map((card) => [
    card.querySelector('b')?.textContent,
    card.querySelector('.as-unit-pts')?.textContent,
  ]);

beforeEach(stubBrowserGaps);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SheetPage', () => {
  it('shows each unit on the army sheet with its points', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    w.pick(w.add('Tactical Squad'), 'Melta Gun');
    w.add('Assault Squad', 2);
    openHash('#/r/r/sheet');

    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [w.roster] });

    await screen.findByRole('heading', { name: 'Test list' });
    expect(sheetUnits()).toEqual([
      ['Tactical Squad', '115'],
      ['2× Assault Squad', '160'],
    ]);
    expect(document.querySelector('.as-pts')?.textContent).toBe('275 / 2,000 pts');
  });
});

describe('SharedView', () => {
  it('opens a share link as a read-only list, with no game data on the phone', async () => {
    openHash(await linkHash(SHARED));

    await renderScreen(<App />);

    await screen.findByRole('heading', { name: 'Friendly Fire' });
    expect(sheetUnits()).toEqual([
      ['Land Raider', '1,250'],
      ['Servitor', '25'],
    ]);
    expect(document.querySelector('.as-pts')?.textContent).toBe('1,275 / 2,000 pts');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent.trim());
    expect(buttons).toEqual(['Open Muster', 'Print / save PDF', 'Share link']);
    expect(document.querySelector('.tabbar')).toBeNull();
    expect(await db.rosters()).toEqual([]);
  });

  it.each([
    { broken: 'a link cut short', hash: async () => (await linkHash(SHARED)).slice(0, 30) },
    { broken: 'a link that holds no packed data', hash: async () => '#/view/not-a-list!' },
    { broken: 'a link with a stray percent sign', hash: async () => '#/view/abc%' },
    { broken: 'a list missing the fields the sheet reads', hash: () => linkHashOf({ ...SHARED, forces: [{}] }) },
    { broken: 'a list from a newer Muster', hash: () => linkHashOf({ ...SHARED, v: 2 }) },
    { broken: 'a link that unpacks past 5 MB', hash: () => linkHashOf({ ...SHARED, name: 'x'.repeat(5_000_001) }) },
    { broken: 'a link with too many units', hash: () => linkHash(tooManyUnits) },
    { broken: 'a list name that is a nested list', hash: () => linkHashOf({ ...SHARED, name: [[{}]] }) },
  ])('shows the readable error for $broken', async ({ hash }) => {
    openHash(await hash());

    await renderScreen(<App />);

    await screen.findByText("This link doesn't contain a readable list. It may have been cut short when it was sent.");
    expect(sheetUnits()).toEqual([]);
  });
});

describe('the stats on a unit', () => {
  const stat = (name: string, type: string, value = '4') => ({
    name,
    type,
    chars: [['S', value]] as [string, string][],
  });
  const WORDY = 'a line far too long for a grid';

  /** Each block of stats on the sheet, as the profile names it shows. */
  async function statBlocks(profiles: SnapProfile[]) {
    const unit = { name: 'Servitor', cat: 'Elites', pts: 25, gear: [], profiles, rules: [] };
    openHash(await linkHash({ ...SHARED, forces: [{ ...SHARED.forces[0], units: [unit] }] }));
    await renderScreen(<App />);
    await screen.findByRole('heading', { name: 'Friendly Fire' });
    return [...document.querySelectorAll('.as-stats')].map((block) =>
      [...block.querySelectorAll('b')].map((name) => name.textContent),
    );
  }

  it('puts unit stats first, then weapons, then the rest, and keeps the order within each', async () => {
    const profiles = [
      stat('Psychic Power', 'Psychic'),
      stat('Bolter', 'Ranged Weapon'),
      stat('Servitor', 'Unit'),
      stat('Fist', 'Melee Weapon'),
      stat('Tank', 'Vehicle'),
      stat('Aura', 'Ability'),
    ];
    expect(await statBlocks(profiles)).toEqual([
      ['Servitor'],
      ['Tank'],
      ['Bolter'],
      ['Fist'],
      ['Psychic Power'],
      ['Aura'],
    ]);
  });

  it('draws every profile of a type in one block, wherever it sits in the unit', async () => {
    const profiles = [stat('Bolter', 'Weapon'), stat('Servitor', 'Unit'), stat('Fist', 'Weapon')];
    expect(await statBlocks(profiles)).toEqual([['Servitor'], ['Bolter', 'Fist']]);
  });

  it('leaves out a type with a wordy value, unless it is a unit or a weapon', async () => {
    const profiles = [
      stat('Servitor', 'Unit', WORDY),
      stat('Bolter', 'Weapon', WORDY),
      stat('Short', 'Ability'),
      stat('Long', 'Ability', WORDY),
      stat('Aura', 'Psychic'),
    ];
    expect(await statBlocks(profiles)).toEqual([['Servitor'], ['Bolter'], ['Aura']]);
  });
});

describe('Share link', () => {
  const WITH_RULES: Snapshot = { ...SHARED, rules: [['Bolter Drill', 'Fires twice.']] };
  const CANCELLED = new DOMException('Share canceled', 'AbortError');
  const REFUSED = new DOMException('Permission denied', 'NotAllowedError');

  /** Stands in for a phone's share sheet and clipboard, which jsdom lacks. */
  function stubSharing({ share, copy }: { share?: () => Promise<void>; copy?: () => Promise<void> }) {
    const shared = vi.fn<(data: ShareData) => Promise<void>>(share);
    const copied = vi.fn<(url: string) => Promise<void>>(copy ?? (async () => {}));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share && shared });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copied } });
    return { shared, copied };
  }

  async function pressShareLink(snap: Snapshot) {
    openHash(await linkHash(snap));
    await renderScreen(<App />);
    await press('Share link');
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('shares a link to the list with no toast when the rule text fits', async () => {
    const { shared, copied } = stubSharing({ share: async () => {} });
    await pressShareLink(WITH_RULES);
    await waitFor(() => expect(shared).toHaveBeenCalled());
    const [data] = shared.mock.calls[0];
    expect(data.title).toBe('Friendly Fire');
    expect(data.text).toBe('Friendly Fire · 1,275 pts');
    expect(new URL(data.url ?? '').hash).toBe(await linkHash(WITH_RULES));
    expect(copied).not.toHaveBeenCalled();
    expect(getState().toast).toBeUndefined();
  });

  it('says when the shared link leaves out the rule text', async () => {
    stubSharing({ share: async () => {} });
    await pressShareLink(SHARED);
    await expectToast('Link shared. Rule text was left out to keep it short');
  });

  it('shows nothing and copies nothing when the player cancels the share sheet', async () => {
    const { shared, copied } = stubSharing({
      share: async () => {
        throw CANCELLED;
      },
    });
    await pressShareLink(SHARED);
    await waitFor(() => expect(shared).toHaveBeenCalled());
    await shared.mock.results[0].value.catch(() => {});
    expect(copied).not.toHaveBeenCalled();
    expect(getState().toast).toBeUndefined();
  });

  it('counts a plain error named AbortError as a failure, not a cancel', async () => {
    const { copied } = stubSharing({
      share: async () => {
        throw Object.assign(new Error('Stopped'), { name: 'AbortError' });
      },
    });
    await pressShareLink(SHARED);
    await expectToast("Couldn't share: Stopped. Copied it instead (rule text left out to keep it short)");
    expect(copied).toHaveBeenCalledTimes(1);
  });

  it('copies the link when the share sheet fails, and gives the reason', async () => {
    const { copied } = stubSharing({
      share: async () => {
        throw REFUSED;
      },
    });
    await pressShareLink(WITH_RULES);
    await expectToast("Couldn't share: Permission denied. Copied it instead");
    const [url] = copied.mock.calls[0];
    expect(new URL(url).hash).toBe(await linkHash(WITH_RULES));
  });

  it('says the copied link leaves out the rule text when the share sheet fails', async () => {
    const { copied } = stubSharing({
      share: async () => {
        throw REFUSED;
      },
    });
    await pressShareLink(SHARED);
    await expectToast("Couldn't share: Permission denied. Copied it instead (rule text left out to keep it short)");
    expect(copied).toHaveBeenCalledOnce();
  });

  it("gives the share sheet's reason when the clipboard refuses too", async () => {
    const { copied } = stubSharing({
      share: async () => {
        throw REFUSED;
      },
      copy: async () => {
        throw new Error('Clipboard blocked');
      },
    });
    await pressShareLink(SHARED);
    await waitFor(() => expect(copied).toHaveBeenCalled());
    await expectToast("Couldn't share: Permission denied");
  });

  it('copies the link where there is no share sheet', async () => {
    const { copied } = stubSharing({});
    await pressShareLink(WITH_RULES);
    await expectToast('Link copied');
    const [url] = copied.mock.calls[0];
    expect(new URL(url).hash).toBe(await linkHash(WITH_RULES));
  });

  it('says when the copied link leaves out the rule text', async () => {
    stubSharing({});
    await pressShareLink(SHARED);
    await expectToast('Link copied (rule text left out to keep it short)');
  });

  it('shows the reason when the clipboard refuses', async () => {
    stubSharing({
      copy: async () => {
        throw REFUSED;
      },
    });
    await pressShareLink(SHARED);
    await expectToast("Couldn't share: Permission denied");
  });

  it('shows the reason when packing the link fails', async () => {
    const { copied } = stubSharing({});
    openHash(await linkHash(SHARED));
    await renderScreen(<App />);
    const button = await screen.findByRole('button', { name: 'Share link' });
    vi.stubGlobal(
      'CompressionStream',
      class {
        constructor() {
          throw new Error('No compression on this phone');
        }
      },
    );
    fireEvent.click(button);
    await expectToast("Couldn't share: No compression on this phone");
    expect(copied).not.toHaveBeenCalled();
  });
});
