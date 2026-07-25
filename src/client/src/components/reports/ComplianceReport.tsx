import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { Shield, CheckCircle, XCircle, Clock, Activity } from 'lucide-react';

interface AuditEntry {
  entryUuid: string;
  action: string;
  actorId: string;
  actorType: string;
  entityType: string;
  entityId: string;
  source: string;
  createdAt: string;
}

interface ChainStatus {
  valid: boolean;
  checkedCount: number;
  brokenAtId?: number;
}

interface PolicyStats {
  total: number;
  allowed: number;
  blocked: number;
  pendingApproval: number;
}

export function ComplianceReport({ projectId }: { projectId: string }) {
  const [days] = useState(30);
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [days]);

  const { data: auditData, isLoading: loadingAudit } = useQuery({
    queryKey: ['audit-trail', projectId, since],
    queryFn: () => apiService.request('get', `/audit/${projectId}?limit=200&since=${since}`),
    enabled: !!projectId,
  });

  const { data: verifyData, isLoading: loadingVerify } = useQuery({
    queryKey: ['audit-verify', projectId],
    queryFn: () => apiService.request('get', `/audit/verify?projectId=${projectId}`),
    enabled: !!projectId,
  });

  const { data: policyStatsData, isLoading: loadingStats } = useQuery({
    queryKey: ['policy-stats', projectId, since],
    queryFn: () => apiService.request('get', `/policies/evaluations/stats?projectId=${projectId}&since=${since}`),
    enabled: !!projectId,
  });

  const entries: AuditEntry[] = auditData?.entries || [];
  const chainStatus: ChainStatus = verifyData || { valid: true, checkedCount: 0 };
  const policyStats: PolicyStats = policyStatsData?.stats || { total: 0, allowed: 0, blocked: 0, pendingApproval: 0 };

  // Aggregate by day for timeline
  const dailyActivity = useMemo(() => {
    const byDay: Record<string, { user: number; api_key: number; system: number }> = {};
    for (const entry of entries) {
      const day = entry.createdAt.slice(0, 10);
      if (!byDay[day]) byDay[day] = { user: 0, api_key: 0, system: 0 };
      const type = entry.actorType as keyof typeof byDay[string];
      if (type in byDay[day]) byDay[day][type]++;
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14);
  }, [entries]);

  const isLoading = loadingAudit || loadingVerify || loadingStats;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const maxDaily = Math.max(1, ...dailyActivity.map(([, d]) => d.user + d.api_key + d.system));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Compliance & Audit</h2>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Chain Integrity */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            {chainStatus.valid ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : (
              <XCircle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Chain Integrity</span>
          </div>
          <p className={`text-lg font-bold ${chainStatus.valid ? 'text-green-600' : 'text-red-600'}`}>
            {chainStatus.valid ? 'VERIFIED' : 'BROKEN'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">{chainStatus.checkedCount} entries checked</p>
        </div>

        {/* Policy Evaluations */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-4 h-4 text-blue-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Policy Evaluations</span>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{policyStats.total}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Last {days} days</p>
        </div>

        {/* Allowed */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Allowed</span>
          </div>
          <p className="text-lg font-bold text-green-600">{policyStats.allowed}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {policyStats.total > 0 ? Math.round((policyStats.allowed / policyStats.total) * 100) : 0}% of total
          </p>
        </div>

        {/* Blocked + Pending */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Blocked / Pending</span>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            <span className="text-red-600">{policyStats.blocked}</span>
            {' / '}
            <span className="text-amber-600">{policyStats.pendingApproval}</span>
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Enforcement actions</p>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Audit Activity (last 14 days)</h3>
        {dailyActivity.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No audit activity</p>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {dailyActivity.map(([day, counts]) => {
              const total = counts.user + counts.api_key + counts.system;
              const pct = (total / maxDaily) * 100;
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                    <div
                      className="w-full bg-primary-500 rounded-t"
                      style={{ height: `${pct}%`, minHeight: total > 0 ? '2px' : '0' }}
                      title={`${day}: ${total} actions (${counts.user} user, ${counts.api_key} API, ${counts.system} system)`}
                    />
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Entries */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm dark:shadow-gray-900/30 border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Recent Audit Entries</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No audit entries</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Time</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actor</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Entity</th>
                  <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Source</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 20).map((entry) => (
                  <tr key={entry.entryUuid} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="py-1.5 px-2 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="py-1.5 px-2">
                      <span className="inline-block px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs font-mono">
                        {entry.action}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-gray-600 dark:text-gray-300 text-xs">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${
                        entry.actorType === 'system' ? 'bg-purple-100 text-purple-700' :
                        entry.actorType === 'api_key' ? 'bg-blue-100 text-blue-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {entry.actorType}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-gray-600 dark:text-gray-300 text-xs font-mono">
                      {entry.entityType}:{entry.entityId.slice(0, 8)}
                    </td>
                    <td className="py-1.5 px-2 text-gray-500 dark:text-gray-400 text-xs">{entry.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
