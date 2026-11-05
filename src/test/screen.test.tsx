// @vitest-environment jsdom
import { screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { db } from '../data/db';
import { Evaluator } from '../data/engine';
import { contextsFor } from '../data/library';
import { getState } from '../store';
import { Lists } from '../ui/Lists';
import { unit, world } from './fixture';
import { renderScreen, worldFiles } from './screen';

const UNITS = unit('tac', 'Tactical Squad', 100);

describe('renderScreen', () => {
  it('renders a Preact component in a file that opts in to jsdom', async () => {
    await renderScreen(<p>Muster on a test page</p>, { files: worldFiles(UNITS) });
    expect(screen.queryByText('Muster on a test page')?.tagName).toBe('P');
  });

  it('saves a seeded list to the real store and IndexedDB', async () => {
    const { roster } = world(UNITS);
    await renderScreen(<Lists />, { rosters: [roster], files: worldFiles(UNITS) });
    expect(getState().rosters.map((r) => r.uid)).toEqual(['r']);
    expect((await db.rosters()).map((r) => r.name)).toEqual(['Test list']);
  });

  it('seeds data files that the real library loads and prices', async () => {
    const w = world(UNITS);
    const tactical = w.add('Tactical Squad');
    await renderScreen(<Lists />, { rosters: [w.roster], files: worldFiles(UNITS) });
    expect(getState().repos.map((r) => r.repo)).toEqual([w.roster.repo]);
    const contexts = await contextsFor(w.roster, getState().repos);
    expect(new Evaluator(w.roster, contexts).find(tactical)?.total).toBe(100);
  });

  it('seeds the same gst and cat options as world', async () => {
    const options = {
      gst: '<forceEntries><forceEntry id="patrol" name="Patrol"/></forceEntries>',
      cat: `<entryLinks><entryLink id="link" name="Scout Squad" targetId="scouts" type="selectionEntry"/></entryLinks>
        <sharedSelectionEntries>${unit('scouts', 'Scout Squad', 60)}</sharedSelectionEntries>`,
    };
    const w = world('', options);
    const scouts = w.add('Scout Squad');
    await renderScreen(<Lists />, { rosters: [w.roster], files: worldFiles('', options) });
    expect(getState().repos.map((r) => r.repo)).toEqual([w.roster.repo]);
    const contexts = await contextsFor(w.roster, getState().repos);
    expect(
      contexts
        .get('cat')
        ?.forceEntries()
        .map((f) => f.name),
    ).toEqual(['Patrol']);
    expect(new Evaluator(w.roster, contexts).find(scouts)?.total).toBe(60);
  });

  it('shows a seeded list on the Lists screen', async () => {
    const { roster } = world(UNITS, { costLimit: 2000 });
    await renderScreen(<Lists />, { rosters: [roster], files: worldFiles(UNITS) });
    const card = screen.queryByRole('link', { name: /Test list/ });
    expect(card?.getAttribute('href')).toBe('#/r/r');
    expect(card?.textContent).toContain('Test Army');
    expect(card?.textContent).toContain('Test Game');
    expect(card?.textContent).toContain('2,000');
  });
});
