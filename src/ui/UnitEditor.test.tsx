// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import type { Sel } from '../data/engine';
import { ASSAULT, RULED_OUT_BY_ASSAULT, SWORD, children, cons, entry, sergeant, unit, world } from '../test/fixture';
import { expectToast, openHash, refuse, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';
import { UnitEditor } from './UnitEditor';

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
  unit('tac', 'Tactical Squad', 100, children(entry('vox', 'Vox Caster', 10, cons(constraints))));
const VOX_OPTIONAL = voxUnit('<constraint id="vox-max" type="max" field="selections" scope="parent" value="1"/>');
const VOX_REQUIRED = voxUnit(`
  <constraint id="vox-min" type="min" field="selections" scope="parent" value="1"/>
  <constraint id="vox-max" type="max" field="selections" scope="parent" value="1"/>`);

const topPoints = () => document.querySelector('.topbar .pts')?.textContent;

const inlineIssues = () => [...document.querySelectorAll('.issues.inline li')].map((li) => li.textContent);

/** The class and text of each message on the unit's page. */
const inlineLevels = () =>
  [...document.querySelectorAll('.issues.inline li')].map((li) => [li.className, li.textContent]);

const option = (role: 'checkbox' | 'radio', name: RegExp) => screen.getByRole(role, { name });

/** The box of a section, by the name it shows. */
const section = (name: string) => screen.getByRole('button', { name: new RegExp('^' + name) });

/** Opens a section's sheet from its box. */
const openSection = (name: string) => fireEvent.click(section(name));

const sectionSheet = (name: string) => screen.queryByRole('dialog', { name });

/** Opens the page of a list's only unit. `builtOn` builds the list on data older than what's on the phone. */
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

/** A squad whose models each have wargear, so each model or group has its own row. */
const MARINE = entry('marine', 'Marine', 10, children(GRENADE), 'type="model"');
const SQUAD = unit('tac', 'Tactical Squad', 100, children(MARINE));

const title = () => document.querySelector('.topbar h1')?.textContent;

/** The label of each model or group row, such as "4× Marine". */
const rows = () => [...document.querySelectorAll('.sub-head > span:not(.o-pts)')].map((s) => s.textContent);

const storedUnit = async () => (await db.rosters())[0]?.forces[0]?.selections[0];

/** The model rows of the stored unit, as count and name. */
const savedModels = async () => (await storedUnit())?.children.map((c: Sel) => [c.number, c.name]);

/** Types a name into the open name sheet and presses its tick. */
function nameAs(name: string) {
  fireEvent.input(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
}

/** Opens a squad holding Marine rows of these counts, where `named` gives the name of each row by its index. */
async function openSquad(counts: number[], named: Record<number, string> = {}) {
  const w = world(SQUAD, { costLimit: 2000 });
  const tac = w.add('Tactical Squad');
  for (const n of counts) w.pick(tac, 'Marine', n);
  w.roster.forces[0]?.selections[0]?.children.forEach((c, i) => {
    if (named[i]) c.name = named[i];
  });
  await openPage(w, tac, SQUAD);
  return tac;
}

beforeEach(stubBrowserGaps);

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

    openSection('Special Weapon');
    fireEvent.click(option('radio', /Flamer/));
    await waitFor(() => expect(topPoints()).toBe('110pts'));
    openSection('Special Weapon');
    fireEvent.click(option('radio', /Melta Gun/));

    await waitFor(() => expect(topPoints()).toBe('125pts'));
    openSection('Special Weapon');
    expect(option('radio', /Flamer/).getAttribute('aria-checked')).toBe('false');
    expect(option('radio', /Melta Gun/).getAttribute('aria-checked')).toBe('true');
  });

  it('a pick-one group holding a group of its own offers each of its options as one choice', async () => {
    const one = (id: string, type: 'min' | 'max') =>
      `<constraint id="${id}-${type}" type="${type}" field="selections" scope="parent" value="1"/>`;
    const guns = unit(
      'tac',
      'Tactical Squad',
      100,
      `<selectionEntryGroups>
        <selectionEntryGroup id="gun" name="Bolter" defaultSelectionEntryId="bolter">
          ${cons(one('gun', 'min'), one('gun', 'max'))}
          <selectionEntryGroups>
            <selectionEntryGroup id="special" name="Special Weapon">
              ${cons(one('special', 'max'))}
              ${children(entry('melta', 'Melta Gun', 15))}
            </selectionEntryGroup>
          </selectionEntryGroups>
          ${children(entry('bolter', 'Bolter', 0), entry('shrapnel', 'Shrapnel Bolter', 2))}
        </selectionEntryGroup>
      </selectionEntryGroups>`,
    );
    await openUnit(guns);
    openSection('Bolter');
    expect(screen.queryByRole('button', { name: 'More Bolter' })).toBeNull();
    expect(option('radio', /^Bolter/).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(option('radio', /Melta Gun/));
    await waitFor(() => expect(topPoints()).toBe('115pts'));
    openSection('Bolter');
    expect(option('radio', /^Bolter/).getAttribute('aria-checked')).toBe('false');

    fireEvent.click(option('radio', /Shrapnel Bolter/));
    await waitFor(() => expect(topPoints()).toBe('102pts'));
    openSection('Bolter');
    expect(option('radio', /Melta Gun/).getAttribute('aria-checked')).toBe('false');
    expect((await storedUnit())?.children.map((c) => c.key)).toEqual([expect.stringMatching(/shrapnel$/)]);
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

    openSection('Relics');
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
    const fist = w.pick(tac, 'Power Fist');
    w.add('Assault Squad');
    await openPage(w, tac, UNITS + ASSAULT);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(async () => {
      const [saved] = await db.rosters();
      expect(saved?.forces[0]?.selections.map((s) => s.key)).toEqual(['tac', 'tac', 'assault']);
    });
    const [saved] = await db.rosters();
    const [original, copy] = saved?.forces[0]?.selections ?? [];
    expect(original?.uid).toBe(tac);
    expect(original?.children.map((c) => c.uid)).toEqual([fist]);
    expect(copy?.children.map((c) => c.key)).toEqual(original?.children.map((c) => c.key));
    expect(copy?.uid).not.toBe(tac);
    expect(copy?.children.map((c) => c.uid)).not.toContain(fist);
    expect(location.hash).toBe('#/r/r');
  });

  it('Split 1 parts one model from a group, with its own uid', async () => {
    const model = entry('marine', 'Marine', 10, children(GRENADE));
    const units = unit('tac', 'Tactical Squad', 100, children(model));
    const w = world(units, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    const group = w.pick(tac, 'Marine', 3);
    await openPage(w, tac, units);

    fireEvent.click(screen.getByRole('button', { name: 'Split 1' }));

    await waitFor(async () => {
      const [saved] = await db.rosters();
      expect(saved?.forces[0]?.selections[0]?.children.map((c) => c.number)).toEqual([2, 1]);
    });
    const [saved] = await db.rosters();
    const [rest, split] = saved?.forces[0]?.selections[0]?.children ?? [];
    expect(rest?.uid).toBe(group);
    expect(split?.uid).not.toBe(group);
  });

  it("a wargear choice reaches the list's row and total, and storage has it", async () => {
    await openUnit();

    fireEvent.click(option('checkbox', /Power Fist/));
    await waitFor(() => expect(topPoints()).toBe('115pts'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(document.querySelector('.sum-bar .pts')?.textContent).toBe('115/2,000pts'));
    expect(document.querySelector('.ur-pts')?.textContent).toBe('115');
    const [saved] = await db.rosters();
    expect(saved?.forces[0]?.selections[0]?.children.map((c) => c.key)).toEqual(['fist']);
  });

  it("shows a missing required option on the unit's page until the player chooses it", async () => {
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
    const units = RULED_OUT_BY_ASSAULT + ASSAULT;
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

  it('renaming the unit shows the name as its title and stores it on the unit', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('Squad Thrax');

    await waitFor(() => expect(title()).toBe('Squad Thrax'));
    await waitFor(async () => expect((await storedUnit())?.name).toBe('Squad Thrax'));
  });

  it('Clear takes the name off the unit, and the title shows the data name again', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    const root = w.roster.forces[0]?.selections[0];
    if (root) root.name = 'Squad Thrax';
    openHash(`#/r/r/u/${tac}`);
    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [w.roster] });
    await screen.findByRole('heading', { name: /Squad Thrax|Tactical Squad/ });

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(async () => expect(await storedUnit()).not.toHaveProperty('name'));
    expect(title()).toBe('Tactical Squad');
  });

  it('closing the name sheet untouched keeps the name it opened with', async () => {
    await openSquad([1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Brother Kael');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(rows()).toEqual(['Brother Kael']);
    expect(await savedModels()).toEqual([[1, 'Brother Kael']]);
  });

  it('closing the name sheet after typing keeps the old name', async () => {
    await openSquad([1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Brother Vane' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(rows()).toEqual(['Brother Kael']);
    expect(await savedModels()).toEqual([[1, 'Brother Kael']]);
  });

  it('Enter in the name field saves the name, as the tick does', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Squad Thrax' } });
    fireEvent.submit(screen.getByLabelText('Name'));

    await waitFor(async () => expect((await storedUnit())?.name).toBe('Squad Thrax'));
  });

  it('naming one model of a group of 2 splits it off as a named row of 1', async () => {
    await openSquad([5, 2]);

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    nameAs('Brother Kael');

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [5, undefined],
        [1, undefined],
        [1, 'Brother Kael'],
      ]),
    );
    expect(rows()).toEqual(['5× Marine', '1× Marine', '1× Brother Kael']);
  });

  it("offers no rename on the squad's main row of its bulk model, and one on a row split off it", async () => {
    await openSquad([4, 1]);

    expect(screen.getAllByRole('button', { name: 'Rename model' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    nameAs('Brother Kael');

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [4, undefined],
        [1, 'Brother Kael'],
      ]),
    );
  });

  it('Undo split puts a split-off model back in the main row, with its wargear', async () => {
    const w = world(SQUAD, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Marine', 2);
    w.pick(w.pick(tac, 'Marine'), 'Frag Grenade');
    await openPage(w, tac, SQUAD);
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo split' }));

    await waitFor(async () => expect(await savedModels()).toEqual([[3, undefined]]));
    expect((await storedUnit())?.children[0]?.children).toEqual([]);
  });

  it('a named model offers no Merge into its twin', async () => {
    await openSquad([1, 1], { 1: 'Brother Kael' });

    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(rows()).toEqual(['1× Marine', '1× Brother Kael']);
  });

  it('an unnamed model offers no Merge into a named twin', async () => {
    await openSquad([1, 1], { 0: 'Brother Kael' });

    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    expect(rows()).toEqual(['1× Brother Kael', '1× Marine']);
  });

  it('More adds a model to an unnamed row, never to a named one', async () => {
    await openSquad([1, 1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'More Marine' }));

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [1, 'Brother Kael'],
        [2, undefined],
      ]),
    );
  });

  it('More adds a model to the biggest unnamed row', async () => {
    await openSquad([1, 1, 3], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'More Marine' }));

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [1, 'Brother Kael'],
        [1, undefined],
        [4, undefined],
      ]),
    );
  });

  it('More adds a new unnamed row when every row of that model is named', async () => {
    await openSquad([1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'More Marine' }));

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [1, 'Brother Kael'],
        [1, undefined],
      ]),
    );
  });

  it('More in a full group swaps a model in without adding to a named row', async () => {
    const scout = entry('scout', 'Scout', 5, children(GRENADE), 'type="model"');
    const units = unit(
      'tac',
      'Tactical Squad',
      100,
      `<selectionEntryGroups>
        <selectionEntryGroup id="squad" name="Squad">
          <constraints>
            <constraint id="squad-max" type="max" field="selections" scope="parent" value="3"/>
          </constraints>
          ${children(MARINE, scout)}
        </selectionEntryGroup>
      </selectionEntryGroups>`,
    );
    const w = world(units, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Scout', 2);
    w.pick(tac, 'Marine');
    const kael = w.roster.forces[0]?.selections[0]?.children[1];
    if (kael) kael.name = 'Brother Kael';
    await openPage(w, tac, units);

    openSection('Squad');
    fireEvent.click(screen.getByRole('button', { name: 'More Marine' }));

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [1, undefined],
        [1, 'Brother Kael'],
        [1, undefined],
      ]),
    );
  });

  it('Fewer takes a model from the latest row first, named or not', async () => {
    await openSquad([3, 1], { 1: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'Fewer Marine' }));

    await waitFor(async () => expect(await savedModels()).toEqual([[3, undefined]]));
  });

  it('trims the spaces around a name', async () => {
    await openSquad([1, 1]);

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    nameAs('  Brother Kael  ');

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [1, undefined],
        [1, 'Brother Kael'],
      ]),
    );
  });

  it('a name of only spaces takes the name off a unit with no saved unit', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    const root = w.roster.forces[0]?.selections[0];
    if (root) root.name = 'Squad Thrax';
    openHash(`#/r/r/u/${tac}`);
    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [w.roster] });
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('   ');

    await waitFor(async () => expect(await storedUnit()).not.toHaveProperty('name'));
    expect(title()).toBe('Tactical Squad');
  });

  it('offers no rename on a row that is not a model', () => {
    const banner = entry('banner', 'Banner', 5, children(GRENADE));
    const w = world(unit('tac', 'Tactical Squad', 100, children(MARINE, banner)));
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Marine', 2);
    w.pick(tac, 'Marine');
    w.pick(tac, 'Banner');
    render(
      <UnitEditor
        ctl={{ roster: w.roster, contexts: w.contexts, ev: w.ev(), mutate: () => {}, scratch: false }}
        selUid={tac}
        backTo="/"
      />,
    );

    expect(rows()).toEqual(['2× Marine', '1× Marine', 'Banner']);
    expect(screen.queryAllByRole('button', { name: /^Rename/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Rename unit',
      'Rename model',
    ]);
  });

  it('offers renaming in a list, and none in a read-only preview', () => {
    const w = world(SQUAD);
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Marine', 2);
    w.pick(tac, 'Marine');
    const page = (scratch: boolean) =>
      render(
        <UnitEditor
          ctl={{ roster: w.roster, contexts: w.contexts, ev: w.ev(), mutate: () => {}, scratch }}
          selUid={tac}
          backTo="/"
        />,
      );
    const renames = () => screen.queryAllByRole('button', { name: /^Rename/ }).map((b) => b.getAttribute('aria-label'));

    const list = page(false);
    expect(renames()).toEqual(['Rename unit', 'Rename model']);
    list.unmount();

    page(true);
    expect(renames()).toEqual([]);
  });
});

