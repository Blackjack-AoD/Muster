// Stat lines laid out to fit a phone (or a printed page) without sideways scrolling.

/** the bits of a profile the block needs (works for live profiles and shared snapshots) */
export interface StatProfile { name: string; characteristics: { name: string; value: string }[] }

const ABBR: Record<string, string> = {
  strength: 'S', toughness: 'T', wounds: 'W', attacks: 'A', initiative: 'I', leadership: 'Ld', movement: 'M', move: 'M',
  'weapon skill': 'WS', 'ballistic skill': 'BS', save: 'Sv', 'armour save': 'Sv', 'invulnerable save': 'Inv',
  'front armour': 'FA', 'side armour': 'SA', 'rear armour': 'RA', 'hull points': 'HP', 'armour penetration': 'AP',
  cool: 'Cl', willpower: 'Wp', intelligence: 'Int', 'structure points': 'SP', 'void shields': 'VS',
};
/** short column header for the stat grid; unknown long names are left alone (and stay out of the grid) */
function abbr(c: string) {
  return c.length <= 5 ? c : ABBR[c.toLowerCase()] ?? c;
}

/**
 * Profiles laid out to fit a phone without sideways scrolling: short stats in a fixed grid,
 * the profile name on its own line, and wordy fields (unit type, weapon type, abilities) as text beneath.
 */
export function StatBlock({ profiles }: { profiles: StatProfile[] }) {
  const cols = profiles[0].characteristics.map((c) => c.name);
  const val = (p: StatProfile, c: string) => p.characteristics.find((x) => x.name === c)?.value ?? '';
  // a column goes in the grid when its values are short; long headers get abbreviated ("Strength" → "S")
  const short = cols.filter((c) => profiles.every((p) => val(p, c).length <= 5) && (c.length <= 5 || abbr(c) !== c));
  const long = cols.filter((c) => !short.includes(c));
  // nothing fits a grid (e.g. wargear descriptions): show as text cards
  if (!short.length) {
    return (
      <div class="statcards">
        {profiles.map((p) => (
          <div class="pcard"><b>{p.name}</b>{long.map((c) => val(p, c) && <p><span class="muted">{c}:</span> {val(p, c)}</p>)}</div>
        ))}
      </div>
    );
  }
  return (
    <div class="statblock">
      <table class={'stattable' + (short.length > 10 ? ' dense' : '')}>
        <thead><tr>{short.map((c) => <th title={c}>{abbr(c)}</th>)}</tr></thead>
        {profiles.map((p) => (
          <tbody>
            <tr class="sb-name"><td colSpan={short.length}>
              <b>{p.name}</b>
              {/* type fields read fine bare ("Infantry", "Assault 2"); anything else gets its label */}
              {long.map((c) => val(p, c) && <div class="sb-long">{/type/i.test(c) ? '' : <span class="muted">{c}: </span>}{val(p, c)}</div>)}
            </td></tr>
            <tr class="sb-vals">{short.map((c) => <td>{val(p, c) || '–'}</td>)}</tr>
          </tbody>
        ))}
      </table>
    </div>
  );
}
