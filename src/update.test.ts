// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './data/db';
import { unit, world } from './test/fixture';

const NOW = Date.UTC(2026, 10, 5);
const WEEK = 7 * 24 * 60 * 60_000;
const LAST_CHECK = 'muster.lastUpdateCheck';
const LOAD_DELAY = 5000;

type Update = typeof import('./update');
let update: Update;
let reload: ReturnType<typeof vi.fn>;

const lastCheckedAt = (time: number) => localStorage.setItem(LAST_CHECK, String(time));
const setVisibility = (state: DocumentVisibilityState) =>
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);

function fakeWorker(state: ServiceWorkerState) {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
}

type FakeWorker = ReturnType<typeof fakeWorker>;

function changeState(worker: FakeWorker, state: ServiceWorkerState) {
  worker.state = state;
  worker.dispatchEvent(new Event('statechange'));
}

function fakeRegistration(found: { installing?: FakeWorker; waiting?: FakeWorker } = {}) {
  return { installing: null, waiting: null, ...found, update: vi.fn(async () => {}) };
}

/** A phone that is online, with a service worker registered. */
function stubBrowser(registration: unknown = fakeRegistration(), controller: unknown = null) {
  const serviceWorker = Object.assign(new EventTarget(), {
    controller,
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
  });
  vi.stubGlobal('navigator', { onLine: true, serviceWorker });
  return serviceWorker;
}

const goOffline = () => Object.assign(navigator, { onLine: false });
const pageLoads = () => dispatchEvent(new Event('load'));
const flush = () => vi.advanceTimersByTimeAsync(0);
async function comeBack() {
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
}

const docListeners = vi.spyOn(document, 'addEventListener');
const windowListeners = vi.spyOn(globalThis, 'addEventListener');

beforeEach(async () => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubEnv('DEV', false);
  reload = vi.fn();
  vi.stubGlobal('location', { reload });
  setVisibility('visible');
  // the module remembers a reload is under way, so each test needs its own copy
  vi.resetModules();
  update = await import('./update');
});

