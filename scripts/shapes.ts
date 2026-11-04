// The "shape" of a condition, repeat, constraint or modifier: what kind of behaviour it asks of the engine,
// ignoring ids and numbers. Read from raw XML, so it works on data files and on unit test sources alike.

const TAG = /<(condition|repeat|constraint|modifier)\b([^>]*?)\/?>/g;
const WORD_FIELDS = new Set([
  'selections',
  'forces',
  'hidden',
  'name',
  'category',
  'description',
  'defaultSelectionEntryId',
]);
const WORD_SCOPES = new Set([
  'self',
  'parent',
  'ancestor',
  'force',
  'roster',
  'primary-category',
  'primary-catalogue',
  'root-entry',
  'unit',
  'model',
  'upgrade',
  'model-or-unit',
]);

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** Cost types are declared in the game system file, so collect them across files before asking for shapes. */
export const costIds = (xml: string) => [...xml.matchAll(/<costType\b[^>]*?\bid="([^"]*)"/g)].map((m) => m[1]);

export function shapesOf(xml: string, costTypes: Iterable<string> = []): string[] {
  const costs = new Set(['pts', ...costTypes]);
  const field = (a: string, fallback: string) => {
    const f = attr(a, 'field') ?? fallback;
    return WORD_FIELDS.has(f) ? f : costs.has(f) ? 'cost' : 'id';
  };
  const scope = (a: string) => {
    const s = attr(a, 'scope') ?? 'parent';
    return WORD_SCOPES.has(s) ? s : 'id';
  };
  const flags = (a: string) =>
    [
      attr(a, 'includeChildSelections') === 'true' && 'deep',
      attr(a, 'percentValue') === 'true' && 'percent',
      attr(a, 'roundUp') === 'true' && 'roundUp',
    ]
      .filter(Boolean)
      .join(' ');

  return [...xml.matchAll(TAG)].map(([, tag, a]) => {
    const f = flags(a);
    const tail = f ? ` ${f}` : '';
    if (tag === 'modifier') return `modifier ${attr(a, 'type')} ${field(a, '')}${attr(a, 'affects') ? ' affects' : ''}`;
    if (tag === 'repeat') return `repeat ${field(a, 'selections')} ${scope(a)}${tail}`;
    return `${tag} ${attr(a, 'type')} ${field(a, 'selections')} ${scope(a)}${tail}`;
  });
}
