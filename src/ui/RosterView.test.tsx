// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { addMandatoryRoots } from '../data/setup';
import {
  ASSAULT,
  RULED_OUT_BY_ASSAULT,
  SWORD,
  children,
  entry,
  sergeant,
  unit,
  world,
  type WorldOptions,
} from '../test/fixture';
import { drag, openHash, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';
import { SWIPE } from './swipe';

const UNITS = unit('tac', 'Tactical Squad', 100, children(sergeant())) + ASSAULT;

/** Waits for the list itself, as its heading also shows while the data loads. */
async function openList(w: ReturnType<typeof world>, units = UNITS, data: Pick<WorldOptions, 'gst'> = {}) {
  openHash('#/r/r');
  await renderScreen(<App />, { files: worldFiles(units, data), rosters: [w.roster] });
  await waitFor(() => expect(sumPoints()).not.toBeUndefined());
}

const sumPoints = () => document.querySelector('.sum-bar .pts')?.textContent;
const chip = () => document.querySelector('.sum-bar .chip');
const issues = () => [...document.querySelectorAll('.issues li')].map((li) => [li.className, li.textContent]);

async function openIssues() {
  const open = chip();
  if (!open) throw new Error('no issues chip on the list');
  fireEvent.click(open);
  const sheet = await screen.findByRole('dialog');
  within(sheet).getByText('List check');
  return sheet;
}

/** Each unit on the list as its name and the points it shows. */
const unitRows = () =>
  [...document.querySelectorAll('.unit-row')].map((row) => [
    row.querySelector('.ur-name')?.textContent,
    row.querySelector('.ur-pts')?.textContent,
  ]);

/** Each unit on the list as its name, the class of its row and any note on it. */
const rowMarks = () =>
  [...document.querySelectorAll('.unit-row')].map((row) => [
    row.querySelector('.ur-name')?.textContent,
    row.className,
    row.querySelector('.ur-note')?.textContent,
  ]);

/** Opens the add sheet from one of the buttons with this name, and returns it. */
async function openAddSheet(name: string, nth = 0) {
  const button = screen.getAllByRole('button', { name })[nth];
  if (!button) throw new Error(`no button ${nth} called ${name}`);
  fireEvent.click(button);
  return screen.findByRole('dialog');
}

const offered = (sheet: HTMLElement) => [...sheet.querySelectorAll('.pick b')].map((name) => name.textContent);

beforeEach(stubBrowserGaps);

describe('RosterView', () => {
  it('adding a unit shows it with its points and adds them to the total', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    w.add('Assault Squad');
    await openList(w);
    expect(sumPoints()).toBe('80/2,000pts');

    fireEvent.click(screen.getByRole('button', { name: 'Add unit' }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /Tactical Squad/ }));
    await screen.findByRole('heading', { name: 'Tactical Squad' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(sumPoints()).toBe('200/2,000pts'));
    expect(unitRows()).toEqual([
      ['Assault Squad', '80'],
      ['Tactical Squad', '120'],
    ]);
    const [saved] = await db.rosters();
    expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['assault', 'tac']);
  });

  it('shows going over the limit in the issues sheet, by how much', async () => {
    const w = world(UNITS, { costLimit: 150 });
    w.add('Assault Squad', 3);
    await openList(w);
    expect(chip()?.textContent).toBe('1 issue');

    await openIssues();

    expect(issues()).toEqual([['error', 'Over points limit by 90']]);
  });

  it('opens the unit from an issue on it in the issues sheet', async () => {
    const units = unit(
      'tac',
      'Tactical Squad',
      100,
      `<constraints>
        <constraint id="tac-max" type="max" field="selections" scope="parent" value="1"/>
      </constraints>`,
    );
    const w = world(units);
    const sel = w.add('Tactical Squad', 3);
    await openList(w, units);
    expect(chip()?.textContent).toBe('1 issue');

    const sheet = await openIssues();
    fireEvent.click(within(sheet).getByRole('link', { name: 'Tactical Squad: at most 1 allowed (has 3)' }));

    await screen.findByRole('heading', { name: 'Tactical Squad' });
    expect(location.hash).toBe(`#/r/r/u/${sel}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a unit gone from the data as a note in the issues sheet', async () => {
    const w = world(UNITS);
    w.add('Tactical Squad');
    w.add('Assault Squad');
    await openList(w, ASSAULT);
    expect(chip()?.textContent).toBe('1 note');

    await openIssues();

    expect(issues()).toEqual([['warn', '1 unit(s) no longer exist in the data and were skipped']]);
    expect(sumPoints()).toBe('80pts');
  });

  describe('warnings on a unit row', () => {
    const BARE = unit('tac', 'Tactical Squad', 100);

    it('marks a unit that has lost wargear with a note', async () => {
      const w = world(UNITS);
      w.add('Tactical Squad');
      await openList(w, BARE);

      expect(rowMarks()).toEqual([['Tactical Squad', 'unit-row warn', 'note']]);
    });

    it('marks a unit for a warning on a selection under it', async () => {
      const w = world(unit('tac', 'Tactical Squad', 100, children(sergeant(children(SWORD)))));
      w.add('Tactical Squad');
      await openList(w, UNITS);

      expect(rowMarks()).toEqual([['Tactical Squad', 'unit-row warn', 'note']]);
    });

    it('marks a unit that the choices rule out with a note', async () => {
      const units = RULED_OUT_BY_ASSAULT + ASSAULT;
      const w = world(units);
      w.add('Tactical Squad');
      w.add('Assault Squad');
      await openList(w, units);

      expect(rowMarks()).toEqual([
        ['Tactical Squad', 'unit-row warn', 'note'],
        ['Assault Squad', 'unit-row', undefined],
      ]);
    });

    it('shows a unit with an error and a warning as an error, unlike a unit with only the warning', async () => {
      const capped = (inner = '') =>
        unit(
          'vet',
          'Veteran Squad',
          100,
          `<constraints>
            <constraint id="vet-max" type="max" field="selections" scope="parent" value="1"/>
          </constraints>${inner}`,
        );
      const w = world(UNITS + capped(children(sergeant())));
      w.add('Tactical Squad');
      w.add('Veteran Squad', 3);
      await openList(w, BARE + capped());

      expect(rowMarks()).toEqual([
        ['Tactical Squad', 'unit-row warn', 'note'],
        ['3× Veteran Squad', 'unit-row bad', undefined],
      ]);
    });

    it("leaves a unit plain when the warnings are another unit's or the whole list's", async () => {
      const w = world(UNITS + unit('gone', 'Gone Squad', 50));
      w.add('Tactical Squad');
      w.add('Assault Squad');
      w.add('Gone Squad');
      await openList(w, BARE + ASSAULT);

      expect(rowMarks()).toEqual([
        ['Tactical Squad', 'unit-row warn', 'note'],
        ['Assault Squad', 'unit-row', undefined],
      ]);
    });
  });

  it('says so in the issues sheet when a list has no issues', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    w.add('Assault Squad');
    await openList(w);
    expect(chip()?.textContent).toBe('Valid');

    const sheet = await openIssues();

    within(sheet).getByText(/No problems found/);
    expect(issues()).toEqual([]);
  });

  describe('add sheet', () => {
    const HQ_DATA = {
      gst: `<categoryEntries><categoryEntry id="hq" name="HQ"/></categoryEntries>
        <forceEntries>
          <forceEntry id="det" name="Detachment">
            <categoryLinks>
              <categoryLink id="det-hq" name="HQ" targetId="hq" primary="false">
                <constraints>
                  <constraint id="hq-max" type="max" field="selections" scope="force" value="1"/>
                </constraints>
              </categoryLink>
            </categoryLinks>
          </forceEntry>
        </forceEntries>`,
    };

    it('leaves out an entry at its max in the detachment and keeps one with room left', async () => {
      const units =
        unit(
          'term',
          'Terminators',
          100,
          `<constraints>
            <constraint id="term-max" type="max" field="selections" scope="force" value="2"/>
          </constraints>`,
        ) +
        unit(
          'scout',
          'Scouts',
          50,
          `<constraints>
            <constraint id="scout-max" type="max" field="selections" scope="force" value="3"/>
          </constraints>`,
        );
      const w = world(units);
      w.add('Terminators', 2);
      w.add('Scouts', 2);
      await openList(w, units);

      expect(offered(await openAddSheet('Add unit'))).toEqual(['Scouts']);
    });

    it('leaves out a set-up entry with no room left and keeps one the set-up added whose max allows another', async () => {
      const units =
        entry(
          'allegiance',
          'Allegiance',
          0,
          `<constraints>
            <constraint id="alg-min" type="min" field="selections" scope="parent" value="1"/>
            <constraint id="alg-max" type="max" field="selections" scope="parent" value="1"/>
          </constraints>`,
        ) +
        entry(
          'honours',
          'Battle Honours',
          0,
          `<constraints>
            <constraint id="hon-min" type="min" field="selections" scope="parent" value="1"/>
            <constraint id="hon-max" type="max" field="selections" scope="parent" value="2"/>
          </constraints>`,
        );
      const w = world(units);
      addMandatoryRoots(w.roster, w.contexts, 'f1');
      await openList(w, units);

      expect(offered(await openAddSheet('Add unit'))).toEqual(['Battle Honours']);
    });

    it('counts a list-wide max across detachments, and a detachment max in that detachment only', async () => {
      const units =
        unit(
          'lord',
          'Warlord',
          100,
          `<constraints>
            <constraint id="lord-max" type="max" field="selections" scope="roster" value="1"/>
          </constraints>`,
        ) +
        unit(
          'guard',
          'Honour Guard',
          50,
          `<constraints>
            <constraint id="guard-max" type="max" field="selections" scope="force" value="1"/>
          </constraints>`,
        );
      const w = world(units);
      w.addForce('f2');
      w.add('Warlord');
      w.add('Honour Guard');
      await openList(w, units);

      expect(offered(await openAddSheet('Add unit', 1))).toEqual(['Honour Guard']);
    });

    it.each(['Add unit', 'Add HQ'])('keeps a unit whose category is full, from the %s button', async (button) => {
      const units =
        unit(
          'captain',
          'Captain',
          100,
          '<categoryLinks><categoryLink id="capt-hq" name="HQ" targetId="hq" primary="true"/></categoryLinks>',
        ) +
        unit(
          'champ',
          'Champion',
          50,
          `<categoryLinks><categoryLink id="champ-hq" name="HQ" targetId="hq" primary="true"/></categoryLinks>
          <constraints>
            <constraint id="champ-max" type="max" field="selections" scope="force" value="1"/>
          </constraints>`,
        );
      const w = world(units, HQ_DATA);
      w.add('Champion');
      await openList(w, units, HQ_DATA);

      expect(offered(await openAddSheet(button))).toEqual(['Captain']);
    });

    it.each([
      ['Add unit', ['Captain', 'Transport']],
      ['Add HQ', ['Captain']],
    ])('offers from the %s button only what it covers', async (button, names) => {
      const units =
        unit(
          'captain',
          'Captain',
          100,
          '<categoryLinks><categoryLink id="capt-hq" name="HQ" targetId="hq" primary="true"/></categoryLinks>',
        ) +
        unit(
          'rhino',
          'Transport',
          50,
          '<categoryLinks><categoryLink id="rhino-tr" name="Transport" targetId="tr" primary="true"/></categoryLinks>',
        );
      const data = {
        gst: `<categoryEntries>
            <categoryEntry id="hq" name="HQ"/>
            <categoryEntry id="tr" name="Transport"/>
          </categoryEntries>
          <forceEntries>
            <forceEntry id="det" name="Detachment">
              <categoryLinks>
                <categoryLink id="det-hq" name="HQ" targetId="hq" primary="false"/>
                <categoryLink id="det-tr" name="Transport" targetId="tr" primary="false"/>
              </categoryLinks>
            </forceEntry>
          </forceEntries>`,
      };
      await openList(world(units, data), units, data);

      expect(offered(await openAddSheet(button))).toEqual(names);
    });

    it('counts the number on a selection against a parent limit, not its rows', async () => {
      const units =
        unit(
          'term',
          'Terminators',
          100,
          `<constraints>
            <constraint id="term-max" type="max" field="selections" scope="parent" value="2"/>
          </constraints>`,
        ) + ASSAULT;
      const w = world(units);
      w.add('Terminators', 2);
      await openList(w, units);

      expect(offered(await openAddSheet('Add unit'))).toEqual(['Assault Squad']);
    });

    it('swiping a unit right puts a copy straight after it', async () => {
      const w = world(UNITS);
      const tac = w.add('Tactical Squad');
      w.add('Assault Squad');
      await openList(w);

      const [row] = document.querySelectorAll<HTMLElement>('.unit-row');
      drag(row, [[SWIPE, 0]]);

      await waitFor(async () => {
        const [saved] = await db.rosters();
        expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['tac', 'tac', 'assault']);
      });
      const [saved] = await db.rosters();
      expect(saved?.forces[0]?.selections[0]?.uid).toBe(tac);
      expect(saved?.forces[0]?.selections[1]?.uid).not.toBe(tac);
    });

    it('drops an entry from the open sheet when a swipe takes the last one', async () => {
      const units =
        entry(
          'relic',
          'Relic',
          10,
          `<constraints>
            <constraint id="relic-max" type="max" field="selections" scope="force" value="1"/>
          </constraints>`,
        ) + ASSAULT;
      const w = world(units);
      await openList(w, units);
      const sheet = await openAddSheet('Add unit');
      expect(offered(sheet)).toEqual(['Relic', 'Assault Squad']);

      const relic = within(sheet).getByRole('button', { name: /Relic/ });
      drag(relic, [[SWIPE, 0]]);

      await waitFor(() => expect(offered(sheet)).toEqual(['Assault Squad']));
      const [saved] = await db.rosters();
      expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['relic']);
    });

    it('opens a list already past an entry max with every copy and its issue, and offers no more', async () => {
      const units =
        unit(
          'term',
          'Terminators',
          100,
          `<constraints>
            <constraint id="term-max" type="max" field="selections" scope="force" value="1"/>
          </constraints>`,
        ) + ASSAULT;
      const w = world(units);
      w.add('Terminators');
      w.add('Terminators');
      await openList(w, units);

      expect(unitRows()).toEqual([
        ['Terminators', '100'],
        ['Terminators', '100'],
      ]);
      expect(sumPoints()).toBe('200pts');
      expect(chip()?.textContent).toBe('1 issue');
      const [saved] = await db.rosters();
      expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['term', 'term']);

      expect(offered(await openAddSheet('Add unit'))).toEqual(['Assault Squad']);
    });
  });
});
