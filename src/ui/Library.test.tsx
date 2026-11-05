// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db, type SavedUnit } from '../data/db';
import { getState } from '../store';
import { unit } from '../test/fixture';
import {
  expectError,
  expectToast,
  failReads,
  openHash,
  refuse,
  renderScreen,
  stubBrowserGaps,
  worldFiles,
} from '../test/screen';

const STATS =
  '<profiles><profile id="p" name="Tactical Marine" typeId="t" typeName="Unit"><characteristics><characteristic name="M" typeId="m">7</characteristic><characteristic name="Sv" typeId="s">3+</characteristic></characteristics></profile></profiles>';

const rule = (id: string, name: string, text: string) =>
  `<rule id="${id}" name="${name}"><description>${text}</description></rule>`;
const armyFile = (id: string, name: string, rules: string) =>
  `<catalogue id="${id}" name="${name}" revision="1" gameSystemId="gst"><rules>${rules}</rules></catalogue>`;

/** The Rules tab of the Library, reached from Armies, once its search has every rule loaded. */
async function openRules(files: Record<string, string>, total: number) {
  await renderScreen(<App />, { files });
  fireEvent.click(await screen.findByRole('tab', { name: 'Rules' }));
  return screen.findByPlaceholderText(`Search ${total} rules`);
}

beforeEach(async () => {
  await stubBrowserGaps();
  openHash('#/lib');
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { id } of await db.savedUnits()) await db.delSavedUnit(id);
});