afterEach(() => {
  // registerServiceWorker's listeners last as long as the page, so each test takes its own off
  for (const [type, listener] of docListeners.mock.calls) document.removeEventListener(type, listener);
  for (const [type, listener] of windowListeners.mock.calls) removeEventListener(type, listener);
  docListeners.mockClear();
  windowListeners.mockClear();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('the weekly update check', () => {
  it('runs five seconds after the page loads, once a week has passed', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    lastCheckedAt(NOW - WEEK);
    update.registerServiceWorker();
    pageLoads();
    await vi.advanceTimersByTimeAsync(LOAD_DELAY - 1);
    expect(registration.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('runs when the player comes back to the app after a week', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    lastCheckedAt(NOW - WEEK);
    update.registerServiceWorker();
    await comeBack();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('runs when no check has ever run', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    update.registerServiceWorker();
    await comeBack();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('waits for a full week on load and on coming back', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    const triggersFireAt = NOW + LOAD_DELAY;
    lastCheckedAt(triggersFireAt - WEEK + 1);
    update.registerServiceWorker();
    pageLoads();
    await vi.advanceTimersByTimeAsync(LOAD_DELAY);
    await comeBack();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('waits while the app is hidden and runs once it is visible', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    setVisibility('hidden');
    update.registerServiceWorker();
    pageLoads();
    await vi.advanceTimersByTimeAsync(LOAD_DELAY);
    await comeBack();
    expect(registration.update).not.toHaveBeenCalled();
    setVisibility('visible');
    await comeBack();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('does not run offline', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    goOffline();
    update.registerServiceWorker();
    pageLoads();
    await vi.advanceTimersByTimeAsync(LOAD_DELAY);
    await comeBack();
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('does not run again in the week after a check', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    update.registerServiceWorker();
    await comeBack();
    await comeBack();
    expect(registration.update).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next return when a check fails', async () => {
    const registration = fakeRegistration();
    registration.update.mockRejectedValueOnce(new Error('network down'));
    stubBrowser(registration);
    update.registerServiceWorker();
    await comeBack();
    await comeBack();
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it('does nothing in a dev build', async () => {
    vi.stubEnv('DEV', true);
    const registration = fakeRegistration();
    const serviceWorker = stubBrowser(registration);
    update.registerServiceWorker();
    pageLoads();
    await vi.advanceTimersByTimeAsync(LOAD_DELAY);
    await comeBack();
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(registration.update).not.toHaveBeenCalled();
  });
});

describe('registerServiceWorker', () => {
  it('registers the worker when the page loads', () => {
    const serviceWorker = stubBrowser();
    update.registerServiceWorker();
    expect(serviceWorker.register).not.toHaveBeenCalled();
    pageLoads();
    expect(serviceWorker.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
  });

  it('reloads once when an update takes over the page', () => {
    const serviceWorker = stubBrowser(fakeRegistration(), {});
    update.registerServiceWorker();
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when a first install takes control', () => {
    const serviceWorker = stubBrowser();
    update.registerServiceWorker();
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('checkForUpdate', () => {
  it('reports offline without asking the server', async () => {
    const registration = fakeRegistration();
    stubBrowser(registration);
    goOffline();
    expect(await update.checkForUpdate()).toBe('offline');
    expect(registration.update).not.toHaveBeenCalled();
  });

  it('reports unsupported on a browser with no service workers', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(await update.checkForUpdate()).toBe('unsupported');
  });

  it('reports unsupported when the browser has no worker', async () => {
    stubBrowser().getRegistration.mockResolvedValue(undefined);
    expect(await update.checkForUpdate()).toBe('unsupported');
  });

  it('reports the latest version and records when it looked', async () => {
    stubBrowser();
    expect(await update.checkForUpdate()).toBe('latest');
    expect(update.lastUpdateCheck()).toBe(NOW);
  });

  it('reports an error and records no check when the server call fails', async () => {
    const registration = fakeRegistration();
    registration.update.mockRejectedValueOnce(new Error('network down'));
    stubBrowser(registration);
    expect(await update.checkForUpdate()).toBe('error');
    expect(update.lastUpdateCheck()).toBe(0);
  });

  it('tells a waiting version to take over', async () => {
    const waiting = fakeWorker('installed');
    stubBrowser(fakeRegistration({ waiting }));
    expect(await update.checkForUpdate()).toBe('updating');
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('tells a version to take over once it has installed', async () => {
    const installing = fakeWorker('installing');
    stubBrowser(fakeRegistration({ installing }));
    expect(await update.checkForUpdate()).toBe('updating');
    expect(installing.postMessage).not.toHaveBeenCalled();
    changeState(installing, 'installed');
    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('reloads once a new version activates, without a controller change', async () => {
    const installing = fakeWorker('installing');
    stubBrowser(fakeRegistration({ installing }));
    await update.checkForUpdate();
    expect(reload).not.toHaveBeenCalled();
    changeState(installing, 'activated');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('lastUpdateCheck', () => {
  it('counts as never when storage refuses the read', () => {
    lastCheckedAt(NOW);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(update.lastUpdateCheck()).toBe(0);
  });
});

describe('resetAppCache', () => {
  function stubReset() {
    const stored = new Set(['app-v1', 'app-v2']);
    const cacheStorage = {
      keys: vi.fn(async () => [...stored]),
      delete: vi.fn(async (key: string) => {
        await Promise.resolve(); // storage answers later: nothing must reload before it has
        await Promise.resolve();
        return stored.delete(key);
      }),
    };
    const worker = { unregister: vi.fn(async () => true) };
    vi.stubGlobal('caches', cacheStorage);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [worker] } });
    return { stored, cacheStorage, worker };
  }

  it('drops every cache and the worker, then reloads', async () => {
    const { stored, cacheStorage, worker } = stubReset();
    await update.resetAppCache();
    expect(stored.size).toBe(0);
    expect(worker.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    const lastDelete = Math.max(...cacheStorage.delete.mock.invocationCallOrder);
    expect(reload.mock.invocationCallOrder[0]).toBeGreaterThan(lastDelete);
  });

  it('keeps saved lists and army data', async () => {
    stubReset();
    const { roster } = world(unit('tac', 'Tactical Squad', 100));
    await db.putRoster(roster);
    await db.putFile('test/repo', 'test.cat', '<catalogue/>');
    // the open connection makes a delete wait, so reading back alone can't see one
    const deleted = vi.spyOn(indexedDB, 'deleteDatabase');
    await update.resetAppCache();
    expect(deleted).not.toHaveBeenCalled();
    expect((await db.rosters()).map((r) => r.uid)).toEqual([roster.uid]);
    expect(await db.getFile('test/repo', 'test.cat')).toBe('<catalogue/>');
  });

  it('still reloads when clearing fails', async () => {
    const { cacheStorage } = stubReset();
    cacheStorage.keys.mockRejectedValueOnce(new Error('cache storage broken'));
    await expect(update.resetAppCache()).rejects.toThrow('cache storage broken');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