/** The text of the banner on the unit's page, if it shows one. */
const banner = () => document.querySelector('.unit-page .banner')?.textContent;

const saveButton = () => screen.queryByRole('button', { name: 'Save updates' });

const UNIQUE_NOTE = 'Unique unit. Changes here stay in this list until you tap Save updates.';
const PRECONFIGURED_NOTE = 'Preconfigured unit. Changes here stay in this list until you tap Save updates.';
const CHANGED_NOTE =
  "This list has changes that other lists don't. Save updates shares them with every list that holds it.";

/**
 * Opens a squad holding Marine rows of these counts, as a copy of a saved unit: the unique Squad Thrax,
 * or with `preconfigured`, an unnamed preconfigured unit. `copies` puts more copies of it in the list.
 */
async function openLinked(
  counts: number[] = [],
  named: Record<number, string> = {},
  { preconfigured = false, copies = 1 } = {},
) {
  const w = world(SQUAD, { costLimit: 2000 });
  const tac = w.add('Tactical Squad');
  for (const n of counts) w.pick(tac, 'Marine', n);
  const [force] = w.roster.forces;
  const root = force?.selections[0];
  if (!force || !root) throw new Error('the list has no unit');
  root.children.forEach((c, i) => {
    if (named[i]) c.name = named[i];
  });
  await db.putSavedUnit({
    id: 'thrax',
    name: preconfigured ? '' : 'Squad Thrax',
    ...(preconfigured ? { kind: 'preconfigured' as const } : {}),
    repo: w.roster.repo,
    gameSystemId: w.roster.gameSystemId,
    catalogueId: force.catalogueId,
    key: root.key,
    categoryId: '',
    build: structuredClone(root),
    created: 0,
    updated: 0,
  });
  root.saved = 'thrax';
  if (!preconfigured) root.name = 'Squad Thrax';
  for (let i = 1; i < copies; i++) force.selections.push({ ...structuredClone(root), uid: `copy${i}` });
  openHash(`#/r/r/u/${tac}`);
  await renderScreen(<App />, { files: worldFiles(SQUAD), rosters: [w.roster] });
  await screen.findByRole('heading', { name: preconfigured ? 'Tactical Squad' : 'Squad Thrax' });
  return { root, w };
}

