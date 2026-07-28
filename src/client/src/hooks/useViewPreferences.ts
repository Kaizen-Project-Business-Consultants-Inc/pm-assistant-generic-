import { useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';

const STORAGE_KEY = 'view-preferences';

export interface ViewPreferences {
  theme?: 'light' | 'dark';
  sidebarCollapsed?: boolean;
  scheduleViewMode?: 'gantt' | 'kanban' | 'table' | 'calendar' | 'network' | 'burndown';
  projectsViewMode?: 'card' | 'table';
  aiPanelOpen?: boolean;
}

function loadLocal(): ViewPreferences | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as ViewPreferences;
  } catch { /* ignore */ }
  return null;
}

function saveLocal(prefs: ViewPreferences) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedWrite(prefs: ViewPreferences) {
  saveLocal(prefs);
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    apiService.updateViewPreferences(prefs as Record<string, unknown>).catch(() => {/* silent */});
  }, 1000);
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
    apiService.getViewPreferences()
      .then((res: any) => {
        const prefs: ViewPreferences | undefined = res?.preferences;
        if (prefs) {
          saveLocal(prefs);
          onServerPrefsRef.current(prefs);
        }
      })
      .catch(() => {/* no server prefs yet */});
  }, []);

  // Write current state back to server (debounced)
  const syncPrefs = useCallback((partial: Partial<ViewPreferences>) => {
    const current = loadLocal() || {};
    const updated = { ...current, ...partial };
    debouncedWrite(updated);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (writeTimer) clearTimeout(writeTimer); };
  }, []);

  return { syncPrefs };
}

/** Read a specific view preference from localStorage (for page-level prefs). */
export function getViewPref<K extends keyof ViewPreferences>(key: K): ViewPreferences[K] | undefined {
  return loadLocal()?.[key];
}

/** Update a specific view preference and sync to server. */
export function setViewPref<K extends keyof ViewPreferences>(key: K, value: ViewPreferences[K]) {
  const current = loadLocal() || {};
  debouncedWrite({ ...current, [key]: value });
}
