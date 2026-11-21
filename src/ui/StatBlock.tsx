// Stat lines laid out to fit a phone (or a printed page) without sideways scrolling.

/** the bits of a profile the block needs (works for live profiles and shared snapshots) */
export interface StatProfile {
  name: string;
  characteristics: { name: string; value: string }[];
}

const ABBR: Record<string, string> = {
  strength: 'S',
  toughness: 'T',
  wounds: 'W',
  attacks: 'A',
  initiative: 'I',
  leadership: 'Ld',
  movement: 'M',
  move: 'M',
  'weapon skill': 'WS',
  'ballistic skill': 'BS',
  save: 'Sv',
  'armour save': 'Sv',
  'invulnerable save': 'Inv',
  'front armour': 'FA',
  'side armour': 'SA',
  'rear armour': 'RA',
  'hull points': 'HP',
  'armour penetration': 'AP',
  damage: 'D',
  cool: 'Cl',
  willpower: 'Wp',
  intelligence: 'Int',
  'structure points': 'SP',
  'void shields': 'VS',
};
/** short column header for the stat grid; unknown long names are left alone (and stay out of the grid) */
export function abbr(c: string) {
  return c.length <= 5 ? c : (ABBR[c.toLowerCase()] ?? c);
}

/** the longest value that still fits a column: "Template", "Pistol 1", "Heavy D3" */
const COLUMN_MAX = 10;

/**
 * Splits a profile type's characteristics into statline columns and text that goes beneath the statline.
 * A column is short in every profile and has a short (or abbreviable) name; the rest (abilities, special rules,
 * a long weapon type) is text.
 */
export function splitColumns(profiles: StatProfile[]) {
  const cols = profiles[0].characteristics.map((c) => c.name);
  const val = (p: StatProfile, c: string) => p.characteristics.find((x) => x.name === c)?.value ?? '';
  const short = cols.filter(
    (c) => profiles.every((p) => val(p, c).length <= COLUMN_MAX) && (c.length <= 5 || abbr(c) !== c),
  );
  return { short, long: cols.filter((c) => !short.includes(c)), val };
}

/** each column's share of the width, by its longest value or header, so "Template" gets more room than "AP" */
function widths(profiles: StatProfile[], short: string[], val: (p: StatProfile, c: string) => string) {
  // capped, so one long value ("Template") doesn't squeeze the rest
  const w = short.map((c) => Math.min(6, Math.max(2, abbr(c).length, ...profiles.map((p) => val(p, c).length))) + 1);
  const sum = w.reduce((t, x) => t + x, 0);
  return w.map((x) => `${((x / sum) * 100).toFixed(2)}%`);
}

/**
 * Profiles laid out like New Recruit, fitted to a phone: a header row of stat names, then each profile's name,
 * its statline, and its wordy fields (abilities, special rules) as text beneath the statline.
 */
export function StatBlock({ profiles }: { profiles: StatProfile[] }) {
  const { short, long, val } = splitColumns(profiles);
  // nothing fits a statline (e.g. wargear or ability descriptions): show as text cards
  if (!short.length) {
    return (
      <div class="statcards">
        {profiles.map((p) => (
          <div class="pcard">
            <b>{p.name}</b>
            {long.map(
              (c) =>
                val(p, c) && (
                  <p>
                    <span class="muted">{c}:</span> {val(p, c)}
                  </p>
                ),
            )}
          </div>
        ))}
      </div>
    );
  }
  const w = widths(profiles, short, val);
  return (
    <div class="statblock">
      <table class={'stattable' + (short.length > 10 ? ' dense' : '')}>
        <colgroup>
          {w.map((width) => (
            <col style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {short.map((c) => (
              <th title={c}>{abbr(c)}</th>
            ))}
          </tr>
        </thead>
        {profiles.map((p) => {
          const text = long.filter((c) => val(p, c) && val(p, c) !== '-');
          return (
            <tbody>
              <tr class="sb-name">
                <td colSpan={short.length}>
                  <b>{p.name}</b>
                </td>
              </tr>
              <tr class={'sb-vals' + (text.length ? ' has-text' : '')}>
                {short.map((c) => (
                  <td>{val(p, c) || '–'}</td>
                ))}
              </tr>
              {text.length > 0 && (
                <tr class="sb-text">
                  <td colSpan={short.length}>
                    {text.map((c) => (
                      <div class="sb-long">
                        {/* a long weapon or unit type reads fine bare ("Pistol 1, Rending (3+)"); anything else gets its label */}
                        {/type/i.test(c) ? '' : <span class="muted">{c}: </span>}
                        {val(p, c)}
                      </div>
                    ))}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
