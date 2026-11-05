// @vitest-environment jsdom
import { waitFor } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

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
  await waitFor(() => expect(app?.textContent).toContain("Couldn't open Muster: Storage is blocked"));
  expect(app?.querySelector('.spinner')).toBeNull();
});
