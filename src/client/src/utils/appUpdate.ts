/**
 * Keep open tabs on the latest deployed version.
 *
 * Every build stamps its id into the bundle (`__APP_BUILD__`) and ships it as
 * `/version.json`. The page checks that file every minute and whenever the tab comes back
 * into view. When the server has a newer build it reloads quietly — no banner (product owner,
 * 2026-10-01) — at a moment that can't lose anything being typed:
 *  - the next in-app navigation (components/AppUpdater.tsx), or
 *  - after the tab has been in the background QUIET_AFTER_HIDDEN_MS with no dialog open and
 *    no edit in progress (safeToReloadQuietly).
 *
 * Why: the service worker's own auto-update never reliably reloaded open tabs, so users kept
 * running an old copy until they pressed Ctrl+Shift+R (found 2026-09-25). This doesn't depend
 * on the service worker at all; it only asks it to fetch the new files before reloading.
 */

type Listener = (available: boolean) => void;

const CHECK_EVERY_MS = 60_000;
/** A background tab picks up a new version after this long out of sight */
export const QUIET_AFTER_HIDDEN_MS = 3 * 60_000;
let hiddenSince: number | null = null;

/**
 * Nothing on the page that a reload would throw away: no open dialog (forms, editors), no
 * field being typed in, no text box holding unsent text, nothing marked unsaved.
 */
export function safeToReloadQuietly(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-unsaved="true"]')) return false;
  const active = doc.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return false;
  for (const t of Array.from(doc.querySelectorAll('textarea'))) if ((t as HTMLTextAreaElement).value.trim()) return false;
  return true;
}

/** The background-tab rule: hidden long enough, an update waiting, and safe */
export function shouldReloadInBackground(now: number, doc: Document = document): boolean {
  return isUpdateAvailable() && doc.visibilityState === 'hidden' && hiddenSince !== null
    && now - hiddenSince >= QUIET_AFTER_HIDDEN_MS && safeToReloadQuietly(doc);
}
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
  if (registration) await activateWaitingWorker(registration);
  window.location.reload();
}

const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<void>(r => setTimeout(r, ms))]);

/**
 * The new service worker waits (it no longer takes over by itself). Fetch it, let it finish
 * installing, then tell it to take over — so the reload is served the new files, not the old
 * cache. Every step is time-boxed: worst case we reload anyway.
 */
async function activateWaitingWorker(reg: ServiceWorkerRegistration): Promise<void> {
  await within(reg.update().catch(() => {}), 3000);
  const installing = reg.installing;
  if (installing) {
    await within(new Promise<void>(res => installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' || installing.state === 'activated') res();
    })), 5000);
  }
  if (reg.waiting && navigator.serviceWorker) {
    const switched = new Promise<void>(res => navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true }));
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    await within(switched, 3000);
  }
}

export function startAppUpdateChecks(): void {
  if (started || currentBuild === 'dev') return;
  started = true;
  const check = () => {
    void checkForUpdate().then(() => { if (shouldReloadInBackground(Date.now())) void reloadForUpdate(); });
  };
  setInterval(check, CHECK_EVERY_MS);
  hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null;
  document.addEventListener('visibilitychange', () => {
    hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null;
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
  check();
}

/** Test hook */
export function _setHiddenSinceForTests(t: number | null): void { hiddenSince = t; }

export function _setBuildsForTests(current: string, latest: string | null): void {
  currentBuild = current;
  latestBuild = latest;
  try { sessionStorage.removeItem(RELOADED_KEY); } catch { /* ignore */ }
}
