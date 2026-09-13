import { useState, lazy, Suspense } from 'react';
import { BarChart3, Bot } from 'lucide-react';

const AIInsightsContent = lazy(() => import('./AIInsightsTab').then(m => ({ default: m.AIInsightsTab })));
const PerformanceContent = lazy(() => import('../../components/evm/PerformancePanel').then(m => ({ default: m.PerformancePanel })));

const SUB_TABS = [
  { id: 'performance' as const, label: 'Performance', icon: BarChart3 },
  { id: 'ai' as const, label: 'AI Predictions', icon: Bot },
];

interface InsightsTabProps {
  projectId: string;
  onNavigate: (tab: string) => void;
}

export function InsightsTab({ projectId, onNavigate }: InsightsTabProps) {
  const [subTab, setSubTab] = useState<'performance' | 'ai'>('performance');

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                active
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>}>
        {subTab === 'performance' && <PerformanceContent projectId={projectId} onNavigate={onNavigate} />}
        {subTab === 'ai' && <AIInsightsContent projectId={projectId} />}
      </Suspense>
    </div>
  );
}