describe('UnitEditor sections', () => {
  const one = (id: string, type: 'min' | 'max') =>
    `<constraint id="${id}-${type}" type="${type}" field="selections" scope="parent" value="1"/>`;
  const groupOf = (id: string, name: string, inner: string) =>
    `<selectionEntryGroups><selectionEntryGroup id="${id}" name="${name}">${inner}</selectionEntryGroup></selectionEntryGroups>`;
  const squad = (inner: string) => unit('tac', 'Tactical Squad', 100, inner);
  const FLAMER = entry('flamer', 'Flamer', 10);
  const REQUIRED = squad(groupOf('w', 'Weapon', cons(one('w', 'min'), one('w', 'max')) + children(FLAMER)));
  const OPTIONAL = squad(groupOf('w', 'Weapon', cons(one('w', 'max')) + children(FLAMER)));

  it("keeps a section's options in a sheet until its box is tapped", async () => {
    await openUnit();
    expect(screen.queryByRole('radio', { name: /Flamer/ })).toBeNull();
    expect(section('Special Weapon').textContent).toContain('None');

    openSection('Special Weapon');

    expect(sectionSheet('Special Weapon')).not.toBeNull();
    expect(option('radio', /Flamer/)).not.toBeNull();
  });

  it('Done closes the sheet and keeps what was chosen', async () => {
    await openUnit(squad(groupOf('kit', 'Kit', children(FLAMER))));
    openSection('Kit');
    fireEvent.click(screen.getByRole('button', { name: 'More Flamer' }));
    await waitFor(() => expect(topPoints()).toBe('110pts'));

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(sectionSheet('Kit')).toBeNull());
    expect(section('Kit').textContent).toContain('Flamer');
  });

  it('closes a pick-one sheet on a choice, and the box shows it', async () => {
    await openUnit();
    openSection('Special Weapon');

    fireEvent.click(option('radio', /Melta Gun/));

    await waitFor(() => expect(sectionSheet('Special Weapon')).toBeNull());
    expect(section('Special Weapon').textContent).toContain('Melta Gun');
  });

  it('keeps a pick-one sheet open when the choice has options of its own', async () => {
    const scoped = entry('combi', 'Combi Bolter', 10, children(entry('scope', 'Scope', 5)));
    await openUnit(squad(groupOf('w', 'Weapon', cons(one('w', 'max')) + children(scoped))));
    openSection('Weapon');

    fireEvent.click(option('radio', /Combi Bolter/));

    await waitFor(() => expect(topPoints()).toBe('110pts'));
    expect(sectionSheet('Weapon')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'More Scope' })).not.toBeNull();
  });

  it('keeps a pick-many sheet open, and the box lists each choice with its count', async () => {
    await openUnit(squad(groupOf('kit', 'Kit', children(FLAMER, GRENADE))));
    openSection('Kit');

    fireEvent.click(screen.getByRole('button', { name: 'More Flamer' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Flamer' }));
    fireEvent.click(screen.getByRole('button', { name: 'More Frag Grenade' }));

    await waitFor(() => expect(topPoints()).toBe('125pts'));
    expect(sectionSheet('Kit')).not.toBeNull();
    expect(section('Kit').textContent).toContain('2× Flamer, Frag Grenade');
  });

  it('shows a section under a model as a box too', async () => {
    const trooper = entry('marine', 'Marine', 10, groupOf('g', 'Gear', children(GRENADE)), 'type="model"');
    await openUnit(squad(children(trooper)));
    fireEvent.click(screen.getByRole('button', { name: 'More Marine' }));
    await waitFor(() => expect(section('Gear').textContent).toContain('None'));
  });

  it('marks a section missing a required choice until it has one', async () => {
    await openUnit(REQUIRED, OPTIONAL);
    expect(section('Weapon').classList.contains('missing')).toBe(true);
    expect(section('Weapon').textContent).toContain('Not chosen');

    openSection('Weapon');
    fireEvent.click(option('radio', /Flamer/));

    await waitFor(() => expect(section('Weapon').classList.contains('missing')).toBe(false));
    expect(section('Weapon').textContent).toContain('Flamer');
  });

  it('leaves an optional section with nothing chosen unmarked', async () => {
    await openUnit();
    expect(section('Special Weapon').classList.contains('missing')).toBe(false);
  });

  it('marks a section when a section inside it is missing a choice', async () => {
    const inner = (min: string) => groupOf('w', 'Weapon', cons(min, one('w', 'max')) + children(FLAMER));
    const kit = (min: string) => squad(groupOf('kit', 'Kit', inner(min) + children(GRENADE)));
    await openUnit(kit(one('w', 'min')), kit(''));
    expect(section('Kit').classList.contains('missing')).toBe(true);
  });

  it('marks a section when a choice in it is missing one of its own', async () => {
    const combi = (min: string) =>
      entry('combi', 'Combi Bolter', 10, groupOf('w', 'Ammo', cons(min, one('w', 'max')) + children(FLAMER)));
    const armed = (min: string) => squad(groupOf('kit', 'Kit', cons(one('kit', 'max')) + children(combi(min))));
    const w = world(armed(''), { costLimit: 2000 });
    const sel = w.add('Tactical Squad');
    w.pick(sel, 'Combi Bolter');
    await openPage(w, sel, armed(one('w', 'min')));
    expect(section('Kit').classList.contains('missing')).toBe(true);
  });

  it('stays inline inside a sheet, one sheet deep', async () => {
    await openUnit(squad(groupOf('kit', 'Kit', groupOf('ammo', 'Ammo', children(FLAMER)) + children(GRENADE))));
    openSection('Kit');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'More Flamer' })).not.toBeNull();
  });

  it('leaves an On/Off pair as a switch, with no box', async () => {
    const pair = groupOf(
      'p',
      'Psyker',
      cons(one('p', 'max')) + children(entry('on', 'Psyker On', 0), entry('off', 'Psyker Off', 0)),
    );
    await openUnit(squad(pair));
    expect(screen.getByRole('switch', { name: /Psyker/ })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /^Psyker/ })).toBeNull();
  });
});

