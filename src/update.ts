// App updates: register the service worker ourselves so a newly installed version is picked up straight away,
// and offer a manual "check for updates" and a cache reset on the Data tab.

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

let reloading = false;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // Already controlled = this is an update taking over: reload once to run the new version.
  // (A first install takes control too, but there's nothing old to replace then.)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* offline or unsupported */ });
  });
  // Installed apps can stay open for days: look for a new version whenever the app comes back to the front.
  let last = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - last < 10 * 60_000) return;
    last = Date.now();
    navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}

export type UpdateResult = 'updating' | 'latest' | 'offline' | 'unsupported' | 'error';

/** Ask the server for a newer version. 'updating' means one was found; the page reloads by itself once it's ready. */
export async function checkForUpdate(): Promise<UpdateResult> {
  if (!navigator.onLine) return 'offline';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'unsupported';
    await reg.update();
    const next = reg.installing ?? reg.waiting;
    if (!next) return 'latest';
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    next.addEventListener('statechange', () => {
      // older builds wait to be told to take over
      if (next.state === 'installed') next.postMessage({ type: 'SKIP_WAITING' });
      // fallback if the new worker activates without a controller change (e.g. the page wasn't controlled)
      if (next.state === 'activated' && !reloading) { reloading = true; location.reload(); }
    });
    return 'updating';
  } catch {
    return 'error';
  }
}

/**
 * Last resort when an update won't take: drop the app's cached files and service worker, then reload from the web.
 * Army data and lists are stored separately (IndexedDB) and are kept.
 */
export async function resetAppCache() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    const keys = (await caches?.keys()) ?? [];
    await Promise.all(keys.map((k) => caches.delete(k)));
  } finally {
    location.reload();
  }
}
