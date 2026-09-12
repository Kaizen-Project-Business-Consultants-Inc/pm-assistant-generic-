import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Play, ToggleLeft, ToggleRight, Clock, CheckCircle, XCircle, AlertTriangle, BarChart3 } from 'lucide-react';
import { apiService } from '../../services/api';

interface AutomationDetailProps {
  projectId: string;
  automationId: string;
  onBack: () => void;
  onEdit: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
  active: 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
  disabled: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
  error: 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
};

const EXEC_STATUS_ICONS: Record<string, any> = {
  completed: { icon: CheckCircle, color: 'text-green-600' },
  failed: { icon: XCircle, color: 'text-red-600' },
  partial: { icon: AlertTriangle, color: 'text-yellow-600' },
  running: { icon: Clock, color: 'text-blue-600' },
  skipped: { icon: Clock, color: 'text-gray-400' },
};

function formatDate(d: string | null) {
  if (!d) return '-';
  return new Date(d).toLocaleString();
}

function ConditionTraceTree({ node, depth = 0 }: { node: any; depth?: number }) {
  if (node.type === 'rule') {
    return (
      <div className={`flex items-center gap-1.5 text-xs ${depth > 0 ? 'ml-4' : ''}`}>
        {node.passed ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        <span className="font-mono text-gray-700 dark:text-gray-300">{node.field} {node.operator} {node.expectedValue !== undefined ? JSON.stringify(node.expectedValue) : ''}</span>
        <span className="text-gray-400">(actual: {node.actualValue !== undefined ? JSON.stringify(node.actualValue) : 'undefined'})</span>
      </div>
    );
  }
  return (
    <div className={`space-y-1 ${depth > 0 ? 'ml-4 pl-2 border-l-2 border-gray-200 dark:border-gray-600' : ''}`}>
      <div className="flex items-center gap-1.5 text-xs">
        {node.passed ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
        <span className="font-medium text-gray-600 dark:text-gray-400 uppercase">{node.logic}</span>
      </div>
      {node.children?.map((child: any, i: number) => <ConditionTraceTree key={i} node={child} depth={depth + 1} />)}
    </div>
  );
}

export function AutomationDetail({ projectId, automationId, onBack, onEdit }: AutomationDetailProps) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['automation', automationId],
    queryFn: () => apiService.getAutomation(projectId, automationId),
  });

  const { data: execData } = useQuery({
    queryKey: ['automation-executions', automationId],
    queryFn: () => apiService.getAutomationExecutions(projectId, automationId),
    enabled: !!automationId,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['automation-analytics', automationId],
    queryFn: () => apiService.getAutomationAnalytics(projectId, automationId),
    enabled: !!automationId,
  });

  const toggleMutation = useMutation({
    mutationFn: () =>
      automation?.status === 'active'
        ? apiService.disableAutomation(projectId, automationId)
        : apiService.enableAutomation(projectId, automationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', automationId] });
      queryClient.invalidateQueries({ queryKey: ['automations', projectId] });
    },
  });

  const testMutation = useMutation({
    mutationFn: () => apiService.testAutomation(projectId, automationId),
    onSuccess: (data) => setTestResult(data.dryRun),
  });

  const automation = data?.automation;
  const executions: any[] = execData?.executions || [];
  const analytics = analyticsData?.analytics;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!automation) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-500">Automation not found.</p>
        <button onClick={onBack} className="mt-2 text-sm text-primary-600 hover:text-primary-800">Go back</button>
      </div>
    );
  }

  const definition = automation.definition || {};
  const actionsList: any[] = definition.actions || [];
  const conditions = definition.conditions;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{automation.name}</h3>
            {automation.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400">{automation.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {testMutation.isPending ? 'Testing...' : 'Dry Run'}
          </button>
          <button
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          >
            {automation.status === 'active' ? (
              <><ToggleRight className="w-4 h-4 text-green-600" /> Disable</>
            ) : (
              <><ToggleLeft className="w-4 h-4" /> Enable</>
            )}
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Pencil className="w-4 h-4" />
            Edit
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Status</div>
          <div className="mt-1">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[automation.status] || ''}`}>
              {automation.status.charAt(0).toUpperCase() + automation.status.slice(1)}
            </span>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Trigger</div>
          <div className="mt-1">
            <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{automation.triggerEventType}</code>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Total Runs</div>
          <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{automation.triggerCount || 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 uppercase">Last Triggered</div>
          <div className="mt-1 text-sm text-gray-700 dark:text-gray-300">{formatDate(automation.lastTriggeredAt)}</div>
        </div>
      </div>

      {/* Dry Run Result */}
      {testResult && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">Dry Run Result</h4>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            Conditions met: <strong>{testResult.conditionsMet ? 'Yes' : 'No'}</strong>
          </p>
          {testResult.conditionTrace && (
            <div className="mt-3">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">Condition Trace:</p>
              <ConditionTraceTree node={testResult.conditionTrace} />
            </div>
          )}
          {testResult.actionsWouldRun && testResult.actionsWouldRun.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-blue-600 dark:text-blue-400">Actions that would run:</p>
              {testResult.actionsWouldRun.map((a: any, i: number) => (
                <div key={i} className="text-xs bg-blue-100 dark:bg-blue-900/40 rounded px-2 py-1">
                  #{i + 1} {a.type}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Insights / Analytics */}
      {analytics && analytics.totalRuns > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary-600" />
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Insights</h4>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{analytics.totalRuns}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total Runs</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">{analytics.successRate}%</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Success Rate</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900 dark:text-white">{analytics.avgDurationMs}ms</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Avg Duration</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-red-600">{analytics.failureCount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Failures</div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>Success Rate</span>
              <span>{analytics.successCount}/{analytics.totalRuns}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${analytics.successRate}%` }} />
            </div>
          </div>
          {analytics.dailyRuns?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Daily Runs (Last 30 Days)</div>
              <div className="flex items-end gap-px h-12">
                {analytics.dailyRuns.map((d: any) => {
                  const maxCount = Math.max(...analytics.dailyRuns.map((r: any) => r.count));
                  const height = maxCount > 0 ? (d.count / maxCount) * 100 : 0;
                  return (
                    <div key={d.date} className="flex-1 bg-primary-400 dark:bg-primary-600 rounded-t min-w-[2px]" style={{ height: `${Math.max(height, 4)}%` }} title={`${d.date}: ${d.count} runs`} />
                  );
                })}
              </div>
            </div>
          )}
          {analytics.errorPatterns?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Common Errors</div>
              <div className="space-y-1">
                {analytics.errorPatterns.map((e: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
                    <span className="text-red-700 dark:text-red-300 truncate mr-2 font-mono">{e.message}</span>
                    <span className="text-red-500 shrink-0">{e.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Definition */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Configuration</h4>

        {/* Conditions */}
        {conditions && conditions.conditions?.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Conditions ({conditions.logic?.toUpperCase()})</div>
            <div className="space-y-1">
              {conditions.conditions.map((c: any, i: number) => (
                <div key={i} className="text-xs bg-gray-50 dark:bg-gray-700 rounded px-2 py-1">
                  {'field' in c ? `${c.field} ${c.operator} ${c.value ?? ''}` : `Nested group (${c.logic})`}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div>
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Actions ({actionsList.length})</div>
          <div className="space-y-1">
            {actionsList.map((a: any, i: number) => (
              <div key={a.id || i} className="text-xs bg-gray-50 dark:bg-gray-700 rounded px-2 py-1 flex items-center gap-2">
                <span className="text-gray-400">#{i + 1}</span>
                <span className="font-medium">{a.type}</span>
                {a.params?.messageTemplate && (
                  <span className="text-gray-500 truncate">— {a.params.messageTemplate}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Safety */}
        <div className="flex items-center gap-6 text-xs text-gray-500 dark:text-gray-400">
          <span>Max runs/day: {automation.maxRunsPerDay}</span>
          <span>Cooldown: {automation.cooldownSeconds}s</span>
        </div>
      </div>

      {/* Execution History */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-4">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Execution History</h4>
        {executions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No executions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Event</th>
                  <th className="pb-2 text-right">Actions</th>
                  <th className="pb-2 text-right">Duration</th>
                  <th className="pb-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {executions.map((exec: any) => {
                  const statusDef = EXEC_STATUS_ICONS[exec.status] || EXEC_STATUS_ICONS.running;
                  const Icon = statusDef.icon;
                  return (
                    <tr key={exec.id}>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-4 h-4 ${statusDef.color}`} />
                          <span className="text-xs capitalize">{exec.status}</span>
                          {exec.isDryRun ? <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1 rounded">dry</span> : null}
                        </div>
                      </td>
                      <td className="py-2">
                        <code className="text-xs">{exec.eventType}</code>
                      </td>
                      <td className="py-2 text-right text-xs">
                        {exec.actionsExecuted}/{exec.actionsExecuted + exec.actionsFailed}
                        {exec.actionsFailed > 0 && <span className="text-red-500 ml-1">({exec.actionsFailed} failed)</span>}
                      </td>
                      <td className="py-2 text-right text-xs text-gray-500">
                        {exec.durationMs != null ? `${exec.durationMs}ms` : '-'}
                      </td>
                      <td className="py-2 text-right text-xs text-gray-500">
                        {formatDate(exec.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Error */}
      {automation.lastError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-1">Last Error</h4>
          <p className="text-sm text-red-700 dark:text-red-400 font-mono">{automation.lastError}</p>
        </div>
      )}
    </div>
  );
}
