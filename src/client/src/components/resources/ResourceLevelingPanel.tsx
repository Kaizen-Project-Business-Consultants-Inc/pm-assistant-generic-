import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import {
  BarChart3,
  Wand2,
  Check,
  AlertTriangle,
  ArrowRight,
  Loader2,
  UserCheck,
  Shuffle,
} from 'lucide-react';
import { ResourceHistogram } from './ResourceHistogram';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResourceLevelingPanelProps {
  projectId: string;
  scheduleId: string;
}

interface ResourceDemand {
  date: string;
  hours: number;
}

interface ResourceEntry {
  resourceName: string;
  demand: ResourceDemand[];
}

interface OverAllocation {
  resourceName: string;
  date: string;
  demand: number;
  capacity: number;
}

interface HistogramData {
  resources: ResourceEntry[];
  overAllocations: OverAllocation[];
}

interface LevelingAdjustment {
  taskId: string;
  taskName: string;
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  reason: string;
}

interface ReassignmentSuggestion {
  taskId: string;
  taskName: string;
  currentResource: string;
  suggestedResource: string;
  suggestedResourceId: string;
  matchScore: number;
  reason: string;
}

interface NormalizedLevelingResult {
  histogram: HistogramData;
  adjustments: LevelingAdjustment[];
  reassignmentSuggestions: ReassignmentSuggestion[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function normalizeLevelingResult(data: any): NormalizedLevelingResult {
  // Handle both { result: { ... } } and direct shape
  const raw = data?.result || data;
  return {
    histogram: {
      resources: raw.leveledDemand || [],
      overAllocations: raw.overAllocations || [],
    },
    adjustments: raw.adjustedTasks || raw.adjustments || [],
    reassignmentSuggestions: raw.reassignmentSuggestions || [],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResourceLevelingPanel({
  projectId: _projectId,
  scheduleId,
}: ResourceLevelingPanelProps) {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<'before' | 'after'>('before');
  const [levelingResult, setLevelingResult] =
    useState<NormalizedLevelingResult | null>(null);
  const [applied, setApplied] = useState(false);

  // Fetch original histogram data
  const {
    data: rawHistogramData,
    isLoading: histogramLoading,
    isError: histogramError,
  } = useQuery({
    queryKey: ['resourceHistogram', scheduleId],
    queryFn: () => apiService.getResourceHistogram(scheduleId),
  });

  // The API returns { histogram: { resources, overAllocations } }
  const histogramData: HistogramData | null =
    rawHistogramData?.histogram || rawHistogramData || null;

  // Level resources mutation
  const levelMutation = useMutation({
    mutationFn: () => apiService.levelResources(scheduleId),
    onSuccess: (data: any) => {
      setLevelingResult(normalizeLevelingResult(data));
      setActiveView('after');
    },
  });

  // Apply leveling mutation
  const applyMutation = useMutation({
    mutationFn: (adjustments: LevelingAdjustment[]) =>
      apiService.applyResourceLeveling(scheduleId, adjustments),
    onSuccess: () => {
      setApplied(true);
    },
  });

  // Reassign mutation
  const reassignMutation = useMutation({
    mutationFn: ({ taskId, assignedTo }: { taskId: string; assignedTo: string }) =>
      apiService.updateTask(scheduleId, taskId, { assignedTo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resourceHistogram', scheduleId] });
    },
  });

  const hasOverAllocations =
    histogramData && histogramData.overAllocations?.length > 0;

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">
                Resource Leveling
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Analyze resource demand and resolve over-allocations
              </p>
            </div>
          </div>

          {/* Level Resources button */}
          {!applied && (
            <button
              onClick={() => levelMutation.mutate()}
              disabled={
                levelMutation.isPending ||
                histogramLoading ||
                !hasOverAllocations
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {levelMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Leveling...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Level Resources
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Loading state */}
      {histogramLoading && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-primary-500 mr-2" />
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Loading resource histogram…
          </span>
        </div>
      )}

      {/* Error state */}
      {histogramError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          Failed to load resource histogram data. Please try again later.
        </div>
      )}

      {/* Leveling error */}
      {levelMutation.isError && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          Failed to level resources. Please try again.
        </div>
      )}

      {/* No over-allocations message */}
      {histogramData && !hasOverAllocations && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
          <Check className="w-4 h-4" />
          All resources are within capacity. No leveling needed.
        </div>
      )}

      {/* Before / After toggle */}
      {histogramData && levelingResult && (
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveView('before')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeView === 'before'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Before
          </button>
          <button
            onClick={() => setActiveView('after')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeView === 'after'
                ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            After
          </button>
        </div>
      )}

      {/* Histogram chart */}
      {histogramData && (
        <ResourceHistogram
          data={
            activeView === 'after' && levelingResult
              ? levelingResult.histogram
              : histogramData
          }
        />
      )}

      {/* Adjustments table */}
      {levelingResult && levelingResult.adjustments.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Proposed Delay Adjustments
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {levelingResult.adjustments.length} task
              {levelingResult.adjustments.length !== 1 ? 's' : ''} affected
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 uppercase text-xs">
                  <th className="text-left px-3 py-2 font-semibold">
                    Task Name
                  </th>
                  <th className="text-left px-3 py-2 font-semibold">
                    Original Start
                  </th>
                  <th className="text-left px-3 py-2 font-semibold">
                    Original End
                  </th>
                  <th className="text-center px-3 py-2 font-semibold" />
                  <th className="text-left px-3 py-2 font-semibold">
                    New Start
                  </th>
                  <th className="text-left px-3 py-2 font-semibold">
                    New End
                  </th>
                  <th className="text-left px-3 py-2 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {levelingResult.adjustments.map((adj) => (
                  <tr
                    key={adj.taskId}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                      {adj.taskName}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(adj.originalStart)}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(adj.originalEnd)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 inline-block" />
                    </td>
                    <td className="px-3 py-2 text-primary-600 dark:text-primary-400 font-medium whitespace-nowrap">
                      {formatDate(adj.newStart)}
                    </td>
                    <td className="px-3 py-2 text-primary-600 dark:text-primary-400 font-medium whitespace-nowrap">
                      {formatDate(adj.newEnd)}
                    </td>
                    <td
                      className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[180px] truncate"
                      title={adj.reason}
                    >
                      {adj.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Apply button */}
          {!applied && (
            <div className="flex justify-end mt-4">
              <button
                onClick={() =>
                  applyMutation.mutate(levelingResult.adjustments)
                }
                disabled={applyMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {applyMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Apply Leveling
                  </>
                )}
              </button>
            </div>
          )}

          {/* Apply error */}
          {applyMutation.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700 mt-4">
              Failed to apply leveling changes. Please try again.
            </div>
          )}

          {/* Applied success */}
          {applied && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4 text-sm text-green-700 dark:text-green-400 flex items-center gap-2 mt-4">
              <Check className="w-4 h-4" />
              Leveling changes have been applied to the schedule.
            </div>
          )}
        </div>
      )}

      {/* Reassignment Suggestions */}
      {levelingResult && levelingResult.reassignmentSuggestions.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shuffle className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Reassignment Suggestions
            </h3>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {levelingResult.reassignmentSuggestions.length} task
              {levelingResult.reassignmentSuggestions.length !== 1 ? 's' : ''} can be reassigned
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            These tasks remain over-allocated after delay adjustments. Consider reassigning them to reduce contention.
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 text-gray-500 dark:text-gray-400 uppercase text-xs">
                  <th className="text-left px-3 py-2 font-semibold">Task</th>
                  <th className="text-left px-3 py-2 font-semibold">Current</th>
                  <th className="text-center px-3 py-2 font-semibold" />
                  <th className="text-left px-3 py-2 font-semibold">Suggested</th>
                  <th className="text-center px-3 py-2 font-semibold">Match</th>
                  <th className="text-left px-3 py-2 font-semibold">Reason</th>
                  <th className="text-right px-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {levelingResult.reassignmentSuggestions.map((sug) => (
                  <tr key={sug.taskId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                      {sug.taskName}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {sug.currentResource}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 inline-block" />
                    </td>
                    <td className="px-3 py-2 text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap">
                      {sug.suggestedResource}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${
                        sug.matchScore >= 70 ? 'bg-green-500' : sug.matchScore >= 40 ? 'bg-amber-500' : 'bg-gray-400'
                      }`}>
                        {sug.matchScore}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={sug.reason}>
                      {sug.reason}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => reassignMutation.mutate({ taskId: sug.taskId, assignedTo: sug.suggestedResource })}
                        disabled={reassignMutation.isPending}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[11px] font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                      >
                        <UserCheck className="w-3 h-3" />
                        Reassign
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
