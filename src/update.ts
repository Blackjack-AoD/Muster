// App updates: register the service worker ourselves so a newly installed version is picked up straight away,
// and offer a manual "check for updates" and a cache reset on the Data tab.
import { getState, watchState } from './store';

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

let reloading = false;

const hasUnsavedEdit = () => getState().unsaved.size > 0;

/** Run the new version once no edit is at risk. If the player leaves first, it applies on the next open. */
function reloadWhenSaved() {
  if (reloading) return;
  reloading = true;
  if (!hasUnsavedEdit()) {
    location.reload();
    return;
  }
  const stop = watchState(() => {
    if (hasUnsavedEdit()) return;
    stop();
    location.reload();
  });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  // Already controlled = this is an update taking over: reload once to run the new version.
  // (A first install takes control too, but there's nothing old to replace then.)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadWhenSaved();
  });
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      /* offline or unsupported */
    });
  });
  // Automatic check at most once a week (on opening the app, or coming back to it); otherwise only on request.
  const weekly = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || hasUnsavedEdit()) return;
    if (Date.now() - lastCheck() < WEEK) return;
    checkForUpdate().catch(() => {});
  };
  addEventListener('load', () => setTimeout(weekly, 5000));
  document.addEventListener('visibilitychange', weekly);
}

const WEEK = 7 * 24 * 60 * 60_000;
const LAST_KEY = 'muster.lastUpdateCheck';
function lastCheck() {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0;
  } catch {
    return 0;
  }
}
/** when the app last looked for a new version (0 = never) */
export function lastUpdateCheck() {
  return lastCheck();
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
    try {
      localStorage.setItem(LAST_KEY, String(Date.now()));
    } catch {
      /* fine */
    }
    // the browser may have fetched a new version already; it waits until we say so
    const next = reg.installing ?? reg.waiting;
    if (!next) return 'latest';
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    next.addEventListener('statechange', () => {
      // older builds wait to be told to take over
      if (next.state === 'installed') next.postMessage({ type: 'SKIP_WAITING' });
      // fallback if the new worker activates without a controller change (e.g. the page wasn't controlled)
      if (next.state === 'activated') reloadWhenSaved();
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
