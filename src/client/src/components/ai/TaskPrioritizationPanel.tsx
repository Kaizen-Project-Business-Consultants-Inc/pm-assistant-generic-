import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import {
  ListOrdered,
  Bot,
  ChevronDown,
  ChevronUp,
  Check,
  ArrowRight,
  Loader2,
  BarChart3,
  AlertTriangle,
  Clock,
  Target,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriorityFactor {
  factor: string;
  impact: 'high' | 'medium' | 'low';
  description: string;
}

interface PrioritizedTask {
  taskId: string;
  taskName: string;
  currentPriority: string;
  suggestedPriority: string;
  priorityScore: number;
  rank: number;
  factors: PriorityFactor[];
  explanation: string;
}

interface PrioritizationSummary {
  totalTasks: number;
  tasksAnalyzed: number;
  priorityChanges: number;
  criticalPathTasks: number;
  delayedTasks: number;
  averageScore: number;
}

interface PrioritizationResult {
  tasks: PrioritizedTask[];
  summary: PrioritizationSummary;
  aiPowered: boolean;
}

interface TaskPrioritizationPanelProps {
  projectId: string;
  scheduleId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const priorityColors: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
  high: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  medium: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
  low: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
};

const impactColors: Record<string, string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-green-600 dark:text-green-400',
};

