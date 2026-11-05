// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, getState } from '../store';
import { unit, world } from '../test/fixture';
import { downloadJson, shareBackup, shareText } from './exporter';

const TEXT = 'Strike Force, 1000 pts';
const TITLE = 'Strike Force';
const CANCELLED = new DOMException('Share canceled', 'AbortError');
const REFUSED = new DOMException('Permission denied', 'NotAllowedError');

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

  it('copies the text when the share sheet fails, and gives the reason', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(REFUSED), clipboard: { writeText } });
    await shareText(TEXT, TITLE);
    expect(writeText).toHaveBeenCalledWith(TEXT);
    expect(getState().toast).toBe("Couldn't share: Permission denied. Copied it instead");
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
  const backup = { app: 'muster', version: 1, rosters: [roster] };

  it('shares a dated backup file where the device can share files', async () => {
    const share = vi.fn<(data: { files: File[]; title: string }) => Promise<void>>(async () => {});
    vi.stubGlobal('navigator', { canShare: () => true, share });
    await shareBackup([roster]);
    const { files, title } = share.mock.calls[0][0];
    expect(title).toBe('Muster lists backup');
    expect(files.map((f) => f.name)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(await files[0].text())).toEqual(backup);
  });

  it('downloads the same backup where the device cannot share files', async () => {
    const { madeFrom, downloads } = stubDownloads();
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { canShare: () => false, share });
    await shareBackup([roster]);
    expect(share).not.toHaveBeenCalled();
    expect(downloads.map((d) => d.name)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(await madeFrom[0].text())).toEqual(backup);
  });

  it('does nothing when the player cancels the share sheet', async () => {
    const { downloads } = stubDownloads();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(CANCELLED) });
    await shareBackup([roster]);
    expect(downloads).toEqual([]);
    expect(getState().toast).toBeUndefined();
  });

  it('shows the reason in a toast when the share sheet fails, and downloads the backup instead', async () => {
    const { madeFrom, downloads } = stubDownloads();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(REFUSED) });
    await shareBackup([roster]);
    expect(getState().toast).toBe("Couldn't share: Permission denied");
    expect(downloads.map((d) => d.name)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(await madeFrom[0].text())).toEqual(backup);
  });
});
