// @vitest-environment jsdom
import { act, waitFor } from '@testing-library/preact';
import { render } from 'preact';
import { afterEach, expect, it, onTestFinished, vi } from 'vitest';

afterEach(async () => {
  const root = document.getElementById('app');
  if (root) await act(() => render(null, root));
  vi.unstubAllGlobals();
});

it("shows the reason on the page when the app can't start", async () => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  vi.stubGlobal('indexedDB', {
    open: () => {
      throw new Error('Storage is blocked');
    },
  });
  document.body.innerHTML = '<div id="app"></div>';

  await import('./main');

  const app = document.getElementById('app');
  onTestFinished(() => expect(app?.innerHTML).toBe(''));
  await waitFor(() => expect(app?.textContent).toContain("Couldn't open Muster: Storage is blocked"));
  expect(app?.querySelector('.spinner')).toBeNull();
});
