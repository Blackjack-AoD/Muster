// @vitest-environment jsdom
import { waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { children, entry, unit, world } from '../test/fixture';
import { renderScreen, worldFiles } from '../test/screen';
import { buildSnapshot } from './snapshot';

const UNITS = unit(
  'u',
  'Squad',
  0,
  children(
    entry(
      'g',
      'Gun',
      0,
      '<constraints><constraint id="g-max" type="max" value="1" field="selections" scope="parent"/></constraints>',
    ),
    entry(
      'r',
      'Relic',
      0,
      '<constraints><constraint id="r-max" type="max" value="1" field="selections" scope="force"/></constraints>',
    ),
    entry(
      'b',
      'Banner',
      0,
      '<constraints><constraint id="b-max" type="max" value="1" field="selections" scope="roster"/></constraints>',
    ),
  ),
);

/** Two units over their own limit, a limit broken in two detachments, and a list-wide limit: 2 + 2 + 1. */
function listWithFiveIssues() {
  const w = world(UNITS);
  const f2 = w.addForce();
  for (const u of [w.add('Squad'), w.add('Squad')]) {
    w.pick(u, 'Gun', 2);
    w.pick(u, 'Relic');
    w.pick(u, 'Banner');
  }
  for (const u of [w.add('Squad', 1, f2), w.add('Squad', 1, f2)]) w.pick(u, 'Relic');
  return w;
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
});

describe('the error count', () => {
  it('counts each issue on the list', async () => {
    history.replaceState(null, '', '#/r/r');
    await renderScreen(<App />, { files: worldFiles(UNITS), rosters: [listWithFiveIssues().roster] });
    await waitFor(() => expect(document.querySelector('.sum-bar .chip')?.textContent).toBe('5 issues'));
  });

  it('counts each issue in a share link', () => {
    const { roster, contexts, ev } = listWithFiveIssues();
    const snapshot = buildSnapshot({ roster, contexts, ev: ev(), mutate: () => {}, scratch: false }, []);
    expect(snapshot.issues).toBe(5);
  });
});
