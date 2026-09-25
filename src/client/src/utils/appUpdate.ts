/**
 * Keep open tabs on the latest deployed version.
 *
 * Every build stamps its id into the bundle (`__APP_BUILD__`) and ships it as
 * `/version.json`. The page checks that file every minute and whenever the tab comes back
 * into view. When the server has a newer build:
 *  - a banner offers "Reload now", and
 *  - the page reloads by itself on the next in-app navigation — moving to another page is
 *    already a natural break, so nothing the user is typing is lost.
 *
 * Why: the service worker's own auto-update never reliably reloaded open tabs, so users kept
 * running an old copy until they pressed Ctrl+Shift+R (found 2026-09-25). This doesn't depend
 * on the service worker at all; it only asks it to fetch the new files before reloading.
 */

type Listener = (available: boolean) => void;

const CHECK_EVERY_MS = 60_000;
/** Never reload twice for the same target build (e.g. if the server briefly serves both). */
const RELOADED_KEY = 'app-update-reloaded-for';

let currentBuild: string = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';
let latestBuild: string | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false;
const listeners = new Set<Listener>();

export function isUpdateAvailable(): boolean {
  return !!latestBuild && latestBuild !== currentBuild && currentBuild !== 'dev';
}

export function onUpdateAvailable(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function setServiceWorkerRegistration(reg: ServiceWorkerRegistration | undefined | null): void {
  registration = reg ?? null;
}

/** Ask the server which build is live. Returns true if a newer one is available. */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json() as { build?: string };
    if (!body?.build) return false;
    const was = isUpdateAvailable();
    latestBuild = body.build;
    const now = isUpdateAvailable();
    if (now !== was) listeners.forEach(fn => fn(now));
    return now;
  } catch {
    return false; // offline or blocked — try again next time
  }
}

/**
 * Reload onto the new build. Lets the service worker fetch the new files first (bounded
 * wait), so the reload can't be answered from the old cache.
 */
export async function reloadForUpdate(force = false): Promise<void> {
  try {
    // Automatic reloads happen at most once per new build; the user's button always works.
    if (!force && latestBuild && sessionStorage.getItem(RELOADED_KEY) === latestBuild) return;
    if (latestBuild) sessionStorage.setItem(RELOADED_KEY, latestBuild);
  } catch { /* storage blocked — still reload */ }
  if (registration) {
    await Promise.race([registration.update().catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
  }
  window.location.reload();
}

export function startAppUpdateChecks(): void {
  if (started || currentBuild === 'dev') return;
  started = true;
  const check = () => { void checkForUpdate(); };
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  check();
}

/** Test hook */
export function _setBuildsForTests(current: string, latest: string | null): void {
  currentBuild = current;
  latestBuild = latest;
  try { sessionStorage.removeItem(RELOADED_KEY); } catch { /* ignore */ }
}
