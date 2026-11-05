// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { renderScreen } from '../test/screen';

const GST = '<gameSystem id="gst" name="Test Game" revision="1"/>';
const CAT = '<catalogue id="cat" name="Test Army" revision="1" gameSystemId="gst"/>';
const BODIES: Readonly<Record<string, string>> = { 'test.gst': GST, 'armies/test.cat': CAT };

/** A stand-in for GitHub holding one public repo, which records what the app asks for. */
function fakeGitHub() {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    const { hostname, pathname } = new URL(url);
    if (hostname === 'raw.githubusercontent.com') {
      return new Response(BODIES[pathname.replace('/owner/data/c1/', '')]);
    }
    if (pathname === '/repos/owner/data') return Response.json({ default_branch: 'main' });
    if (pathname === '/repos/owner/data/branches/main') return Response.json({ commit: { sha: 'c1' } });
    if (pathname === '/repos/owner/data/git/trees/c1') {
      const tree = Object.keys(BODIES).map((path) => ({ type: 'blob', path, sha: path, size: 0 }));
      return Response.json({ tree: [...tree, { type: 'blob', path: 'README.md', sha: 'r', size: 0 }] });
    }
    return new Response('', { status: 404 });
  });
  return urls;
}

const repoInput = () => screen.getByPlaceholderText('owner/repo or GitHub URL');
const addRepo = (text: string) => {
  fireEvent.input(repoInput(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', () => {}); // jsdom has none, and App calls it on each address
  vi.stubGlobal('matchMedia', () => ({ matches: false })); // jsdom has none, and DataView asks if it's installed
  history.replaceState(null, '', '#/data');
});

afterEach(() => vi.unstubAllGlobals());

describe('DataView', () => {
  it.each(['owner/data', 'https://github.com/owner/data/tree/main'])(
    'adding %s downloads the repo and shows it',
    async (text) => {
      fakeGitHub();
      await renderScreen(<App />);
      expect(screen.queryByText('owner/data')).toBeNull();

      addRepo(text);

      const status = await screen.findByText('2 file(s) updated');
      const card = status.closest('.card');
      if (!(card instanceof HTMLElement)) throw new Error('the status is not on a repo card');
      within(card).getByText('owner/data');
      await within(card).findByText(/^2 files · /);
      expect(repoInput()).toHaveProperty('value', '');
      const [saved] = await db.repos();
      expect(saved?.files.map((f) => f.path)).toEqual(['armies/test.cat', 'test.gst']);
      expect(await db.getFile('owner/data', 'armies/test.cat')).toBe(CAT);
    },
  );

  it("refuses text that isn't a repo and downloads nothing", async () => {
    const urls = fakeGitHub();
    await renderScreen(<App />);

    addRepo('just-a-word');

    await screen.findByText('Use the form owner/repo, e.g. BSData/horus-heresy');
    expect(urls).toEqual([]);
    expect(await db.repos()).toEqual([]);
  });
});
