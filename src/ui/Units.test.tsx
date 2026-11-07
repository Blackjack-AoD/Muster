// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db, type SavedUnit } from '../data/db';
import type { Roster, Sel } from '../data/engine';
import { dismissToast } from '../store';
import { children, cons, entry, sergeant, unit, world } from '../test/fixture';
import { drag, openHash, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';
import { SWIPE } from './swipe';

const ALLEGIANCE = entry(
  'al',
  'Allegiance',
  0,
  `<constraints><constraint id="al-min" type="min" value="1" field="selections" scope="force"/></constraints>
  <selectionEntryGroups>
    <selectionEntryGroup id="side" name="Side">
      ${cons('<constraint id="side-max" type="max" value="1" field="selections" scope="parent"/>')}
      ${children(entry('loy', 'Loyalist'), entry('tra', 'Traitor'))}
    </selectionEntryGroup>
  </selectionEntryGroups>`,
);
const FIST = entry(
  'fist',
  'Power Fist',
  15,
  cons('<constraint id="fist-max" type="max" field="selections" scope="parent" value="1"/>'),
);
const TAC = unit('tac', 'Tactical Squad', 100, children(FIST, sergeant()));
const DATA = ALLEGIANCE + TAC;

const sel = (key: string, kids: Sel[] = []): Sel => ({ uid: `s-${key}`, key, number: 1, children: kids });
const saved = (id: string, extra: Partial<SavedUnit> = {}): SavedUnit => ({
  id,
  name: '',
  kind: 'preconfigured',
  repo: 'test/repo',
  gameSystemId: 'gst',
  catalogueId: 'cat',
  key: 'tac',
  categoryId: '',
  build: sel('tac', [sel('sgt')]),
  created: 0,
  updated: 0,
  ...extra,
});
const thrax = (extra: Partial<SavedUnit> = {}) => saved('thrax', { name: 'Squad Thrax', kind: undefined, ...extra });

/** Opens `hash` with these saved units and lists on the phone. */
async function open(hash: string, units: readonly SavedUnit[], rosters: readonly Roster[] = []) {
  for (const u of units) await db.putSavedUnit(u);
  openHash(hash);
  await renderScreen(<App />, { files: worldFiles(DATA), rosters });
}

/** A list holding a copy of saved unit `unit`, as adding it would leave it. */
function listWithCopy(unitId: string, name: string | undefined, build: Sel): Roster {
  const w = world(DATA);
  w.roster.forces[0]?.selections.push({ ...structuredClone(build), uid: 'copy', saved: unitId, name });
  return w.roster;
}

const storedUnit = async (id: string) => (await db.savedUnits()).find((u) => u.id === id);
const rows = () =>
  [...document.querySelectorAll('.army-units .pick')].map((r) => [
    r.querySelector('b')?.textContent,
    r.querySelector('.pick-sub')?.textContent,
    r.querySelector('.pick-pts')?.textContent,
  ]);

beforeEach(stubBrowserGaps);
afterEach(async () => {
  dismissToast();
  vi.unstubAllGlobals();
  for (const { id } of await db.savedUnits()) await db.delSavedUnit(id);
});

describe('Units tab', () => {
  it('sits between Lists and Library in the tab bar', async () => {
    await open('#/units', []);
    expect([...document.querySelectorAll('.tabbar a span')].map((s) => s.textContent)).toEqual([
      'Lists',
      'Units',
      'Library',
      'Games',
      'Data',
    ]);
  });

  it('lists saved units by army and category, with name, wargear and points', async () => {
    await open('#/units', [thrax({ build: sel('tac', [sel('sgt'), sel('fist')]) }), saved('melta')]);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Test Army' })).not.toBeNull();
    expect([...document.querySelectorAll('.army-units .list-label')].map((l) => l.textContent)).toEqual(['Other']);
    expect(rows()).toEqual([
      ['Squad Thrax', 'Sergeant · Power Fist', '135'],
      ['Tactical Squad', 'Sergeant', '120'],
    ]);
  });

  it('searching narrows the saved units by name', async () => {
    await open('#/units', [thrax(), saved('melta')]);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.input(screen.getByPlaceholderText('Search units'), { target: { value: 'thrax' } });

    expect(rows().map((r) => r[0])).toEqual(['Squad Thrax']);
  });

  it('deletes a saved unit on a swipe left, after asking', async () => {
    const ask = vi.fn(() => true);
    vi.stubGlobal('confirm', ask);
    await open('#/units', [thrax()]);
    await waitFor(() => expect(rows()).toHaveLength(1));

    drag(screen.getByRole('button', { name: /Squad Thrax/ }), [[-SWIPE, 0]]);

    expect(ask).toHaveBeenCalledWith(
      'Delete "Squad Thrax"? Lists that hold it keep it as a normal unit, without the name.',
    );
    await waitFor(async () => expect(await db.savedUnits()).toEqual([]));
  });

  it("+ sets up one of the army's units as a preconfigured unit, keeps it, and opens it", async () => {
    await open('#/units', []);
    fireEvent.click(screen.getByRole('button', { name: /New unit/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Tactical Squad/ }));

    await waitFor(async () =>
      expect((await db.savedUnits()).map((u) => [u.kind, u.name, u.key])).toEqual([['preconfigured', '', 'tac']]),
    );
    const [made] = await db.savedUnits();
    await waitFor(() => expect(location.hash).toBe(`#/units/${made?.id}`));
    expect(made?.setUp?.selections.map((s) => s.key)).toEqual(['al']);
  });
});

describe("a saved unit's page", () => {
  it('keeps an edit straight away, and a copy in a list that matched it follows', async () => {
    const unit = thrax();
    await open('#/units/thrax', [unit], [listWithCopy('thrax', 'Squad Thrax', unit.build)]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('checkbox', { name: /Power Fist/ }));

    await waitFor(async () =>
      expect((await storedUnit('thrax'))?.build.children.map((c) => c.key)).toEqual(['sgt', 'fist']),
    );
    await waitFor(async () =>
      expect((await db.rosters())[0]?.forces[0]?.selections.map((s) => s.children.map((c) => c.key))).toEqual([
        ['sgt', 'fist'],
      ]),
    );
  });

  it('leaves a copy that was changed in its list with its own build', async () => {
    const unit = thrax();
    await open('#/units/thrax', [unit], [listWithCopy('thrax', 'Squad Thrax', sel('tac'))]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('checkbox', { name: /Power Fist/ }));

    await waitFor(async () => expect((await storedUnit('thrax'))?.build.children).toHaveLength(2));
    expect((await db.rosters())[0]?.forces[0]?.selections[0]?.children).toEqual([]);
  });

  it('naming a preconfigured unit makes it a unique unit', async () => {
    await open('#/units/melta', [saved('melta')]);
    await screen.findByRole('heading', { name: 'Tactical Squad' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Squad Iron' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(async () => expect(await storedUnit('melta')).toMatchObject({ name: 'Squad Iron' }));
    expect(await storedUnit('melta')).not.toHaveProperty('kind');
  });

  it('shows the army set-up, and keeps a side picked there with the unit', async () => {
    await open('#/units/thrax', [thrax()]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('button', { name: /Army set-up/ }));
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Allegiance' })).getByRole('radio', { name: 'Traitor' }),
    );

    await waitFor(async () =>
      expect((await storedUnit('thrax'))?.setUp?.selections.map((s) => s.children.map((c) => c.key))).toEqual([
        ['side/tra'],
      ]),
    );
  });

  it('gives a saved unit from before set-ups were kept a new list’s set-up when it opens', async () => {
    await open('#/units/thrax', [thrax()]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    await waitFor(async () =>
      expect((await storedUnit('thrax'))?.setUp?.selections.map((s) => s.children.map((c) => c.key))).toEqual([
        ['side/loy'],
      ]),
    );
  });

  it('Duplicate makes a second saved unit and opens it', async () => {
    await open('#/units/thrax', [thrax()]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('button', { name: /Duplicate/ }));

    await waitFor(async () =>
      expect((await db.savedUnits()).map((u) => u.name).sort()).toEqual(['Squad Thrax', 'Squad Thrax (copy)']),
    );
    const copy = (await db.savedUnits()).find((u) => u.id !== 'thrax');
    await waitFor(() => expect(location.hash).toBe(`#/units/${copy?.id}`));
  });

  it('Delete asks, deletes the saved unit, and its copies become normal units', async () => {
    vi.stubGlobal('confirm', () => true);
    const unit = thrax();
    await open('#/units/thrax', [unit], [listWithCopy('thrax', 'Squad Thrax', unit.build)]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));

    await waitFor(async () => expect(await db.savedUnits()).toEqual([]));
    await waitFor(async () => expect((await db.rosters())[0]?.forces[0]?.selections[0]).not.toHaveProperty('saved'));
  });

  it('lists the lists that hold a copy, and says when a copy has changes of its own', async () => {
    const unit = thrax();
    const same = { ...listWithCopy('thrax', 'Squad Thrax', unit.build), uid: 'same', name: 'Same list' };
    const changed = {
      ...listWithCopy('thrax', 'Squad Thrax', sel('tac', [sel('sgt'), sel('fist')])),
      uid: 'changed',
      name: 'Changed list',
    };
    await open('#/units/thrax', [unit], [same, changed]);
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    const held = [...document.querySelectorAll('.held-in .pick')].map((r) => [
      r.querySelector('b')?.textContent,
      r.querySelector('.pick-sub')?.textContent,
    ]);
    expect(held.sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['Changed list', 'Test Army · changed in this list'],
      ['Same list', 'Test Army'],
    ]);
  });
});
