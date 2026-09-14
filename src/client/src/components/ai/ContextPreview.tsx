import React, { useState, useEffect, useCallback } from 'react';
import { apiService } from '../../services/api';
import { Eye, RefreshCw, Building2, FolderOpen, User, Lock } from 'lucide-react';

interface ResolvedEntry {
  value: unknown;
  source: string;
  isLocked: boolean;
}

const SOURCE_LABELS: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  org: { icon: <Building2 className="w-3.5 h-3.5" />, label: 'Organization', color: 'text-blue-600 dark:text-blue-400' },
  project: { icon: <FolderOpen className="w-3.5 h-3.5" />, label: 'Project', color: 'text-green-600 dark:text-green-400' },
  user: { icon: <User className="w-3.5 h-3.5" />, label: 'Personal', color: 'text-purple-600 dark:text-purple-400' },
};

export const ContextPreview: React.FC = () => {
  const [preview, setPreview] = useState('');
  const [resolved, setResolved] = useState<Record<string, ResolvedEntry>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiService.previewAIContext();
      setPreview(res.preview || '(No custom context configured)');
      setResolved(res.resolved || {});
    } catch {
      setPreview('Failed to load context preview.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const entries = Object.entries(resolved);

  return (
    <div className="space-y-4">
      {/* Resolved config breakdown */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Context Preview</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              This shows exactly what context the AI receives for your current session, and which layer each setting comes from.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {entries.length > 0 ? (
          <div className="space-y-3">
            {entries.map(([key, entry]) => {
              const source = SOURCE_LABELS[entry.source] || SOURCE_LABELS.user;
              return (
                <div key={key} className="p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className={`flex items-center gap-1 text-xs ${source.color}`}>
                      {source.icon}
                      {source.label}
                    </span>
                    {entry.isLocked && (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600">
                        <Lock className="w-3 h-3" />
                        Locked
                      </span>
                    )}
                  </div>
                  <pre className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded p-2 max-h-24 overflow-auto">
                    {typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2)}
                  </pre>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">
            No custom context configured. Default AI settings are being used.
          </p>
        )}
      </div>

      {/* Raw prompt preview */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Eye className="w-4 h-4 text-gray-500" />
          <h3 className="text-md font-semibold text-gray-900 dark:text-gray-100">Raw Prompt Injection</h3>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          This is the exact text injected into the AI system prompt based on your resolved configuration.
        </p>
        <pre className="text-xs text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-64 overflow-auto whitespace-pre-wrap font-mono border border-gray-200 dark:border-gray-700">
          {preview || '(empty — no custom context)'}
        </pre>
      </div>
    </div>
  );
};
