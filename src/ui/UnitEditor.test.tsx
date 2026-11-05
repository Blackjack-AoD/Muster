// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { children, entry, unit, world } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';

const FIST = entry(
  'fist',
  'Power Fist',
  15,
  `<constraints>
    <constraint id="fist-max" type="max" field="selections" scope="parent" value="1"/>
  </constraints>`,
);
const GRENADE = entry('grenade', 'Frag Grenade', 5);
const SPECIAL = `<selectionEntryGroups>
  <selectionEntryGroup id="special" name="Special Weapon">
    <constraints>
      <constraint id="special-max" type="max" field="selections" scope="parent" value="1"/>
    </constraints>
    ${children(entry('flamer', 'Flamer', 10), entry('melta', 'Melta Gun', 25))}
  </selectionEntryGroup>
</selectionEntryGroups>`;
const UNITS = unit('tac', 'Tactical Squad', 100, children(FIST, GRENADE) + SPECIAL);

const voxUnit = (constraints: string) =>
  unit(
    'tac',
    'Tactical Squad',
    100,
    children(entry('vox', 'Vox Caster', 10, `<constraints>${constraints}</constraints>`)),
  );
const VOX_OPTIONAL = voxUnit('<constraint id="vox-max" type="max" field="selections" scope="parent" value="1"/>');
const VOX_REQUIRED = voxUnit(`
  <constraint id="vox-min" type="min" field="selections" scope="parent" value="1"/>
  <constraint id="vox-max" type="max" field="selections" scope="parent" value="1"/>`);

const sergeant = (gear = '') =>
  entry(
    'sgt',
    'Sergeant',
    20,
    `<constraints>
      <constraint id="sgt-min" type="min" field="selections" scope="parent" value="1"/>
      <constraint id="sgt-max" type="max" field="selections" scope="parent" value="1"/>
    </constraints>${gear}`,
  );
const SWORD = entry(
  'sword',
  'Sword',
  5,
  `<constraints>
    <constraint id="sword-min" type="min" field="selections" scope="parent" value="1"/>
    <constraint id="sword-max" type="max" field="selections" scope="parent" value="1"/>
  </constraints>`,
);
const ASSAULT = unit('assault', 'Assault Squad', 80);

const openHash = (hash: string) => history.replaceState(null, '', hash);

const topPoints = () => document.querySelector('.topbar .pts')?.textContent;

const inlineIssues = () => [...document.querySelectorAll('.issues.inline li')].map((li) => li.textContent);

/** The class and text of each message on the unit's page. */
const inlineLevels = () =>
  [...document.querySelectorAll('.issues.inline li')].map((li) => [li.className, li.textContent]);

const option = (role: 'checkbox' | 'radio', name: RegExp) => screen.getByRole(role, { name });

/** Opens the page of a list's only unit. A list can be built on `builtOn`, data older than what's on the phone. */
async function openUnit(units = UNITS, builtOn = units) {
  const w = world(builtOn, { costLimit: 2000 });
  await openPage(w, w.add('Tactical Squad'), units);
}

/** Opens the page of one unit in a list, on `units` as the data on the phone. */
async function openPage(w: ReturnType<typeof world>, sel: string, units: string) {
  openHash(`#/r/r/u/${sel}`);
  await renderScreen(<App />, { files: worldFiles(units), rosters: [w.roster] });
  await screen.findByRole('heading', { name: 'Tactical Squad' });
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  // the app's count of history steps outlives the store reset: each step it counts is one entry at most
  for (let i = 0; i < history.length; i++) dispatchEvent(new PopStateEvent('popstate'));
});

