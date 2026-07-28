import { create } from 'zustand';
import { setViewPref } from '../hooks/useViewPreferences';

interface ThemeState {
  isDark: boolean;
  toggle: () => void;
  setDark: (dark: boolean, skipSync?: boolean) => void;
}

function applyTheme(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
}

export const useThemeStore = create<ThemeState>((set) => {
  const stored = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = stored ? stored === 'dark' : prefersDark;

  // Apply on init
  if (isDark) document.documentElement.classList.add('dark');

  return {
    isDark,
    toggle: () =>
      set((state) => {
        const newDark = !state.isDark;
        applyTheme(newDark);
        setViewPref('theme', newDark ? 'dark' : 'light');
        return { isDark: newDark };
      }),
    setDark: (dark: boolean, skipSync?: boolean) =>
      set(() => {
        applyTheme(dark);
        if (!skipSync) setViewPref('theme', dark ? 'dark' : 'light');
        return { isDark: dark };
      }),
  };
});