describe('Library', () => {
  it('opening a unit from Armies shows its profile, and its rules on the Rules tab', async () => {
    const units = unit(
      'tac',
      'Tactical Squad',
      100,
      `${STATS}<rules>${rule('r', 'Bolter Drill', 'Hits on a six strike twice.')}</rules>`,
    );
    await renderScreen(<App />, { files: worldFiles(units) });

    fireEvent.click(screen.getByRole('link', { name: 'Test Army' }));
    fireEvent.click(await screen.findByRole('link', { name: /Tactical Squad/ }));

    const profiles = await screen.findByRole('tab', { name: 'Profiles' });
    const rules = screen.getByRole('tab', { name: 'Rules' });
    screen.getByRole('heading', { name: 'Tactical Squad' });
    expect(profiles.getAttribute('aria-selected')).toBe('true');
    screen.getByText('Tactical Marine');
    screen.getByText('3+');
    expect(screen.queryByText('Hits on a six strike twice.')).toBeNull();

    fireEvent.click(rules);

    expect(rules.getAttribute('aria-selected')).toBe('true');
    screen.getByText('Bolter Drill');
    screen.getByText('Hits on a six strike twice.');
    expect(screen.queryByText('Tactical Marine')).toBeNull();
  });

  it('searching Rules finds a rule by its text and names the army it comes from', async () => {
    const search = await openRules(
      {
        ...worldFiles('', { cat: `<rules>${rule('a', 'Bolter Drill', 'Hits on a six strike twice.')}</rules>` }),
        'orks.cat': armyFile('orks', 'Ork Horde', rule('b', 'Deep Strike', 'Arrives from reserve.')),
      },
      2,
    );

    fireEvent.input(search, { target: { value: 'RESERVE' } });

    screen.getByText('1 match');
    screen.getByText('Deep Strike');
    expect(screen.getByText('Arrives from reserve.').nextElementSibling?.textContent).toBe('Ork Horde');
    expect(screen.queryByText('Bolter Drill')).toBeNull();
  });

  it('groups differently worded copies of a rule and labels each wording by army', async () => {
    const search = await openRules(
      {
        ...worldFiles('', { cat: `<rules>${rule('a', 'Fearless', 'Never runs.')}</rules>` }),
        'eldar.cat': armyFile('eldar', 'Eldar Host', rule('b', 'Fearless', 'Never runs.')),
        'orks.cat': armyFile('orks', 'Ork Horde', rule('c', 'Fearless', 'Runs only from bigger Orks.')),
      },
      1,
    );

    fireEvent.input(search, { target: { value: 'fearless' } });

    const copies = screen.getAllByRole('group');
    expect(copies).toHaveLength(1);
    within(copies[0]).getByText('· 2 versions');
    expect(screen.getByText('Never runs.').nextElementSibling?.textContent).toBe('Eldar Host, Test Army');
    expect(screen.getByText('Runs only from bigger Orks.').nextElementSibling?.textContent).toBe('Ork Horde');
  });

  it('gives the reason on an army when it fails to load with a reason that is no Error', async () => {
    await renderScreen(<App />, { files: worldFiles(unit('tac', 'Tactical Squad', 100)) });
    failReads('Storage is gone');

    fireEvent.click(screen.getByRole('link', { name: 'Test Army' }));

    await expectError('Storage is gone');
  });

  it('gives the reason on Rules when they fail to load with a reason that is no Error', async () => {
    await renderScreen(<App />, { files: worldFiles(unit('scout', 'Scout Squad', 70)) });
    failReads('Storage is gone');

    fireEvent.click(await screen.findByRole('tab', { name: 'Rules' }));

    await expectError('Storage is gone');
  });

  describe('Saved units', () => {
    const TAC = unit('tac', 'Tactical Squad', 100);
    const saved = (id: string, name: string, o: Partial<SavedUnit> = {}): SavedUnit => ({
      id,
      name,
      repo: 'test/repo',
      gameSystemId: 'gst',
      catalogueId: 'cat',
      key: 'tac',
      categoryId: '',
      build: { uid: 's-' + id, key: 'tac', number: 1, children: [] },
      created: 1,
      updated: 1,
      ...o,
    });

    /** The army's unit list, with these saved units on the phone. */
    async function openArmy(units: readonly SavedUnit[]) {
      for (const u of units) await db.putSavedUnit(u);
      await renderScreen(<App />, { files: worldFiles(TAC) });
      fireEvent.click(screen.getByRole('link', { name: 'Test Army' }));
      await screen.findByRole('link', { name: /Tactical Squad/ });
    }

    const savedNames = () =>
      [...(screen.queryByRole('group', { name: 'Saved units' })?.querySelectorAll('b') ?? [])].map(
        (b) => b.textContent,
      );

    it('lists first the saved units of this army file, and none from another army or repo', async () => {
      await openArmy([
        saved('thrax', 'Squad Thrax'),
        saved('orks', 'Da Boyz', { catalogueId: 'orks' }),
        saved('elsewhere', 'Squad Elsewhere', { repo: 'other/repo' }),
      ]);

      expect(savedNames()).toEqual(['Squad Thrax']);
      expect([...document.querySelectorAll('.list-label')].map((l) => l.textContent)).toEqual(['Saved units', 'Other']);
    });

    it('shows no Saved units section for an army with no saved units', async () => {
      await openArmy([saved('orks', 'Da Boyz', { catalogueId: 'orks' })]);

      expect(screen.queryByRole('group', { name: 'Saved units' })).toBeNull();
      expect(screen.queryByText('Saved units')).toBeNull();
    });

    it('searching units narrows the saved units by name', async () => {
      await openArmy([saved('thrax', 'Squad Thrax'), saved('iron', 'Squad Iron')]);

      fireEvent.input(screen.getByPlaceholderText('Search units'), { target: { value: 'IRON' } });

      expect(savedNames()).toEqual(['Squad Iron']);
    });

    /** Opens the rename sheet of saved unit `name`, types `typed` and closes it. */
    function rename(name: string, typed: string) {
      fireEvent.click(screen.getByRole('button', { name: `Rename ${name}` }));
      fireEvent.input(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' }), {
        target: { value: typed },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    }
    const storedName = async (id: string) => (await db.savedUnits()).find((u) => u.id === id)?.name;

    it('renames a saved unit from its rename button', async () => {
      await openArmy([saved('thrax', 'Squad Thrax')]);

      rename('Squad Thrax', '  Squad Iron ');

      await waitFor(() => expect(savedNames()).toEqual(['Squad Iron']));
      expect(await storedName('thrax')).toBe('Squad Iron');
    });

    it('keeps the old name when the rename leaves the name empty', async () => {
      await openArmy([saved('thrax', 'Squad Thrax')]);
      const before = getState().savedUnits;

      rename('Squad Thrax', '   ');

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(getState().savedUnits).toBe(before);
      expect(savedNames()).toEqual(['Squad Thrax']);
      expect(await storedName('thrax')).toBe('Squad Thrax');
    });

    it('tells the player when storage refuses the rename, and keeps the old name', async () => {
      await openArmy([saved('thrax', 'Squad Thrax')]);
      refuse('put');

      rename('Squad Thrax', 'Squad Iron');

      await expectToast("Couldn't rename this saved unit: Storage is full");
      expect(savedNames()).toEqual(['Squad Thrax']);
    });

    const ASKED = `Delete "Squad Thrax"? Lists that hold it keep it as a normal unit, without the name.`;
    const answer = (yes: boolean) => vi.spyOn(window, 'confirm').mockReturnValue(yes);
    const stored = async () => (await db.savedUnits()).map((u) => u.id);

    it('asks before deleting a saved unit, saying what happens to its copies, and keeps it on no', async () => {
      await openArmy([saved('thrax', 'Squad Thrax')]);
      const asked = answer(false);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Squad Thrax' }));

      expect(asked).toHaveBeenCalledWith(ASKED);
      expect(savedNames()).toEqual(['Squad Thrax']);
      expect(await stored()).toEqual(['thrax']);
    });

    it('deletes a saved unit once the player agrees', async () => {
      await openArmy([saved('thrax', 'Squad Thrax'), saved('iron', 'Squad Iron')]);
      answer(true);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Squad Thrax' }));

      await waitFor(() => expect(savedNames()).toEqual(['Squad Iron']));
      expect(await stored()).toEqual(['iron']);
    });

    it('tells the player when storage refuses the delete, and keeps the saved unit', async () => {
      await openArmy([saved('thrax', 'Squad Thrax')]);
      answer(true);
      refuse('delete');

      fireEvent.click(screen.getByRole('button', { name: 'Delete Squad Thrax' }));

      await expectToast("Couldn't delete this saved unit: Storage is full");
      expect(savedNames()).toEqual(['Squad Thrax']);
    });
  });
});
