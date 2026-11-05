// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { App } from '../app';
import { db } from '../data/db';
import { getState, toast } from '../store';
import { world } from '../test/fixture';
import { github } from '../test/github';
import { expectToast, openHash, refuse, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';

const GST = '<gameSystem id="gst" name="Test Game" revision="1"/>';
const CAT = '<catalogue id="cat" name="Test Army" revision="1" gameSystemId="gst"/>';
const BODIES: Readonly<Record<string, string>> = { 'test.gst': GST, 'armies/test.cat': CAT };

const fakeGitHub = () =>
  github({
    tree: [...Object.keys(BODIES), 'README.md'].map((path) => ({ path, sha: path })),
    bodies: BODIES,
  });

const repoInput = () => screen.getByPlaceholderText('owner/repo or GitHub URL');
const addRepo = (text: string) => {
  fireEvent.input(repoInput(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
};

beforeEach(async () => {
  await stubBrowserGaps();
  openHash('#/data');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REPO_FILES = worldFiles('');

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
      expect(getState().toast).toBeUndefined();
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

  it('shows a failed download on its card and in a toast with the reason', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await renderScreen(<App />);

    addRepo('owner/data');

    await screen.findByText('Repo not found (is it public?)', { selector: '.card .error-text' });
    await expectToast("Couldn't sync: Repo not found (is it public?)");
  });

  it('shows a download that fails while offline as offline in both places', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await renderScreen(<App />);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    addRepo('owner/data');

    await screen.findByText('You are offline', { selector: '.card .error-text' });
    await expectToast("Couldn't sync: You are offline");
  });

  it('shows the reason in a toast when storage refuses a sync', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await renderScreen(<App />);
    refuse('put');

    addRepo('owner/data');

    await expectToast("Couldn't sync: Storage is full");
  });

  it('shows a repo that storage refused as failed, and gives back the sync buttons', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await renderScreen(<App />, { files: REPO_FILES });
    refuse('put');

    addRepo('owner/data');

    await screen.findByText("Couldn't sync: Storage is full", { selector: '.card .error-text' });
    expect(screen.getByRole('button', { name: 'Sync test/repo' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Sync owner/data' })).toHaveProperty('disabled', false);
  });

  it('shows the reason in a toast when removing a repo fails, and keeps the repo', async () => {
    vi.stubGlobal('confirm', () => true);
    await renderScreen(<App />, { files: REPO_FILES });
    refuse('delete');

    fireEvent.click(screen.getByRole('button', { name: 'Remove test/repo' }));

    await expectToast("Couldn't remove: Storage is full");
    expect(getState().repos.map((r) => r.repo)).toEqual(['test/repo']);
  });

  it('shows the reason in a toast when a backup fails to download', async () => {
    await renderScreen(<App />, { files: REPO_FILES, rosters: [world('').roster] });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('Out of memory');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back up 1 list' }));

    await expectToast("Couldn't share: Out of memory");
  });

  it('shows the reason in a toast when reloading a fresh copy fails', async () => {
    vi.stubGlobal('confirm', () => true);
    await renderScreen(<App />);

    // jsdom has no `caches`, as on a page served without https
    fireEvent.click(screen.getByText('Reload a fresh copy'));

    await expectToast("Couldn't reload a fresh copy: caches is not defined");
  });

  describe('Restore', () => {
    const restoreFile = (text: string) =>
      fireEvent.change(screen.getByLabelText('Restore'), {
        target: { files: [new File([text], 'backup.json')] },
      });
    const backup = JSON.stringify({ app: 'muster', version: 1, rosters: [world('').roster] });

    it('restores the lists in a backup file', async () => {
      await renderScreen(<App />);

      restoreFile(backup);

      await expectToast('Restored 1 list(s)');
      expect((await db.rosters()).map((r) => r.uid)).toEqual(['r']);
    });

    it('reads a bare list of rosters as a backup', async () => {
      await renderScreen(<App />);

      restoreFile(JSON.stringify([world('').roster]));

      await expectToast('Restored 1 list(s)');
      expect(getState().rosters.map((r) => r.uid)).toEqual(['r']);
    });

    it('counts what it restored and what it skipped', async () => {
      await renderScreen(<App />);
      const second = { ...world('').roster, uid: 'second' };

      restoreFile(JSON.stringify([world('').roster, null, second]));

      await expectToast('Restored 2 list(s), skipped 1');
      expect((await db.rosters()).map((r) => r.uid).sort()).toEqual(['r', 'second']);
    });

    it('restores nothing from a file of anything else', async () => {
      await renderScreen(<App />);

      restoreFile('[1, 2, 3]');

      await expectToast('Restored 0 list(s), skipped 3');
    });

    it.each([
      ['text that is not JSON', 'not json'],
      ['JSON with no lists in it', '{"app":"muster"}'],
      ['the JSON value null', 'null'],
    ])("says %s isn't a backup", async (_what, text) => {
      await renderScreen(<App />);

      restoreFile(text);

      await expectToast("That file isn't a Muster backup");
    });

    it('shows the reason when storage refuses the lists', async () => {
      await renderScreen(<App />);
      refuse('put');

      restoreFile(backup);

      await expectToast("Couldn't restore: Storage is full");
    });

    it('keeps the Retry toast up, and shows the restored lists with no message', async () => {
      await renderScreen(<App />);
      toast("Couldn't save this list", { label: 'Retry', run: () => {}, failedSave: 'edited' });

      restoreFile(backup);

      await screen.findByRole('button', { name: 'Back up 1 list' });
      // a trip to storage lets the Restore finish whatever it does after the lists appear
      await db.rosters();
      expect(screen.queryByRole('status')?.textContent).toBe("Couldn't save this listRetry");
    });
  });

  it('shows the reason when the app cannot read an imported file', async () => {
    await renderScreen(<App />);
    const damaged = new File(['not a zip'], 'army.zip');

    fireEvent.change(screen.getByLabelText('Import data files or a repo .zip'), { target: { files: [damaged] } });

    await expectToast("Couldn't import: Not a zip file");
    expect(await db.repos()).toEqual([]);
  });

  it('shows the reason in a toast when the install prompt fails', async () => {
    const offer = Object.assign(new Event('beforeinstallprompt'), {
      prompt: () => Promise.reject(new Error('Install was blocked')),
    });
    dispatchEvent(offer);
    await renderScreen(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await expectToast("Couldn't install: Install was blocked");
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
