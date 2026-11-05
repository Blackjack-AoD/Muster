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

const savedUnit = async () => (await db.rosters())[0]?.forces[0]?.selections[0];

/** The model rows of the saved unit, as count and name. */
const savedModels = async () => (await savedUnit())?.children.map((c: Sel) => [c.number, c.name]);

/** Types a name into the open name sheet and closes it. */
function nameAs(name: string) {
  fireEvent.input(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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
    await waitFor(async () => expect((await savedUnit())?.name).toBe('Squad Thrax'));
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

    await waitFor(async () => expect(await savedUnit()).not.toHaveProperty('name'));
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

  it('naming one model of a group of 5 splits it off as a named row of 1', async () => {
    await openSquad([5]);

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    nameAs('Brother Kael');

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [4, undefined],
        [1, 'Brother Kael'],
      ]),
    );
    expect(rows()).toEqual(['4× Marine', '1× Brother Kael']);
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
    await openSquad([1, 3, 1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'More Marine' }));

    await waitFor(async () =>
      expect(await savedModels()).toEqual([
        [1, 'Brother Kael'],
        [4, undefined],
        [1, undefined],
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

  it('offers renaming in a list, and none in a read-only preview', () => {
    const w = world(SQUAD);
    const tac = w.add('Tactical Squad');
    w.pick(tac, 'Marine', 2);
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

const saveButton = () => screen.queryByRole('button', { name: 'Save as saved unit' });

/** Opens a squad holding Marine rows of these counts, as a copy of the saved unit Squad Thrax. */
async function openLinked(counts: number[] = [], named: Record<number, string> = {}) {
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
    name: 'Squad Thrax',
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
  root.name = 'Squad Thrax';
  openHash(`#/r/r/u/${tac}`);
  await renderScreen(<App />, { files: worldFiles(SQUAD), rosters: [w.roster] });
  await screen.findByRole('heading', { name: 'Squad Thrax' });
}

describe('UnitEditor saved units', () => {
  afterEach(async () => {
    for (const { id } of await db.savedUnits()) await db.delSavedUnit(id);
  });

  it('Save as saved unit, with a name, adds a saved unit and links the unit', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Save as saved unit' }));
    nameAndSave('Squad Thrax');

    await waitFor(async () =>
      expect((await db.savedUnits()).map((u) => [u.name, u.key])).toEqual([['Squad Thrax', 'tac']]),
    );
    const [saved] = await db.savedUnits();
    await waitFor(async () => expect((await savedUnit())?.saved).toBe(saved?.id));
    expect((await savedUnit())?.name).toBe('Squad Thrax');
    await waitFor(() => expect(title()).toBe('Squad Thrax'));
    expect(banner()).toBe('Changes here apply to every list that holds this saved unit.');
    expect(saveButton()).toBeNull();
  });

  it("the save sheet's name starts with the data name of an unnamed unit", async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Save as saved unit' }));

    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Tactical Squad');
  });

  it("the save sheet's name starts with the custom name of a named unit", async () => {
    const w = world(UNITS, { costLimit: 2000 });
    const tac = w.add('Tactical Squad');
    const root = w.roster.forces[0]?.selections[0];
    if (root) root.name = 'Squad Thrax';
    openHash(`#/r/r/u/${tac}`);
    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [w.roster] });
    await screen.findByRole('heading', { name: 'Squad Thrax' });

    fireEvent.click(screen.getByRole('button', { name: 'Save as saved unit' }));

    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Squad Thrax');
  });

  it('saving with an empty name names the saved unit and the unit after the data', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Save as saved unit' }));
    nameAndSave('  ');

    await waitFor(async () => expect((await db.savedUnits()).map((u) => u.name)).toEqual(['Tactical Squad']));
    await waitFor(async () => expect((await savedUnit())?.name).toBe('Tactical Squad'));
  });

  it('closing the save sheet saves nothing and leaves the unit unlinked', async () => {
    await openUnit();

    fireEvent.click(screen.getByRole('button', { name: 'Save as saved unit' }));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Squad Thrax' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(await db.savedUnits()).toEqual([]);
    expect(await savedUnit()).not.toHaveProperty('saved');
    expect(banner()).toBeUndefined();
    expect(saveButton()).not.toBeNull();
  });

  it('storage refusing the save tells the player and leaves the unit unlinked', async () => {
    await openUnit();
    const put = refuse('put');
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Save as saved unit' }));
      nameAndSave('Squad Thrax');

      await expectToast("Couldn't save this unit: Storage is full");
    } finally {
      put.mockRestore();
    }
    expect(await db.savedUnits()).toEqual([]);
    expect(await savedUnit()).not.toHaveProperty('saved');
    expect(title()).toBe('Tactical Squad');
    expect(banner()).toBeUndefined();
  });

  it('a linked copy shows the banner and no Save as saved unit', async () => {
    await openLinked();

    expect(banner()).toBe('Changes here apply to every list that holds this saved unit.');
    expect(saveButton()).toBeNull();
  });

  it('a unit with no link shows no banner, and offers Save as saved unit', async () => {
    await openUnit();

    expect(banner()).toBeUndefined();
    expect(saveButton()).not.toBeNull();
  });

  it('offers Save as saved unit in a list, and none in a read-only preview', () => {
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

  it('Clear on a linked copy names it and its saved unit after the data', async () => {
    await openLinked();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(async () => expect((await savedUnit())?.name).toBe('Tactical Squad'));
    await waitFor(async () => expect((await db.savedUnits()).map((u) => u.name)).toEqual(['Tactical Squad']));
    expect(title()).toBe('Tactical Squad');
  });

  it('emptying the name of a linked copy names it and its saved unit after the data', async () => {
    await openLinked();

    fireEvent.click(screen.getByRole('button', { name: 'Rename unit' }));
    nameAs('');

    await waitFor(async () => expect((await savedUnit())?.name).toBe('Tactical Squad'));
    await waitFor(async () => expect((await db.savedUnits()).map((u) => u.name)).toEqual(['Tactical Squad']));
  });

  it('Clear on a model of a linked copy takes its name off', async () => {
    await openLinked([1], { 0: 'Brother Kael' });

    fireEvent.click(screen.getByRole('button', { name: 'Rename model' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(async () => expect(await savedModels()).toEqual([[1, undefined]]));
  });
});

/** Types a name into the open save sheet and presses Save. */
function nameAndSave(name: string) {
  fireEvent.input(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}
