// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { removeRepo } from '../store';
import { unit, world } from '../test/fixture';
import { openHash, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';
import { Lists } from './Lists';

const UNITS = unit('tac', 'Tactical Squad', 100);

beforeEach(async () => {
  await stubBrowserGaps();
  openHash('#/');
});

describe('Lists', () => {
  it('creating a list saves it and opens it', async () => {
    await renderScreen(<App />, { files: worldFiles(UNITS) });

    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test Army' }));
    const create = await screen.findByRole('button', { name: 'Create list' });
    fireEvent.input(screen.getByLabelText('List name'), { target: { value: 'Strike Force' } });
    fireEvent.input(screen.getByLabelText('Points limit'), { target: { value: '1500' } });
    fireEvent.click(create);

    await waitFor(() => expect(location.hash).toMatch(/^#\/r\/./));
    const [saved] = await db.rosters();
    expect(saved).toMatchObject({
      name: 'Strike Force',
      repo: 'test/repo',
      gameSystemId: 'gst',
      costLimit: 1500,
      forces: [{ forceEntryId: 'det', catalogueId: 'cat', selections: [] }],
    });
    expect(location.hash).toBe(`#/r/${saved?.uid}`);
    await screen.findByRole('heading', { name: 'Strike Force' });
    await waitFor(() => expect(document.querySelector('.pts')?.textContent).toBe('0/1,500pts'));
  });

  it("says the army's data has gone when the player removes its repo under the new list sheet", async () => {
    await renderScreen(<App />, { files: worldFiles(UNITS) });

    fireEvent.click(screen.getByRole('button', { name: 'New list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test Army' }));
    await screen.findByRole('button', { name: 'Create list' });
    await removeRepo('test/repo');

    await waitFor(() => expect(screen.queryByText("This army's data isn't on the phone.")).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Create list' })).toBeNull();
  });

  it("shows each saved list's name and points limit on a card that opens it", async () => {
    const { roster } = world(UNITS);
    await renderScreen(<Lists />, {
      files: worldFiles(UNITS),
      rosters: [
        { ...roster, uid: 'one', name: 'Strike Force', costLimit: 1500 },
        { ...roster, uid: 'two', name: 'Patrol', costLimit: 2000 },
      ],
    });

    const strikeForce = screen.getByRole('link', { name: /Strike Force/ });
    const patrol = screen.getByRole('link', { name: /Patrol/ });
    expect(strikeForce.getAttribute('href')).toBe('#/r/one');
    expect(patrol.getAttribute('href')).toBe('#/r/two');
    within(strikeForce).getByText('1,500');
    within(patrol).getByText('2,000');
  });
});
