// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { unit } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';

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

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  history.replaceState(null, '', '#/lib');
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
});
