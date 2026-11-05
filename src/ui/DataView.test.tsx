// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { getState } from '../store';
import { renderScreen, worldFiles } from '../test/screen';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REPO_FILES = worldFiles('');
const STORAGE_FULL = new DOMException('Storage is full', 'QuotaExceededError');
const refuse = (method: 'put' | 'delete') =>
  vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(() => {
    throw STORAGE_FULL;
  });
const expectToast = (text: string) => waitFor(() => expect(getState().toast).toBe(text));

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

  it('shows a failed download on its card alone, with no toast', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await renderScreen(<App />);

    addRepo('owner/data');

    await screen.findByText('Repo not found (is it public?)');
    expect(getState().toast).toBeUndefined();
  });

  it('shows the reason in a toast when storage refuses a sync', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await renderScreen(<App />);
    refuse('put');

    addRepo('owner/data');

    await expectToast("Couldn't sync: Storage is full");
  });

  it('shows the reason in a toast when removing a repo fails, and keeps the repo', async () => {
    vi.stubGlobal('confirm', () => true);
    await renderScreen(<App />, { files: REPO_FILES });
    refuse('delete');

    fireEvent.click(screen.getByRole('button', { name: 'Remove test/repo' }));

    await expectToast("Couldn't remove: Storage is full");
    expect(getState().repos.map((r) => r.repo)).toEqual(['test/repo']);
  });

  it('shows the reason in a toast when reloading a fresh copy fails', async () => {
    vi.stubGlobal('confirm', () => true);
    await renderScreen(<App />);

    // jsdom has no `caches`, as on a page served without https
    fireEvent.click(screen.getByText('Reload a fresh copy'));

    await expectToast("Couldn't reload a fresh copy: caches is not defined");
  });

  it('leaves out the storage line, with no toast, when the browser refuses a storage estimate', async () => {
    const estimate = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } });
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'storage');
    });
    await renderScreen(<App />);

    await waitFor(() => expect(estimate).toHaveBeenCalled());
    await screen.findByText('Army data sources');
    expect(screen.queryByText(/Storage used/)).toBeNull();
    expect(getState().toast).toBeUndefined();
  });
});
