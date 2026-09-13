import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { apiService } from '../services/api';

export interface AccessibilityPreferences {
  highContrast: boolean;
  fontSize: number;
  reducedMotion: boolean;
  simplificationLevel: 'off' | 'mild' | 'strong';
  narrationEnabled: boolean;
  keyboardShortcutsEnabled: boolean;
}

const DEFAULT_PREFS: AccessibilityPreferences = {
  highContrast: false,
  fontSize: 16,
  reducedMotion: false,
  simplificationLevel: 'off',
  narrationEnabled: false,
  keyboardShortcutsEnabled: true,
};

interface AccessibilityContextValue {
  prefs: AccessibilityPreferences;
  updatePrefs: (updates: Partial<AccessibilityPreferences>) => Promise<void>;
  loading: boolean;
}

const AccessibilityContext = createContext<AccessibilityContextValue>({
  prefs: DEFAULT_PREFS,
  updatePrefs: async () => {},
  loading: false,
});

export function useAccessibility() {
  return useContext(AccessibilityContext);
}

const LOCAL_STORAGE_KEY = 'pm-accessibility-prefs';

function applyToDocument(prefs: AccessibilityPreferences) {
  const root = document.documentElement;
  // Express as percentage so it multiplies the browser's configured default
  // instead of overriding it with a fixed px value (WCAG 1.4.4 / 1.4.12)
  const percentage = (prefs.fontSize / 16) * 100;
  root.style.setProperty('--app-font-size', `${percentage}%`);

  if (prefs.highContrast) {
    root.classList.add('high-contrast');
  } else {
    root.classList.remove('high-contrast');
  }

  if (prefs.reducedMotion) {
    root.classList.add('reduce-motion');
  } else {
    root.classList.remove('reduce-motion');
  }
}

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const [prefs, setPrefs] = useState<AccessibilityPreferences>(() => {
    try {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored) return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
    } catch {}
    return DEFAULT_PREFS;
  });
  const [loading, setLoading] = useState(false);

  // Load from server when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    apiService.getAccessibilityPreferences()
      .then((data) => {
        if (data?.preferences) {
          const merged = { ...DEFAULT_PREFS, ...data.preferences };
          setPrefs(merged);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(merged));
        }
      })
      .catch(() => { /* Non-critical: fall back to local prefs */ })
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  // Apply CSS whenever prefs change
  useEffect(() => {
    applyToDocument(prefs);
  }, [prefs]);

  const updatePrefs = useCallback(async (updates: Partial<AccessibilityPreferences>) => {
    const newPrefs = { ...prefs, ...updates };
    setPrefs(newPrefs);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newPrefs));
    try {
      await apiService.updateAccessibilityPreferences(newPrefs);
    } catch (err) {
      console.error('Failed to save accessibility preferences:', err);
    }
  }, [prefs]);

  return (
    <AccessibilityContext.Provider value={{ prefs, updatePrefs, loading }}>
      {children}
    </AccessibilityContext.Provider>
  );
}