function scoreBarColor(score: number): string {
  if (score >= 80) return 'bg-red-500';
  if (score >= 60) return 'bg-orange-500';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-green-500';
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors = priorityColors[priority] || priorityColors.low;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${colors.bg} ${colors.text}`}
    >
      {priority}
    </span>
  );
}

function AIPoweredBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 text-xs font-medium text-primary-600 dark:text-primary-400">
      <Bot className="h-3 w-3" />
      AI Powered
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskPrioritizationPanel({ projectId, scheduleId }: TaskPrioritizationPanelProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [appliedTaskIds, setAppliedTaskIds] = useState<Set<string>>(new Set());
  const [allApplied, setAllApplied] = useState(false);
  const queryClient = useQueryClient();

  // Fetch prioritization data
  const { data, isLoading, error } = useQuery<PrioritizationResult>({
    queryKey: ['taskPrioritization', projectId, scheduleId],
    queryFn: () => apiService.getTaskPrioritization(projectId, scheduleId),
    enabled: !!projectId && !!scheduleId,
  });

  // Apply single priority mutation
  const applyMutation = useMutation({
    mutationFn: ({ taskId, priority }: { taskId: string; priority: string }) =>
      apiService.applyTaskPriority(projectId, scheduleId, taskId, priority),
    onSuccess: (_data, variables) => {
      setAppliedTaskIds((prev) => new Set(prev).add(variables.taskId));
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Apply all priorities mutation
  const applyAllMutation = useMutation({
    mutationFn: (changes: Array<{ taskId: string; priority: string }>) =>
      apiService.applyAllTaskPriorities(projectId, scheduleId, changes),
    onSuccess: () => {
      setAllApplied(true);
      const allIds = new Set(
        changesNeeded.map((t) => t.taskId),
      );
      setAppliedTaskIds((prev) => new Set([...prev, ...allIds]));
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const toggleExpand = (taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const tasks = data?.tasks || [];
  const summary = data?.summary;
  const aiPowered = data?.aiPowered ?? false;

  // Tasks that have a different suggested priority
  const changesNeeded = tasks.filter(
    (t) => t.currentPriority !== t.suggestedPriority && !appliedTaskIds.has(t.taskId),
  );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-5 w-5 text-primary-500 dark:text-primary-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AI Task Prioritization</h3>
        </div>
        {aiPowered && <AIPoweredBadge />}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>Failed to load task prioritization. Please try again later.</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && tasks.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No active tasks to prioritize.</p>
      )}

      {/* Content */}
      {!isLoading && !error && summary && tasks.length > 0 && (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <BarChart3 className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium">Analyzed</p>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{summary.tasksAnalyzed}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium">Changes</p>
              </div>
              <p className="text-lg font-bold text-primary-600 dark:text-primary-400">{summary.priorityChanges}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Target className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium">Avg Score</p>
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{summary.averageScore}</p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Clock className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <p className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium">Critical Path</p>
              </div>
              <p className="text-lg font-bold text-red-600 dark:text-red-400">{summary.criticalPathTasks}</p>
            </div>
          </div>

          {/* Ranked Task List */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {tasks.map((task) => {
              const isExpanded = expandedTaskId === task.taskId;
              const isApplied = appliedTaskIds.has(task.taskId) || allApplied;
              const hasChange = task.currentPriority !== task.suggestedPriority;

              return (
                <div
                  key={task.taskId}
                  className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 transition-colors"
                >
                  {/* Main Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Rank Badge */}
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center">
                      <span className="text-xs font-bold text-primary-700 dark:text-primary-400">#{task.rank}</span>
                    </div>

                    {/* Task Name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 dark:text-white truncate block">
                        {task.taskName}
                      </span>
                    </div>

                    {/* Score Bar */}
                    <div className="flex items-center gap-2 flex-shrink-0 w-28">
                      <div className="flex-1 h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${scoreBarColor(task.priorityScore)}`}
                          style={{ width: `${task.priorityScore}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 w-7 text-right">
                        {task.priorityScore}
                      </span>
                    </div>

                    {/* Priority Badges */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <PriorityBadge priority={task.currentPriority} />
                      {hasChange && (
                        <>
                          <ArrowRight className="h-3 w-3 text-gray-400" />
                          <PriorityBadge priority={task.suggestedPriority} />
                        </>
                      )}
                    </div>

                    {/* Apply Button */}
                    {hasChange && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isApplied) {
                            applyMutation.mutate({
                              taskId: task.taskId,
                              priority: task.suggestedPriority,
                            });
                          }
                        }}
                        disabled={isApplied || applyMutation.isPending}
                        className={`flex-shrink-0 p-1.5 rounded-md transition-colors ${
                          isApplied
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 cursor-default'
                            : 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 hover:bg-primary-200 dark:hover:bg-primary-900/50'
                        }`}
                        title={isApplied ? 'Applied' : 'Apply this priority change'}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {/* Expand Toggle */}
                    <button
                      onClick={() => toggleExpand(task.taskId)}
                      className="flex-shrink-0 p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-gray-700">
                      {/* Factors */}
                      {task.factors.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                            Priority Factors
                          </p>
                          <div className="space-y-1">
                            {task.factors.map((factor, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-2 text-xs"
                              >
                                <span
                                  className={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
                                    factor.impact === 'high'
                                      ? 'bg-red-500'
                                      : factor.impact === 'medium'
                                      ? 'bg-yellow-500'
                                      : 'bg-green-500'
                                  }`}
                                />
                                <div>
                                  <span className={`font-medium ${impactColors[factor.impact] || 'text-gray-600 dark:text-gray-400'}`}>
                                    {factor.factor}
                                  </span>
                                  <span className="text-gray-500 dark:text-gray-400"> — {factor.description}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Explanation */}
                      <div className="rounded-md bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800 p-3">
                        <p className="text-xs uppercase font-semibold text-primary-500 dark:text-primary-400 mb-1">
                          {aiPowered ? 'AI Explanation' : 'Analysis'}
                        </p>
                        <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                          {task.explanation}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Apply All Button */}
          {changesNeeded.length > 0 && !allApplied && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() =>
                  applyAllMutation.mutate(
                    changesNeeded.map((t) => ({
                      taskId: t.taskId,
                      priority: t.suggestedPriority,
                    })),
                  )
                }
                disabled={applyAllMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {applyAllMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Apply All {changesNeeded.length} Change{changesNeeded.length !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          )}

          {/* All Applied Confirmation */}
          {allApplied && (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-sm text-green-700 dark:text-green-400">
              <Check className="w-4 h-4" />
              All priority changes have been applied.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