describe('UnitEditor saved units', () => {
  afterEach(async () => {
    for (const { id } of await db.savedUnits()) await db.delSavedUnit(id);
  });

  it('Save updates on an unnamed unit saves it as a preconfigured unit and links it', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Save updates' }));

    await waitFor(async () =>
      expect((await db.savedUnits()).map((u) => [u.kind, u.name, u.key])).toEqual([['preconfigured', '', 'tac']]),
    );
    const [saved] = await db.savedUnits();
    await waitFor(async () => expect((await storedUnit())?.saved).toBe(saved?.id));
    expect(await storedUnit()).not.toHaveProperty('name');
    await waitFor(() => expect(banner()).toBe(PRECONFIGURED_NOTE));
    expect(saveButton()).toBeNull();
  });

  it('Save updates on a named unit saves it as a unique unit and links it', async () => {
    const w = world(UNITS, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    const root = w.roster.forces[0]?.selections[0];
    if (root) root.name = 'Squad Thrax';
    openHash(`#/r/r/u/${tac}`);
    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [w.roster] });
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('button', { name: 'Save updates' }));

    await waitFor(async () =>
      expect((await db.savedUnits()).map((u) => [u.kind, u.name])).toEqual([[undefined, 'Squad Thrax']]),
    );
    await waitFor(() => expect(banner()).toBe(UNIQUE_NOTE));
    expect((await storedUnit())?.name).toBe('Squad Thrax');
  });

  it('storage refusing the save tells the player and leaves the unit unlinked', async () => {
    await openUnit();
    const put = refuse('put');
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Save updates' }));

      await expectToast("Couldn't save this unit: Storage is full");
    } finally {
      put.mockRestore();
    }
    expect(await db.savedUnits()).toEqual([]);
    expect(await storedUnit()).not.toHaveProperty('saved');
    expect(banner()).toBeUndefined();
  });

  it('a linked copy that matches its saved unit says so, and offers no Save updates', async () => {
    await openLinked();

    expect(banner()).toBe(UNIQUE_NOTE);
    expect(saveButton()).toBeNull();
  });

  it('an edit to a linked copy stays in this list, and offers Save updates', async () => {
    await openLinked();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('Squad Iron');

    await waitFor(() => expect(banner()).toBe(CHANGED_NOTE));
    expect(saveButton()).not.toBeNull();
    expect((await db.savedUnits()).map((u) => u.name)).toEqual(['Squad Thrax']);
  });

  it('Save updates takes a linked copy’s change to its saved unit', async () => {
    await openLinked();
    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('Squad Iron');
    await waitFor(() => expect(saveButton()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save updates' }));

    await waitFor(async () => expect((await db.savedUnits()).map((u) => u.name)).toEqual(['Squad Iron']));
    await waitFor(() => expect(banner()).toBe(UNIQUE_NOTE));
    expect(saveButton()).toBeNull();
  });

  it('Save updates on a preconfigured copy takes the change to its other copies in this list', async () => {
    const { root } = await openLinked([4, 1], {}, { preconfigured: true, copies: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    nameAs('Brother Kael');
    await waitFor(() => expect(saveButton()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save updates' }));

    await waitFor(async () =>
      expect((await db.rosters())[0]?.forces[0]?.selections.map((s) => [s.uid, s.children.map((c) => c.name)])).toEqual(
        [
          [root.uid, [undefined, 'Brother Kael']],
          ['copy1', [undefined, 'Brother Kael']],
        ],
      ),
    );
    expect((await db.savedUnits()).map((u) => [u.kind, u.name])).toEqual([['preconfigured', '']]);
  });

  it('naming a preconfigured copy and saving makes a new unique unit, and leaves the preconfigured one', async () => {
    await openLinked([], {}, { preconfigured: true });
    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('Squad Thrax');
    await waitFor(() => expect(saveButton()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Save updates' }));

    await waitFor(async () =>
      expect((await db.savedUnits()).map((u) => [u.kind, u.name])).toEqual(
        expect.arrayContaining([
          ['preconfigured', ''],
          [undefined, 'Squad Thrax'],
        ]),
      ),
    );
    const unique = (await db.savedUnits()).find((u) => u.name === 'Squad Thrax');
    await waitFor(async () => expect((await storedUnit())?.saved).toBe(unique?.id));
  });

  it('offers Save updates in a list, and none in a read-only preview', () => {
    const w = world(UNITS);
    const tac = w.add('Tactical Squad');
    const page = (scratch: boolean) =>
      render(
        <UnitEditor
          ctl={{ roster: w.roster, contexts: w.contexts, ev: w.ev(), mutate: () => {}, scratch }}
          selUid={tac}
          backTo="/"
        />,
      );

    const list = page(false);
    expect(saveButton()).not.toBeNull();
    list.unmount();

    page(true);
    expect(saveButton()).toBeNull();
  });

  it('Clear on a unique copy names it after the data, in this list only until Save updates', async () => {
    await openLinked();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(async () => expect((await storedUnit())?.name).toBe('Tactical Squad'));
    expect((await db.savedUnits()).map((u) => u.name)).toEqual(['Squad Thrax']);
    expect(title()).toBe('Tactical Squad');
  });

  it('emptying the name of a unique copy names it after the data', async () => {
    await openLinked();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('');

    await waitFor(async () => expect((await storedUnit())?.name).toBe('Tactical Squad'));
  });

  it('Clear on a model of a linked copy takes its name off', async () => {
    await openLinked([1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(async () => expect(await savedModels()).toEqual([[1, undefined]]));
  });
});
