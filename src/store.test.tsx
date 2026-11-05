// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { db } from './data/db';
import { addSel, forceRootOptions, type Roster } from './data/engine';
import { getState, useRosterCtl } from './store';
import { unit, world } from './test/fixture';
import { renderScreen, worldFiles } from './test/screen';

const FILES = worldFiles(unit('tac', 'Tactical Squad', 100));

function ListEditor({ source, scratch }: { source?: Roster; scratch?: boolean }) {
  const { ctl, error, loading } = useRosterCtl(source, scratch);
  if (loading) return <p>Loading</p>;
  if (!ctl) return <p>{error}</p>;
  const add = () =>
    ctl.mutate((r) => {
      const force = r.forces[0];
      const ctx = ctl.contexts.get(force.catalogueId);
      if (!ctx) throw new Error('no data for this force');
      addSel(r, ctl.contexts, force.uid, null, forceRootOptions(ctx, ctx.forceEntries()[0])[0]);
    });
  return (
    <>
      <p>Points: {ctl.ev.total}</p>
      <button onClick={add}>Add a unit</button>
    </>
  );
}

const newList = () => world(unit('tac', 'Tactical Squad', 100)).roster;
const unitsIn = (r?: Roster) => r?.forces[0].selections.length;
const storedUnits = async () => unitsIn((await db.rosters())[0]);
const unitsInMemory = () => unitsIn(getState().rosters[0]);
const addUnit = async () => fireEvent.click(await screen.findByRole('button', { name: 'Add a unit' }));

describe('useRosterCtl', () => {
  it('shows loading, then the list and its points once its data has loaded', async () => {
    const w = world(unit('tac', 'Tactical Squad', 100));
    w.add('Tactical Squad');
    await renderScreen(<ListEditor source={w.roster} />, { files: FILES, rosters: [w.roster] });
    expect(document.body.textContent).toBe('Loading');
    await screen.findByText('Points: 100');
    expect(screen.queryByText('Loading')).toBeNull();
  });

  it("reports a list that isn't there", async () => {
    await renderScreen(<ListEditor />, { files: FILES });
    expect(document.body.textContent).toBe('List not found');
  });

  it('saves an edit to memory and storage with no toast', async () => {
    const list = newList();
    await renderScreen(<ListEditor source={list} />, { files: FILES, rosters: [list] });
    await addUnit();
    await screen.findByText('Points: 100');
    expect(unitsInMemory()).toBe(1);
    expect(await storedUnits()).toBe(1);
    expect(getState().toast).toBeUndefined();
  });

  it('keeps an edit to a scratch list out of memory and storage', async () => {
    const list = newList();
    await renderScreen(<ListEditor source={list} scratch />, { files: FILES, rosters: [list] });
    await addUnit();
    await screen.findByText('Points: 100');
    expect(unitsInMemory()).toBe(0);
    expect(await storedUnits()).toBe(0);
  });
});