describe('UnitEditor', () => {
  it('ticking a wargear option adds its points and unticking takes them off', async () => {
    await openUnit();
    expect(topPoints()).toBe('100pts');

    fireEvent.click(option('checkbox', /Power Fist/));
    await waitFor(() => expect(topPoints()).toBe('115pts'));
    expect(option('checkbox', /Power Fist/).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(option('checkbox', /Power Fist/));
    await waitFor(() => expect(topPoints()).toBe('100pts'));
    expect(option('checkbox', /Power Fist/).getAttribute('aria-checked')).toBe('false');
  });

  it('each step of a counted option changes the points by its cost', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'More Frag Grenade' }));
    await waitFor(() => expect(topPoints()).toBe('105pts'));
    fireEvent.click(screen.getByRole('button', { name: 'More Frag Grenade' }));
    await waitFor(() => expect(topPoints()).toBe('110pts'));
    fireEvent.click(screen.getByRole('button', { name: 'Fewer Frag Grenade' }));

    await waitFor(() => expect(topPoints()).toBe('105pts'));
  });

  it("choosing another option in a pick-one group swaps its cost for the last one's", async () => {
    await openUnit();

    fireEvent.click(option('radio', /Flamer/));
    await waitFor(() => expect(topPoints()).toBe('110pts'));
    fireEvent.click(option('radio', /Melta Gun/));

    await waitFor(() => expect(topPoints()).toBe('125pts'));
    expect(option('radio', /Flamer/).getAttribute('aria-checked')).toBe('false');
    expect(option('radio', /Melta Gun/).getAttribute('aria-checked')).toBe('true');
  });

  it('taking another option in a full group drops the cheapest one taken', async () => {
    const only = (id: string, name: string, pts: number) =>
      entry(
        id,
        name,
        pts,
        `<constraints><constraint id="${id}-max" type="max" field="selections" scope="parent" value="1"/></constraints>`,
      );
    const group = `<selectionEntryGroups>
      <selectionEntryGroup id="relics" name="Relics">
        <constraints>
          <constraint id="relics-max" type="max" field="selections" scope="parent" value="2"/>
        </constraints>
        ${children(only('cloak', 'Cloak', 5), only('banner', 'Banner', 10), only('blade', 'Blade', 20))}
      </selectionEntryGroup>
    </selectionEntryGroups>`;
    await openUnit(unit('tac', 'Tactical Squad', 100, group));

    fireEvent.click(option('checkbox', /Cloak/));
    await waitFor(() => expect(topPoints()).toBe('105pts'));
    fireEvent.click(option('checkbox', /Banner/));
    await waitFor(() => expect(topPoints()).toBe('115pts'));
    fireEvent.click(option('checkbox', /Blade/));

    await waitFor(() => expect(topPoints()).toBe('130pts'));
    expect(option('checkbox', /Cloak/).getAttribute('aria-checked')).toBe('false');
  });

  it('Duplicate puts a copy of the unit straight after it', async () => {
    const w = world(UNITS + ASSAULT, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    w.add('Assault Squad');
    await openPage(w, tac, UNITS + ASSAULT);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(async () => {
      const [saved] = await db.rosters();
      expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['tac', 'tac', 'assault']);
    });
  });

  it("a wargear choice reaches the list's row and total, and is saved", async () => {
    await openUnit();

    fireEvent.click(option('checkbox', /Power Fist/));
    await waitFor(() => expect(topPoints()).toBe('115pts'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(document.querySelector('.sum-bar .pts')?.textContent).toBe('115/2,000pts'));
    expect(document.querySelector('.ur-pts')?.textContent).toBe('115');
    const [saved] = await db.rosters();
    expect(saved?.forces[0]?.selections[0]?.children.map((c) => c.key)).toEqual(['fist']);
  });

  it("shows a missing required option on the unit's page until it's chosen", async () => {
    await openUnit(VOX_REQUIRED, VOX_OPTIONAL);
    expect(inlineIssues()).toEqual(['Vox Caster: needs at least 1 (has 0)']);

    fireEvent.click(option('checkbox', /Vox Caster/));

    await waitFor(() => expect(topPoints()).toBe('110pts'));
    expect(inlineIssues()).toEqual([]);
  });

  it('shows wargear gone from the data as a warning on its unit', async () => {
    await openUnit(unit('tac', 'Tactical Squad', 100), unit('tac', 'Tactical Squad', 100, children(sergeant())));

    expect(inlineLevels()).toEqual([
      ['warn', 'Tactical Squad: 1 item(s) no longer exist in the data and were skipped'],
    ]);
  });

  it('shows a warning on a selection under the unit', async () => {
    await openUnit(
      unit('tac', 'Tactical Squad', 100, children(sergeant())),
      unit('tac', 'Tactical Squad', 100, children(sergeant(children(SWORD)))),
    );

    expect(inlineLevels()).toEqual([['warn', 'Sergeant: 1 item(s) no longer exist in the data and were skipped']]);
  });

  it('shows a unit that the choices rule out as a warning', async () => {
    const units =
      unit(
        'tac',
        'Tactical Squad',
        100,
        `<modifiers>
          <modifier type="set" field="hidden" value="true">
            <conditions>
              <condition type="atLeast" value="1" field="selections" scope="force" childId="assault"/>
            </conditions>
          </modifier>
        </modifiers>`,
      ) + ASSAULT;
    const w = world(units);
    const sel = w.add('Tactical Squad');
    w.add('Assault Squad');

    await openPage(w, sel, units);

    expect(inlineLevels()).toEqual([['warn', 'Tactical Squad is not available with the current choices']]);
  });

  it('shows an error and a warning on one unit, each as what it is', async () => {
    const lostSergeant = unit(
      'tac',
      'Tactical Squad',
      100,
      children(
        sergeant(),
        entry(
          'vox',
          'Vox Caster',
          10,
          `<constraints>
            <constraint id="vox-max" type="max" field="selections" scope="parent" value="1"/>
          </constraints>`,
        ),
      ),
    );

    await openUnit(VOX_REQUIRED, lostSergeant);

    expect(inlineLevels()).toEqual([
      ['error', 'Vox Caster: needs at least 1 (has 0)'],
      ['warn', 'Tactical Squad: 1 item(s) no longer exist in the data and were skipped'],
    ]);
  });

  it("keeps a unit's warning, and one for the whole list, off another unit's page", async () => {
    const live = unit('tac', 'Tactical Squad', 100) + ASSAULT;
    const w = world(
      unit('tac', 'Tactical Squad', 100, children(sergeant())) + ASSAULT + unit('gone', 'Gone Squad', 50),
    );
    const sel = w.add('Tactical Squad');
    w.add('Assault Squad');
    w.add('Gone Squad');
    await openPage(w, sel, live);
    expect(inlineIssues()).toEqual(['Tactical Squad: 1 item(s) no longer exist in the data and were skipped']);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByRole('link', { name: /Assault Squad/ }));

    await screen.findByRole('heading', { name: 'Assault Squad' });
    expect(inlineIssues()).toEqual([]);
  });
});
