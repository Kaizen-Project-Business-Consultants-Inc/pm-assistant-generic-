import { useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';

const STORAGE_KEY = 'view-preferences';

export interface ViewPreferences {
  theme?: 'light' | 'dark';
  sidebarCollapsed?: boolean;
  scheduleViewMode?: 'gantt' | 'kanban' | 'table' | 'calendar' | 'network' | 'burndown';
  projectsViewMode?: 'card' | 'table';
  aiPanelOpen?: boolean;
  columnStates?: Record<string, { visibleKeys?: string[]; columnOrder?: string[]; colWidths?: Record<string, number> }>;
}

const OWNER_KEY = 'view-preferences-owner';

type Prefs = Record<string, unknown>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sync state (2026-10-08). Only a real change is saved: the layout re-mounts with every page and
 * re-reports the sidebar and AI panel state, which used to send a save on every page load. That
 * first report of each setting per mount is not a change and is ignored (useViewPreferences).
 *  - serverCopy: what the server holds, as last read or saved; null = not read yet on this tab.
 *    Nothing is sent before a read has succeeded; changes made meanwhile wait in `pending` and
 *    are sent after it (and win over the read).
 *  - pending: changed keys waiting to be sent — only those are sent (the server merges), so the
 *    column and favourite-report savers' keys are never overwritten with a stale copy. A failed
 *    save stays here and goes out with the next change or when the next page opens.
 *  - changeSeq / inFlight: a page's read that overlaps a change or a save (started before it, or
 *    while it was waiting or on its way) is older than what this tab knows and is not applied
 * All of it belongs to one signed-in user; it is dropped when a different user signs in.
 */
let memoryCopy: Prefs | null = null; // for when the browser blocks storage
let serverCopy: Prefs | null = null;
let pending: Prefs = {};
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
let changeSeq = 0;
let owner: string | undefined;

/** Start afresh when someone else signs in on this tab (their copy, not the last user's) */
function checkOwner() {
  const id = useAuthStore.getState().user?.id;
  if (!id || id === owner) return;
  let stored: string | null = null;
  try { stored = localStorage.getItem(OWNER_KEY); } catch { /* ignore */ }
  if (owner !== undefined || (stored !== null && stored !== id)) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    memoryCopy = null;
    serverCopy = null;
    pending = {};
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  }
  owner = id;
  try { localStorage.setItem(OWNER_KEY, id); } catch { /* ignore */ }
}

function loadLocal(): Prefs {
  checkOwner();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as Prefs;
  } catch { /* ignore */ }
  return memoryCopy ?? {};
}

function saveLocal(prefs: Prefs) {
  memoryCopy = prefs;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function armWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWrite, 1000);
}

/** Send the changed keys the server doesn't already have — never before the first read, and never
 *  for a signed-out or different user */
function flushWrite() {
  writeTimer = null;
  checkOwner();
  const { isAuthenticated, user } = useAuthStore.getState();
  if (!isAuthenticated || !user || serverCopy === null) return;
  // One save at a time keeps the diffs small and ordered (the server merges each in one step
  // since 2026-10-08, so two at once no longer lose a change)
  if (inFlight > 0) { armWrite(); return; }
  const known = serverCopy;
  const diff = Object.fromEntries(Object.entries(pending).filter(([k, v]) => !same(known[k], v)));
  pending = {};
  if (Object.keys(diff).length === 0) return;
  inFlight++;
  apiService.updateViewPreferences(diff)
    .then(() => { if (owner === user.id && serverCopy) serverCopy = { ...serverCopy, ...diff }; })
    // kept, and sent again with the next change or when the next page opens
    .catch(() => { if (owner === user.id) pending = { ...diff, ...pending }; })
    // a read that started while this save was on its way may hold the old row
    .finally(() => { inFlight--; changeSeq++; });
}

/** Save locally at once and on the server a second later — only if something really changed */
function queueChange(partial: Prefs) {
  const local = loadLocal();
  const changed = Object.entries(partial).some(([k, v]) =>
    !same(local[k], v) || (serverCopy !== null && !same(serverCopy[k], v)) || k in pending);
  if (!changed) return;
  saveLocal({ ...local, ...partial });
  pending = { ...pending, ...partial };
  changeSeq++;
  if (serverCopy !== null) armWrite(); // otherwise sent once a read has succeeded (see above)
}

/**
 * Syncs view preferences between server and localStorage.
 * Call once in AppLayout. Returns callbacks to apply server prefs to local state.
 */
export function useViewPreferences(
  onServerPrefs: (prefs: ViewPreferences) => void,
) {
  const onServerPrefsRef = useRef(onServerPrefs);
  onServerPrefsRef.current = onServerPrefs;

  // On mount: fetch from server, call back with prefs
  useEffect(() => {
    checkOwner();
    const asker = owner;
    const seqAtStart = changeSeq;
    apiService.getViewPreferences()
      .then((res: any) => {
        checkOwner();
        if (asker !== undefined && owner !== asker) return; // someone else signed in meanwhile
        let prefs: Prefs = res?.preferences ?? {};
        if (serverCopy === null) {
          // First read on this tab. Changes made before it (waiting in pending) are newer: they
          // stay on screen and are sent now.
          serverCopy = prefs;
          if (Object.keys(pending).length) {
            prefs = { ...prefs, ...pending };
            armWrite();
          }
        } else if (changeSeq !== seqAtStart || inFlight > 0 || writeTimer || Object.keys(pending).length) {
          // This tab changed something since the read began, or still has it to send: that is
          // newer than this read. Make sure anything left over (e.g. a failed save) goes out.
          if (Object.keys(pending).length && !writeTimer) armWrite();
          return;
        } else {
          serverCopy = prefs;
        }
        if (res?.preferences || Object.keys(pending).length) {
          saveLocal(prefs);
          onServerPrefsRef.current(prefs as ViewPreferences);
        }
      })
      .catch(() => {/* no server prefs yet */});
  }, []);

  // Write a change back to the server (debounced). The first report of each setting after this
  // layout mounts is its starting state (from this device), not something the user did: ignored.
  const reported = useRef(new Set<string>());
  const syncPrefs = useCallback((partial: Partial<ViewPreferences>) => {
    const changes = Object.fromEntries(Object.entries(partial).filter(([k]) => reported.current.has(k)));
    Object.keys(partial).forEach(k => reported.current.add(k));
    if (Object.keys(changes).length) queueChange(changes);
  }, []);

  // No clean-up on unmount: the layout re-mounts with every page, and a change made just before
  // moving on must still reach the server (flushWrite drops it if the user signed out or changed).

  return { syncPrefs };
}

/** Read a specific view preference from localStorage (for page-level prefs). */
export function getViewPref<K extends keyof ViewPreferences>(key: K): ViewPreferences[K] | undefined {
  return (loadLocal() as ViewPreferences)[key];
}

/** Update a specific view preference and sync to server. */
export function setViewPref<K extends keyof ViewPreferences>(key: K, value: ViewPreferences[K]) {
  queueChange({ [key]: value });
}
