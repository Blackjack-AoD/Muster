// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../app';
import type { Roster } from '../data/engine';
import { setUpForce } from '../data/setup';
import { dismissToast, getState } from '../store';
import { catalogueXml, children, cons, entry, unit, world } from '../test/fixture';
import { openHash, press, renderScreen, resetStore, stubBrowserGaps, worldFiles } from '../test/screen';

const CATS =
  '<categoryLinks><categoryLink id="cl-set" targetId="set"/><categoryLink id="cl-tr" targetId="tr"/></categoryLinks>';
const GST = `<categoryEntries><categoryEntry id="set" name="Set-up"/><categoryEntry id="tr" name="Troops"/></categoryEntries>
  <forceEntries>
    <forceEntry id="det" name="Detachment">${CATS}</forceEntry>
    <forceEntry id="ally" name="Allies">${CATS}</forceEntry>
  </forceEntries>`;
const inCat = (cat: string) =>
  `<categoryLinks><categoryLink id="in-${cat}" targetId="${cat}" primary="true"/></categoryLinks>`;
const ALLEGIANCE = entry(
  'al',
  'Allegiance',
  0,
  `${inCat('set')}<constraints><constraint id="al-min" type="min" value="1" field="selections" scope="force"/></constraints>
  <selectionEntryGroups>
    <selectionEntryGroup id="side" name="Side">
      ${cons('<constraint id="side-max" type="max" value="1" field="selections" scope="parent"/>')}
      ${children(entry('loy', 'Loyalist'), entry('tra', 'Traitor'))}
    </selectionEntryGroup>
  </selectionEntryGroups>`,
);
const TAC = unit('tac', 'Tactical Squad', 100, inCat('tr'));
const HERO = unit('hero', 'Hero', 50, inCat('tr'));
const UNITS = ALLEGIANCE + TAC + HERO;
const FILES = {
  ...worldFiles(UNITS, { gst: GST }),
  'other.cat': catalogueXml(`<selectionEntries>${ALLEGIANCE + TAC}</selectionEntries>`, 'other').replace(
    'name="Test Army"',
    'name="Other Army"',
  ),
};

beforeEach(stubBrowserGaps);
afterEach(async () => {
  vi.unstubAllGlobals();
  dismissToast();
  await resetStore();
});

/** A list with the Detachment on `first`'s side, and an Allies detachment on `second`'s holding a Tactical Squad and a Hero. */
function twoDetachments(first = 'Ultramarines', second = 'Ultramarines'): Roster {
  const w = world(UNITS, { gst: GST });
  w.addForce('f2', 'ally');
  setUpForce(w.roster, w.contexts, 'f1', first);
  setUpForce(w.roster, w.contexts, 'f2', second);
  w.add('Tactical Squad', 1, 'f2');
  w.add('Hero', 1, 'f2');
  return w.roster;
}

async function open(roster: Roster) {
  openHash(`#/r/${roster.uid}`);
  await renderScreen(<App />, { files: FILES, rosters: [roster] });
}

const allies = () => getState().rosters[0]?.forces[1];
const unitKeys = () =>
  allies()
    ?.selections.map((s) => s.key)
    .filter((k) => k !== 'al');

it("opens a detachment's army and type from its name, and changes the type", async () => {
  await open(twoDetachments());

  await press('Change Allies');
  await screen.findByText('Change detachment');
  await press('Detachment');

  await waitFor(() => expect(allies()?.forceEntryId).toBe('det'));
  expect(unitKeys()).toEqual(['tac', 'hero']);
});

it('moves a detachment to another army, keeping the units that army has, after asking', async () => {
  const ask = vi.fn(() => true);
  vi.stubGlobal('confirm', ask);
  await open(twoDetachments());

  await press('Change Allies');
  fireEvent.click(await screen.findByText('Tap to change'));
  await press('Other Army');
  await press('Allies');

  expect(ask).toHaveBeenCalledWith("Move Allies to Other Army? 1 unit it doesn't have will be taken out.");
  await waitFor(() => expect(allies()?.catalogueId).toBe('other'));
  expect(unitKeys()).toEqual(['tac']);
});

it('leaves the detachment as it was when the player says no', async () => {
  vi.stubGlobal('confirm', () => false);
  await open(twoDetachments());

  await press('Change Allies');
  fireEvent.click(await screen.findByText('Tap to change'));
  await press('Other Army');
  await press('Allies');

  expect(allies()?.catalogueId).toBe('cat');
  expect(unitKeys()).toEqual(['tac', 'hero']);
});

it("locks a later detachment's allegiance to the first detachment's, and follows it", async () => {
  await open(twoDetachments());
  const traitors = await screen.findAllByRole('radio', { name: 'Traitor' });
  expect(traitors.map((b) => b.hasAttribute('disabled'))).toEqual([false, true]);

  fireEvent.click(traitors[0]);

  await waitFor(() =>
    expect(screen.getAllByRole('radio', { name: 'Traitor' }).map((b) => b.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
    ]),
  );
});

it("starts a new detachment on the first detachment's side", async () => {
  const roster = twoDetachments('Night Lords', 'Night Lords');
  roster.forces.pop();
  await open(roster);

  await press('Add detachment');
  await press('Allies');

  await waitFor(() => expect(getState().rosters[0]?.forces).toHaveLength(2));
  const traitors = screen.getAllByRole('radio', { name: 'Traitor' });
  expect(traitors.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true']);
});
