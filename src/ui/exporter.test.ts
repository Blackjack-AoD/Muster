// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, getState } from '../store';
import type { SavedUnit } from '../data/db';
import { unit, world } from '../test/fixture';
import { downloadJson, shareBackup, shareText } from './exporter';

const TEXT = 'Strike Force, 1000 pts';
const TITLE = 'Strike Force';
const CANCELLED = new DOMException('Share canceled', 'AbortError');
const REFUSED = new DOMException('Permission denied', 'NotAllowedError');
const NAMED_ABORT = Object.assign(new Error('Stopped'), { name: 'AbortError' });

function stubDownloads() {
  const madeFrom: Blob[] = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    madeFrom.push(blob);
    return 'blob:muster/file';
  });
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const downloads: { name: string; href: string; attached: boolean }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href, attached: this.isConnected });
  });
  return { madeFrom, downloads, revokeObjectURL };
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 5, 12), toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  dismissToast();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('shareText', () => {
  it('uses the share sheet where there is one, and leaves the clipboard alone', async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(share).toHaveBeenCalledWith({ title: TITLE, text: TEXT });
    expect(writeText).not.toHaveBeenCalled();
    expect(getState().toast).toBeUndefined();
  });

  it('copies to the clipboard where there is no share sheet, and says so', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(getState().toast).toBe('Copied to clipboard');
  });

  it('shows the reason when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    await shareText(TEXT, TITLE);
    expect(getState().toast).toBe("Couldn't share: denied");
  });

  it('does nothing when the player cancels the share sheet', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(CANCELLED), clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(writeText).not.toHaveBeenCalled();
    expect(getState().toast).toBeUndefined();
  });

  it('counts a plain error named AbortError as a failure, not a cancel', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(NAMED_ABORT), clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(getState().toast).toBe("Couldn't share: Stopped. Copied it instead");
  });

  it('copies the text when the share sheet fails, and gives the reason', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(REFUSED), clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(getState().toast).toBe("Couldn't share: Permission denied. Copied it instead");
  });

  it("gives one full stop when the share sheet's reason ends in one", async () => {
    const denied = new DOMException('The user denied permission.', 'NotAllowedError');
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(denied), clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(getState().toast).toBe("Couldn't share: The user denied permission. Copied it instead");
  });

  it("gives the share sheet's reason when the clipboard refuses too", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(REFUSED), clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(getState().toast).toBe("Couldn't share: Permission denied");
  });
});

describe('downloadJson', () => {
  it('downloads a JSON file with the given name and data', async () => {
    const { madeFrom, downloads } = stubDownloads();
    downloadJson('list.json', { name: 'Strike Force', units: [1, 2] });
    expect(downloads).toEqual([{ name: 'list.json', href: 'blob:muster/file', attached: true }]);
    expect(madeFrom[0].type).toBe('application/json');
    expect(JSON.parse(await madeFrom[0].text())).toEqual({ name: 'Strike Force', units: [1, 2] });
  });

  it('removes the link and frees the file a second later', () => {
    const { revokeObjectURL } = stubDownloads();
    downloadJson('list.json', {});
    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('a')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:muster/file');
    expect(document.querySelector('a')).toBeNull();
  });
});

describe('shareBackup', () => {
  const { roster } = world(unit('tac', 'Tactical Squad', 100));
  const BACKUP_NAME = 'muster-lists-2026-11-05.json';
  const savedUnit: SavedUnit = {
    id: 'thrax',
    name: 'Squad Thrax',
    repo: roster.repo,
    gameSystemId: roster.gameSystemId,
    catalogueId: 'cat',
    key: 'tac',
    categoryId: 'troops',
    build: { uid: 'b', key: 'tac', number: 1, children: [] },
    created: 1,
    updated: 2,
  };
  const backup = { app: 'muster', version: 2, rosters: [roster], savedUnits: [savedUnit] };

  it('shares a dated backup file of lists and saved units where the device can share files, and downloads nothing', async () => {
    const { downloads } = stubDownloads();
    const share = vi.fn<(data: { files: File[]; title: string }) => Promise<void>>(async () => {});
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await shareBackup([roster], [savedUnit]);
    const { files, title } = share.mock.calls[0][0];
    expect(title).toBe('Muster lists backup');
    expect(files.map((f) => f.name)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(await files[0].text())).toEqual(backup);
    expect(downloads).toEqual([]);
  });

  it('downloads the same backup where the device cannot share files', async () => {
    const { madeFrom, downloads } = stubDownloads();
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { canShare: () => false, share });
    await shareBackup([roster], [savedUnit]);
    expect(share).not.toHaveBeenCalled();
    expect(downloads.map((d) => d.name)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(await madeFrom[0].text())).toEqual(backup);
  });

  it('does nothing when the player cancels the share sheet', async () => {
    const { downloads } = stubDownloads();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(CANCELLED) });
    await shareBackup([roster], [savedUnit]);
    expect(downloads).toEqual([]);
    expect(getState().toast).toBeUndefined();
  });

  it('counts a plain error named AbortError as a failure, and downloads the backup', async () => {
    const { downloads } = stubDownloads();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(NAMED_ABORT) });
    await shareBackup([roster], [savedUnit]);
    expect(getState().toast).toBe("Couldn't share: Stopped");
    expect(downloads.map((d) => d.name)).toEqual([BACKUP_NAME]);
  });

  it('shows the reason in a toast when the share sheet fails, and downloads the backup instead', async () => {
    const { madeFrom, downloads } = stubDownloads();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(REFUSED) });
    await shareBackup([roster], [savedUnit]);
    expect(getState().toast).toBe("Couldn't share: Permission denied");
    expect(downloads.map((d) => d.name)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(await madeFrom[0].text())).toEqual(backup);
  });
});
