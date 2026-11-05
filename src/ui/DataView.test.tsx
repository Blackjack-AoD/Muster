// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { App } from '../app';
import { db, type SavedUnit } from '../data/db';
import { getState, toast } from '../store';
import { catalogueXml, gameSystemXml, world } from '../test/fixture';
import { github } from '../test/github';
import { expectToast, openHash, press, refuse, renderScreen, stubBrowserGaps, worldFiles } from '../test/screen';

const CAT = catalogueXml();
const BODIES: Readonly<Record<string, string>> = { 'test.gst': gameSystemXml(), 'armies/test.cat': CAT };

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

const SAVED_UNIT: SavedUnit = {
  id: 'thrax',
  name: 'Squad Thrax',
  repo: 'test/repo',
  gameSystemId: 'gs',
  catalogueId: 'cat',
  key: 'e',
  categoryId: 'hq',
  build: { uid: 'b', key: 'e', number: 1, children: [] },
  created: 1,
  updated: 2,
};

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

  it('shows a download that fails while offline as offline on its card and in a toast', async () => {
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

  it('backs up the saved units with the lists', async () => {
    await db.putSavedUnit(SAVED_UNIT);
    await renderScreen(<App />, { files: REPO_FILES, rosters: [world('').roster] });
    const made: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) made.push(blob);
      return 'blob:muster/backup';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: 'Back up 1 list' }));

    await waitFor(() => expect(made).toHaveLength(1));
    expect(JSON.parse((await made[0]?.text()) ?? 'null')).toMatchObject({ version: 2, savedUnits: [SAVED_UNIT] });
  });

  describe('Back up', () => {
    const lists = (n: number) => Array.from({ length: n }, (_, i) => ({ ...world('').roster, uid: `r${i}` }));
    async function storeSavedUnits(n: number) {
      for (let i = 0; i < n; i++) await db.putSavedUnit({ ...SAVED_UNIT, id: `u${i}` });
    }
    const backUp = () => screen.getByRole('button', { name: /^Back up/ });

    it.each([
      [2, 3, 'Back up 2 lists, 3 saved units'],
      [1, 1, 'Back up 1 list, 1 saved unit'],
    ])('labels Back up with %i list(s) and %i saved unit(s)', async (listCount, unitCount, label) => {
      await storeSavedUnits(unitCount);
      await renderScreen(<App />, { files: REPO_FILES, rosters: lists(listCount) });

      expect(backUp().textContent?.trim()).toBe(label);
      expect(backUp()).toHaveProperty('disabled', false);
    });

    it('counts only the lists on Back up with no saved units', async () => {
      await renderScreen(<App />, { files: REPO_FILES, rosters: lists(2) });

      expect(backUp().textContent?.trim()).toBe('Back up 2 lists');
      expect(backUp()).toHaveProperty('disabled', false);
    });

    it('backs up the saved units when the phone holds no lists', async () => {
      await storeSavedUnits(3);
      await renderScreen(<App />, { files: REPO_FILES });
      const made: Blob[] = [];
      vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        if (blob instanceof Blob) made.push(blob);
        return 'blob:muster/backup';
      });
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      expect(backUp().textContent?.trim()).toBe('Back up 3 saved units');
      expect(backUp()).toHaveProperty('disabled', false);
      fireEvent.click(backUp());

      await waitFor(() => expect(made).toHaveLength(1));
      const backup: unknown = JSON.parse((await made[0]?.text()) ?? 'null');
      expect(backup).toMatchObject({ rosters: [], savedUnits: [{ id: 'u0' }, { id: 'u1' }, { id: 'u2' }] });
    });

    it('disables Back up with neither lists nor saved units', async () => {
      await renderScreen(<App />, { files: REPO_FILES });

      expect(backUp().textContent?.trim()).toBe('Back up 0 lists');
      expect(backUp()).toHaveProperty('disabled', true);
    });
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

  describe('a reload the player starts', () => {
    const UNSAVED_WARNING = "A list has an edit that isn't saved, and reloading loses it. Carry on?";
    const UPDATE_WAITS = "A list has an edit that isn't saved. The update waits until it saves. Carry on?";
    const RESTARTS_SOON = /the app will restart by itself in a moment/;
    const RESTARTS_ONCE_SAVED = /the app will restart by itself once the edit has saved/;
    const FRESH_COPY_QUESTION = 'Reload a fresh copy of the app? Your lists and data are kept.';
    const AUTO_CHECK_NOTE = /Checks automatically once a week/;
    const NO_SERVICE_WORKER = /This browser can't check for updates/;

    const answerConfirm = (answer: boolean) => {
      const ask = vi.fn(() => answer);
      vi.stubGlobal('confirm', ask);
      return ask;
    };
    const pressReload = () => fireEvent.click(screen.getByText('Reload a fresh copy'));
    const expectStatus = (words: RegExp) => waitFor(() => expect(document.body.textContent).toMatch(words));
    /** The server has a new version, still installing. */
    const stubNewVersion = () => {
      const registration = { installing: new EventTarget(), waiting: null, update: async () => {} };
      const serviceWorker = { getRegistration: async () => registration };
      vi.stubGlobal('navigator', { onLine: true, serviceWorker });
    };

    async function openWithUnsavedEdit() {
      vi.stubGlobal('confirm', () => true);
      const { roster } = world('');
      openHash(`#/r/${roster.uid}`);
      await renderScreen(<App />, { files: REPO_FILES, rosters: [roster] });
      await press('List options');
      refuse('put');
      await press('Duplicate list');
      await expectToast("Couldn't save this list");
      location.hash = '#/data';
      await screen.findByRole('button', { name: 'Check for updates' });
      expect(getState().unsaved.size).toBe(1);
    }

    it('Check for updates asks first with an unsaved edit, and No does nothing', async () => {
      await openWithUnsavedEdit();
      const ask = answerConfirm(false);

      await press('Check for updates');

      expect(ask.mock.calls).toEqual([[UPDATE_WAITS]]);
      await db.rosters();
      screen.getByText(AUTO_CHECK_NOTE);
    });

    it('Check for updates carries on after Yes', async () => {
      await openWithUnsavedEdit();
      const ask = answerConfirm(true);

      await press('Check for updates');

      expect(ask.mock.calls).toEqual([[UPDATE_WAITS]]);
      await screen.findByText(NO_SERVICE_WORKER);
    });

    it('says the app restarts once the edit has saved when an update is held', async () => {
      await openWithUnsavedEdit();
      answerConfirm(true);
      stubNewVersion();

      await press('Check for updates');

      await expectStatus(RESTARTS_ONCE_SAVED);
      expect(document.body.textContent).not.toMatch(RESTARTS_SOON);
    });

    it('says the app restarts in a moment when no edit holds the update', async () => {
      await renderScreen(<App />);
      answerConfirm(false);
      stubNewVersion();

      await press('Check for updates');

      await expectStatus(RESTARTS_SOON);
    });

    it('Check for updates asks nothing with every edit saved', async () => {
      await renderScreen(<App />);
      const ask = answerConfirm(false);

      await press('Check for updates');

      await screen.findByText(NO_SERVICE_WORKER);
      expect(ask).not.toHaveBeenCalled();
    });

    it('Reload a fresh copy asks one question with an unsaved edit, and No does nothing', async () => {
      await openWithUnsavedEdit();
      const ask = answerConfirm(false);

      pressReload();

      expect(ask.mock.calls).toEqual([[UNSAVED_WARNING]]);
      await db.rosters();
      expect(getState().toast).toBe("Couldn't save this list");
    });

    it('Reload a fresh copy carries on after Yes', async () => {
      await openWithUnsavedEdit();
      const ask = answerConfirm(true);

      pressReload();

      await expectToast("Couldn't reload a fresh copy: caches is not defined");
      expect(ask.mock.calls).toEqual([[UNSAVED_WARNING]]);
    });

    it('Reload a fresh copy asks its usual question with every edit saved', async () => {
      await renderScreen(<App />);
      const ask = answerConfirm(false);

      pressReload();

      expect(ask.mock.calls).toEqual([[FRESH_COPY_QUESTION]]);
    });
  });

  describe('Restore', () => {
    const restoreFile = (text: string) =>
      fireEvent.change(screen.getByLabelText('Restore'), {
        target: { files: [new File([text], 'backup.json')] },
      });
    const backup = JSON.stringify({ app: 'muster', version: 1, rosters: [world('').roster] });

    it('restores the lists in a version 1 backup file', async () => {
      await renderScreen(<App />);

      restoreFile(backup);

      await expectToast('Restored 1 list(s)');
      expect((await db.rosters()).map((r) => r.uid)).toEqual(['r']);
      expect(await db.savedUnits()).toEqual([]);
    });

    const withCopy = {
      ...world('').roster,
      forces: [
        {
          uid: 'f',
          forceEntryId: 'det',
          catalogueId: 'cat',
          selections: [{ uid: 'u', key: 'e', number: 1, name: 'Squad Thrax', saved: 'thrax', children: [] }],
        },
      ],
    };

    it('restores the lists and saved units in a version 2 backup file, with copies linked', async () => {
      await renderScreen(<App />);

      restoreFile(JSON.stringify({ app: 'muster', version: 2, rosters: [withCopy], savedUnits: [SAVED_UNIT] }));

      await expectToast('Restored 1 list(s), 1 saved unit(s)');
      expect(await db.savedUnits()).toEqual([SAVED_UNIT]);
      expect(getState().savedUnits).toEqual([SAVED_UNIT]);
      const [restored] = await db.rosters();
      expect(restored?.forces[0]?.selections[0]).toMatchObject({ saved: 'thrax', name: 'Squad Thrax' });
    });

    it('counts the lists and saved units it skipped', async () => {
      await renderScreen(<App />);

      restoreFile(
        JSON.stringify({ app: 'muster', version: 2, rosters: [withCopy, null], savedUnits: [SAVED_UNIT, null] }),
      );

      await expectToast('Restored 1 list(s), 1 saved unit(s), skipped 2');
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
      ['saved units that are not a list', '{"rosters":[],"savedUnits":{}}'],
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
