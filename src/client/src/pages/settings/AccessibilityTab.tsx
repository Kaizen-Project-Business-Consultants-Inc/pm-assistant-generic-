import React, { useState } from 'react';
import { useAccessibility } from '../../contexts/AccessibilityContext';

export const AccessibilityTab: React.FC = () => {
  const { prefs, updatePrefs } = useAccessibility();
  const [saved, setSaved] = useState(false);

  const handleToggle = (key: 'highContrast' | 'reducedMotion' | 'narrationEnabled') => {
    updatePrefs({ [key]: !prefs[key] });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleFontSize = (value: number) => {
    updatePrefs({ fontSize: value });
  };

  const handleSimplification = (level: 'off' | 'mild' | 'strong') => {
    updatePrefs({ simplificationLevel: level });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Visual Preferences</h2>
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">High Contrast</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Increases contrast for better readability</p>
            </div>
            <button
              type="button"
              onClick={() => handleToggle('highContrast')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                prefs.highContrast ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={prefs.highContrast}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs.highContrast ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Reduced Motion</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Minimizes animations and transitions</p>
            </div>
            <button
              type="button"
              onClick={() => handleToggle('reducedMotion')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
                prefs.reducedMotion ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
              }`}
              role="switch"
              aria-checked={prefs.reducedMotion}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs.reducedMotion ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Font Size</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Adjust the base font size across the application ({prefs.fontSize}px)</p>
        <input
          type="range"
          min={12}
          max={24}
          step={1}
          value={prefs.fontSize}
          onChange={(e) => handleFontSize(Number(e.target.value))}
          className="w-full max-w-sm accent-primary-600"
        />
        <div className="flex justify-between text-xs text-gray-400 max-w-sm mt-1">
          <span>12px</span>
          <span>18px</span>
          <span>24px</span>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Text Simplification</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">AI-generated narratives and reports can be simplified for easier reading.</p>
        <div className="flex flex-wrap gap-3">
          {(['off', 'mild', 'strong'] as const).map((level) => (
            <button
              key={level}
              onClick={() => handleSimplification(level)}
              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                prefs.simplificationLevel === level
                  ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300'
              }`}
            >
              {level === 'off' ? 'Off' : level === 'mild' ? 'Mild' : 'Strong'}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">AI Narration</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable Dashboard Narratives</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Show AI-generated plain-language summaries on dashboards</p>
          </div>
          <button
            type="button"
            onClick={() => handleToggle('narrationEnabled')}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              prefs.narrationEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
            }`}
            role="switch"
            aria-checked={prefs.narrationEnabled}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${prefs.narrationEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {saved && (
        <p className="text-sm text-green-600 dark:text-green-400">Preferences saved</p>
      )}
    </div>
  );
};
