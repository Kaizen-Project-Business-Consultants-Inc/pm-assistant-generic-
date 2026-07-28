import React, { useState } from 'react';
import { Moon, Sun, Save } from 'lucide-react';
import { apiService } from '../../services/api';
import { getTimezones } from '../../utils/dateFormat';
import { useLocaleStore } from '../../stores/localeStore';

interface DisplayPreferences {
  theme: 'light' | 'dark';
  defaultView: 'gantt' | 'kanban' | 'table' | 'calendar';
  sidebarExpanded: boolean;
  timezone: string;
  language: string;
}

const DISPLAY_STORAGE_KEY = 'pm-settings-display';

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Fran\u00e7ais' },
  { value: 'es', label: 'Espa\u00f1ol' },
];

function loadDisplayPrefs(): DisplayPreferences {
  try {
    const stored = localStorage.getItem(DISPLAY_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return {
    theme: 'light',
    defaultView: 'gantt',
    sidebarExpanded: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    language: localStorage.getItem('pm-locale') || 'en',
  };
}

export const DisplayTab: React.FC = () => {
  const [prefs, setPrefs] = useState<DisplayPreferences>(loadDisplayPrefs);
  const [saved, setSaved] = useState(false);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const timezones = getTimezones();

  const handleSave = async () => {
    localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(prefs));
    setLocale(prefs.language);
    try {
      await apiService.updateUserPreferences({ timezone: prefs.timezone, locale: prefs.language });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save preferences to server:', err);
    }
  };

  const viewOptions: { value: DisplayPreferences['defaultView']; label: string }[] = [
    { value: 'gantt', label: 'Gantt' },
    { value: 'kanban', label: 'Kanban' },
    { value: 'table', label: 'Table' },
    { value: 'calendar', label: 'Calendar' },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Theme</h2>
        <div className="flex gap-3">
          <button onClick={() => setPrefs((p) => ({ ...p, theme: 'light' }))} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${prefs.theme === 'light' ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
            <Sun className="w-4 h-4" /> Light
          </button>
          <button onClick={() => setPrefs((p) => ({ ...p, theme: 'dark' }))} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${prefs.theme === 'dark' ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
            <Moon className="w-4 h-4" /> Dark
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Default View</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Choose the default view when opening a project schedule.</p>
        <div className="flex flex-wrap gap-3">
          {viewOptions.map((opt) => (
            <button key={opt.value} onClick={() => setPrefs((p) => ({ ...p, defaultView: opt.value }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${prefs.defaultView === opt.value ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Sidebar</h2>
        <div className="flex gap-3">
          <button onClick={() => setPrefs((p) => ({ ...p, sidebarExpanded: true }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${prefs.sidebarExpanded ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>Expanded</button>
          <button onClick={() => setPrefs((p) => ({ ...p, sidebarExpanded: false }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${!prefs.sidebarExpanded ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>Collapsed</button>
        </div>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Time Zone</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">All dates and times will be displayed in this time zone.</p>
        <select
          value={prefs.timezone}
          onChange={(e) => setPrefs((p) => ({ ...p, timezone: e.target.value }))}
          className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 dark:text-gray-100 max-w-md w-full"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Language</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Choose your preferred language for the interface.</p>
        <div className="flex flex-wrap gap-3">
          {LANGUAGE_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setPrefs((p) => ({ ...p, language: opt.value }))} className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${prefs.language === opt.value ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-primary-700 transition-colors">
          <Save className="w-4 h-4" /> Save Preferences
        </button>
        {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved successfully</span>}
      </div>
    </div>
  );
};
