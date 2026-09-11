import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, Copy, Calendar, TrendingUp, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/api';

interface TimeAnomaly {
  id: string;
  type: 'excessive_hours' | 'duplicate_entry' | 'weekend_work' | 'over_estimate' | 'missing_hours';
  severity: 'high' | 'medium' | 'low';
  userId: string;
  userName?: string;
  taskId?: string;
  taskName?: string;
  date: string;
  message: string;
  details: Record<string, any>;
}

const SEVERITY_STYLES = {
  high: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300',
  medium: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
  low: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
};

const SEVERITY_BADGE = {
  high: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  medium: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  low: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  excessive_hours: <Clock className="w-4 h-4" />,
  duplicate_entry: <Copy className="w-4 h-4" />,
  weekend_work: <Calendar className="w-4 h-4" />,
  over_estimate: <TrendingUp className="w-4 h-4" />,
  missing_hours: <AlertCircle className="w-4 h-4" />,
};

const TYPE_LABELS: Record<string, string> = {
  excessive_hours: 'Excessive Hours',
  duplicate_entry: 'Duplicate Entry',
  weekend_work: 'Weekend Work',
  over_estimate: 'Over Estimate',
  missing_hours: 'Missing Hours',
};

export function TimeAnomalyPanel({ projectId }: { projectId: string }) {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['time-anomalies', projectId],
    queryFn: () => apiService.getTimeAnomalies(projectId),
    staleTime: 5 * 60_000,
  });

  const anomalies: TimeAnomaly[] = (data?.anomalies || []).filter(
    (a: TimeAnomaly) => !dismissed.has(a.id)
  );

  if (isLoading || anomalies.length === 0) return null;

  const highCount = anomalies.filter(a => a.severity === 'high').length;
  const mediumCount = anomalies.filter(a => a.severity === 'medium').length;
  const lowCount = anomalies.filter(a => a.severity === 'low').length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            Time Anomalies
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({anomalies.length})
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            {highCount > 0 && (
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${SEVERITY_BADGE.high}`}>
                {highCount} high
              </span>
            )}
            {mediumCount > 0 && (
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${SEVERITY_BADGE.medium}`}>
                {mediumCount} medium
              </span>
            )}
            {lowCount > 0 && (
              <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${SEVERITY_BADGE.low}`}>
                {lowCount} low
              </span>
            )}
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
          {anomalies.map(anomaly => (
            <div
              key={anomaly.id}
              className={`flex items-start gap-3 px-5 py-3 border-l-4 ${SEVERITY_STYLES[anomaly.severity]}`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {TYPE_ICONS[anomaly.type]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide opacity-75">
                    {TYPE_LABELS[anomaly.type]}
                  </span>
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${SEVERITY_BADGE[anomaly.severity]}`}>
                    {anomaly.severity}
                  </span>
                </div>
                <p className="text-sm mt-0.5">{anomaly.message}</p>
              </div>
              <button
                onClick={() => setDismissed(prev => new Set(prev).add(anomaly.id))}
                className="flex-shrink-0 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
