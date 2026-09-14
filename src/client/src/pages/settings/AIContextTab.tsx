import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { apiService } from '../../services/api';
import { MemoryBrowser } from '../../components/ai/MemoryBrowser';
import { DreamingPanel } from '../../components/ai/DreamingPanel';
import { ContextPreview } from '../../components/ai/ContextPreview';
import { Brain, BookOpen, Sparkles, Eye } from 'lucide-react';

type SubTab = 'preferences' | 'memory' | 'dreaming' | 'preview';

const SUB_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'preferences', label: 'AI Preferences', icon: <Brain className="w-4 h-4" /> },
  { id: 'memory', label: 'Memory Browser', icon: <BookOpen className="w-4 h-4" /> },
  { id: 'dreaming', label: 'Dreaming', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'preview', label: 'Context Preview', icon: <Eye className="w-4 h-4" /> },
];

interface ResolvedConfig {
  [key: string]: { value: unknown; source: string; isLocked: boolean };
}

export const AIContextTab: React.FC = () => {
  const { user } = useAuthStore();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('preferences');
  const [config, setConfig] = useState<ResolvedConfig>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Editable fields
  const [systemInstructions, setSystemInstructions] = useState('');
  const [responseTone, setResponseTone] = useState('');
  const [responseLength, setResponseLength] = useState('normal');
  const [responseFormat, setResponseFormat] = useState('prose');
  const [forbiddenTopics, setForbiddenTopics] = useState('');
  const [methodology, setMethodology] = useState('');
  const [temperature, setTemperature] = useState(0.5);

  const loadConfig = useCallback(async () => {
    try {
      const res = await apiService.getResolvedContextConfig();
      setConfig(res.config || {});

      // Populate form fields from resolved config
      const c = res.config || {};
      if (c.system_instructions) setSystemInstructions(String(c.system_instructions.value || ''));
      if (c.response_style) {
        const style = c.response_style.value as any;
        if (style?.tone) setResponseTone(style.tone);
        if (style?.length) setResponseLength(style.length);
        if (style?.format) setResponseFormat(style.format);
      }
      if (c.forbidden_topics) {
        const topics = c.forbidden_topics.value as string[];
        setForbiddenTopics(topics?.join(', ') || '');
      }
      if (c.project_methodology) setMethodology(String(c.project_methodology.value || ''));
      if (c.ai_temperature) setTemperature(Number(c.ai_temperature.value) || 0.5);
    } catch {
      // Config may not exist yet
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      // Save user-scoped configs
      const updates: { key: string; value: unknown }[] = [];

      if (systemInstructions.trim()) {
        updates.push({ key: 'system_instructions', value: systemInstructions.trim() });
      }
      updates.push({
        key: 'response_style',
        value: {
          ...(responseTone && { tone: responseTone }),
          length: responseLength,
          format: responseFormat,
        },
      });
      if (forbiddenTopics.trim()) {
        updates.push({
          key: 'forbidden_topics',
          value: forbiddenTopics.split(',').map(t => t.trim()).filter(Boolean),
        });
      }
      if (methodology.trim()) {
        updates.push({ key: 'project_methodology', value: methodology.trim() });
      }
      updates.push({ key: 'ai_temperature', value: temperature });

      for (const u of updates) {
        await apiService.updateContextConfig('user', user.id, u.key, u.value);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await loadConfig();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  const isAdmin = user && ['admin', 'project_manager', 'pmo'].includes(user.role);

  return (
    <div className="space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-700">
        {SUB_TABS.filter(t => t.id !== 'dreaming' || isAdmin).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === tab.id
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Preferences */}
      {activeSubTab === 'preferences' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Personal AI Preferences</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              These settings customize how Mjuzi responds to you. Your preferences override project and organization defaults (unless locked by an admin).
            </p>

            <div className="space-y-5">
              {/* System Instructions */}
              <div>
                <label htmlFor="system-instructions" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                  Custom Instructions
                </label>
                <textarea
                  id="system-instructions"
                  value={systemInstructions}
                  onChange={e => setSystemInstructions(e.target.value)}
                  maxLength={5000}
                  rows={4}
                  placeholder="E.g., Always respond in French. Focus on risk analysis. Use construction industry terminology."
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400"
                />
                <p className="text-xs text-gray-500 mt-1">{systemInstructions.length}/5000 characters</p>
                {config.system_instructions?.isLocked && (
                  <p className="text-xs text-amber-600 mt-1">This setting is locked by your organization admin.</p>
                )}
              </div>

              {/* Response Style */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="response-tone" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Tone</label>
                  <input
                    id="response-tone"
                    type="text"
                    value={responseTone}
                    onChange={e => setResponseTone(e.target.value)}
                    placeholder="e.g., professional, casual, technical"
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label htmlFor="response-length" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Length</label>
                  <select
                    id="response-length"
                    value={responseLength}
                    onChange={e => setResponseLength(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  >
                    <option value="brief">Brief</option>
                    <option value="normal">Normal</option>
                    <option value="detailed">Detailed</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="response-format" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Format</label>
                  <select
                    id="response-format"
                    value={responseFormat}
                    onChange={e => setResponseFormat(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                  >
                    <option value="prose">Prose</option>
                    <option value="bullets">Bullets</option>
                    <option value="tables">Tables</option>
                  </select>
                </div>
              </div>

              {/* Forbidden Topics */}
              <div>
                <label htmlFor="forbidden-topics" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                  Forbidden Topics
                </label>
                <input
                  id="forbidden-topics"
                  type="text"
                  value={forbiddenTopics}
                  onChange={e => setForbiddenTopics(e.target.value)}
                  placeholder="Comma-separated topics the AI should never discuss"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* Project Methodology */}
              <div>
                <label htmlFor="methodology" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                  Project Methodology
                </label>
                <input
                  id="methodology"
                  type="text"
                  value={methodology}
                  onChange={e => setMethodology(e.target.value)}
                  placeholder="e.g., Agile Scrum, Waterfall, PRINCE2, Kanban"
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
                />
              </div>

              {/* AI Temperature */}
              <div>
                <label htmlFor="ai-temperature" className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                  AI Creativity (Temperature): {temperature.toFixed(2)}
                </label>
                <input
                  id="ai-temperature"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={e => setTemperature(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Precise</span>
                  <span>Balanced</span>
                  <span>Creative</span>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Preferences'}
              </button>
              {saved && <span className="text-sm text-green-600">Saved successfully</span>}
            </div>
          </div>
        </div>
      )}

      {/* Memory Browser */}
      {activeSubTab === 'memory' && <MemoryBrowser />}

      {/* Dreaming */}
      {activeSubTab === 'dreaming' && isAdmin && <DreamingPanel />}

      {/* Context Preview */}
      {activeSubTab === 'preview' && <ContextPreview />}
    </div>
  );
};
