// @vitest-environment jsdom
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { StatBlock, splitColumns, type StatProfile } from './StatBlock';

const p = (name: string, ...pairs: [string, string][]): StatProfile => ({
  name,
  characteristics: pairs.map(([n, value]) => ({ name: n, value })),
});
// Kill Team 2018 weapons
const PISTOL = p(
  'Phosphor blast pistol',
  ['Range', '12"'],
  ['Type', 'Pistol 1'],
  ['S', '5'],
  ['AP', '-1'],
  ['D', '1'],
  ['Abilities', 'Attacks made with this weapon do not suffer the penalty to hit rolls for the target being obscured.'],
);
const GOAD = p(
  'Taser goad',
  ['Range', 'Melee'],
  ['Type', 'Melee'],
  ['S', '+2'],
  ['AP', '0'],
  ['D', '1'],
  ['Abilities', '-'],
);

const rows = (c: Element) => [...c.querySelectorAll('tbody tr')].map((r) => [r.className, r.textContent]);

describe('splitColumns', () => {
  it('puts every short stat in the statline, and abilities beneath it', () => {
    expect(splitColumns([PISTOL, GOAD])).toMatchObject({
      short: ['Range', 'Type', 'S', 'AP', 'D'],
      long: ['Abilities'],
    });
  });
  it('keeps a template range in the statline, and a long weapon type beneath it (Horus Heresy)', () => {
    const flamer = p('Hand Flamer', ['Range', 'Template'], ['Strength', '3'], ['AP', '-'], ['Type', 'Pistol 1']);
    const pistol = p(
      'Archaeotech Pistol',
      ['Range', '12"'],
      ['Strength', '6'],
      ['AP', '4'],
      ['Type', 'Pistol 1, Rending (3+), Master-crafted'],
    );
    expect(splitColumns([flamer, pistol])).toMatchObject({ short: ['Range', 'Strength', 'AP'], long: ['Type'] });
  });
});

describe('StatBlock', () => {
  it('shows a header of stats, then each name, its statline and its abilities beneath', () => {
    const { container } = render(<StatBlock profiles={[PISTOL, GOAD]} />);
    expect([...container.querySelectorAll('th')].map((t) => t.textContent)).toEqual(['Range', 'Type', 'S', 'AP', 'D']);
    expect(rows(container)).toEqual([
      ['sb-name', 'Phosphor blast pistol'],
      ['sb-vals has-text', '12"Pistol 15-11'],
      [
        'sb-text',
        'Abilities: Attacks made with this weapon do not suffer the penalty to hit rolls for the target being obscured.',
      ],
      ['sb-name', 'Taser goad'],
      ['sb-vals', 'MeleeMelee+201'],
    ]);
  });
  it('gives a wide column more room than a narrow one', () => {
    const { container } = render(<StatBlock profiles={[PISTOL, GOAD]} />);
    const [range, type, s] = [...container.querySelectorAll('col')].map((c) => parseFloat(c.style.width));
    expect(type).toBeGreaterThan(s);
    expect(range).toBeGreaterThan(s);
  });
  it('shows a type with no statline (an ability) as a text card', () => {
    const { container } = render(
      <StatBlock
        profiles={[p('Resourceful', ['Description', 'As long as this model is on the battlefield, gain 1 CP.'])]}
      />,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.pcard')?.textContent).toBe(
      'ResourcefulDescription: As long as this model is on the battlefield, gain 1 CP.',
    );
  });
});
