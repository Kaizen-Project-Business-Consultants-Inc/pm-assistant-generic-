import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { AdminPageWrapper } from './AdminPageWrapper';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  RefreshCw,
  ArrowUpDown,
  Users,
  Building2,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Brain,
  Server,
  Shield,
  Clock,
  Database,
  Mail,
  Activity,
  Bot,
  Webhook,
  CheckCircle,
  XCircle,
  AlertOctagon,
} from 'lucide-react';

interface SystemData {
  uptime: number;
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number; percentUsed: number; osTotalMB: number; osUsedMB: number; osAvailableMB: number; osPercent: number };
  swap: { usedMB: number; totalMB: number; percentUsed: number } | null;
  cpu: { userPercent: number; systemPercent: number };
  db: { poolActive: number; poolIdle: number; poolTotal: number; poolWaiting: number; latencyP50: number; latencyP95: number; latencyP99: number; totalQueries: number };
  redis: { connected: boolean; memoryUsedMB: number | null };
  api: { totalRequests: number; activeRequests: number; p50Ms: number; p95Ms: number; p99Ms: number; errorRate5xx: number };
  ai: { totalRequests: number; inputTokens: number; outputTokens: number; budgetUsedPercent: number; costThisMonth: number; monthlyBudget: number };
  disk: { usedGB: number; totalGB: number; percentUsed: number } | null;
}

interface Warning {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  advice: string;
}

interface TenantRow {
  id: string; name: string; slug: string;
  totalUsers: number; activeUsers: number;
  apiRequestsToday: number; apiRequestsWeek: number;
  aiTokensThisMonth: number; aiCostThisMonth: number;
  projectCount: number; taskCount: number;
  storageRows: number; lastActive: string | null;
}

interface DrilldownData {
  roleBreakdown: { role: string; count: number }[];
  aiDailyUsage: { date: string; requests: number; inputTokens: number; outputTokens: number; cost: number }[];
  headroom: {
    osTotalMB: number; osUsedMB: number; osAvailableMB: number;
    heapUsedMB: number; rssMB: number;
    perUserEstimateMB: number; estimatedHeadroom: number;
  };
}

interface SecurityStats {
  deactivatedAccounts: number; activeApiKeys: number; totalApiKeys: number;
  recentLogins24h: number; usersNeverLoggedIn: number;
}

interface CronJob {
  name: string; status: string; durationMs: number | null; finishedAt: string | null;
}

interface DbTable { tableName: string; rows: number; sizeMB: number; }

interface EmailStats { sentThisMonth: number; failedThisMonth: number; }

interface UserActivityData {
  dau: number; wau: number; mau: number;
  lastSeenUsers: { username: string; fullName: string; lastLogin: string }[];
}

interface AgentPerfRow { agentId: string; totalRuns: number; lastRun: string | null; }

interface WebhookStatsData {
  totalDeliveries: number; successDeliveries: number; failedDeliveries: number;
  dlqPending: number; dlqFailed: number; dlqResolved: number;
}

interface OperationsData {
  system: SystemData;
  summary: { totalTenants: number; totalUsers: number; estimatedHeadroom: number };
  drilldown: DrilldownData;
  warnings: Warning[];
  tenants: TenantRow[];
  security: SecurityStats;
  cronJobs: CronJob[];
  dbGrowth: DbTable[];
  emailStats: EmailStats;
  userActivity: UserActivityData;
  agentPerf: AgentPerfRow[];
  webhookStats: WebhookStatsData;
}

type DrilldownPanel = 'ai' | 'tenants' | 'users' | 'headroom' | null;

function getGaugeColor(percent: number): { stroke: string; text: string; border: string; bg: string; glow: string } {
  if (percent > 90) return { stroke: '#ef4444', text: 'text-red-600 dark:text-red-400', border: 'border-red-300 dark:border-red-800', bg: 'bg-red-50 dark:bg-red-900/10', glow: 'shadow-red-200/50 dark:shadow-red-900/30' };
  if (percent > 70) return { stroke: '#f59e0b', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-300 dark:border-amber-800', bg: 'bg-amber-50 dark:bg-amber-900/10', glow: 'shadow-amber-200/50 dark:shadow-amber-900/30' };
  return { stroke: '#10b981', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-300 dark:border-emerald-800', bg: 'bg-emerald-50/50 dark:bg-emerald-900/5', glow: '' };
}

function RadialGauge({ percent, size = 72, strokeWidth = 6 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(percent, 100) / 100) * circumference;
  const { stroke } = getGaugeColor(percent);

  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-gray-200 dark:text-gray-700" />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none"
        stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
}

function GaugeCard({ label, value, max, unit, percent }: { label: string; value: string; max?: string; unit?: string; percent: number }) {
  const colors = getGaugeColor(percent);

  return (
    <div className={`${colors.bg} rounded-xl border ${colors.border} p-4 shadow-sm ${colors.glow} transition-all`}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <RadialGauge percent={percent} />
          <span className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${colors.text} rotate-0`}>
            {Math.round(percent)}%
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
          <p className={`text-lg font-bold mt-0.5 ${colors.text}`}>
            {value}{unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
          </p>
          {max && <p className="text-xs text-gray-400 dark:text-gray-500">of {max}</p>}
        </div>
      </div>
    </div>
  );
}

function WarningBanner({ warning }: { warning: Warning }) {
  const styles = {
    critical: { bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', icon: AlertCircle, iconColor: 'text-red-600 dark:text-red-400', badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
    warning: { bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800', icon: AlertTriangle, iconColor: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
    info: { bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', icon: Info, iconColor: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  };
  const s = styles[warning.severity];
  const Icon = s.icon;

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${s.bg}`}>
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${s.iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${s.badge}`}>{warning.severity.toUpperCase()}</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{warning.title}</span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{warning.message}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 italic">{warning.advice}</p>
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function AdminOperationsPage() {
  const [sortCol, setSortCol] = useState<keyof TenantRow>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [expandedPanel, setExpandedPanel] = useState<DrilldownPanel>(null);

  const togglePanel = (panel: DrilldownPanel) => setExpandedPanel(prev => prev === panel ? null : panel);

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery<OperationsData>({
    queryKey: ['admin-operations'],
    queryFn: () => apiService.getAdminOperations(),
    refetchInterval: 30_000,
  });

  const handleSort = (col: keyof TenantRow) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortedTenants = React.useMemo(() => {
    if (!data?.tenants) return [];
    return [...data.tenants].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [data?.tenants, sortCol, sortDir]);

  return (
    <AdminPageWrapper title="Operations Dashboard" subtitle="Real-time system health, warnings, and tenant usage">
      {/* Header with refresh info */}
      <div className="flex items-center justify-between mb-6">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {dataUpdatedAt ? `Last updated: ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''} &middot; Auto-refresh: 30s
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {isLoading && <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading operations data…</div>}
      {error && <div className="text-center py-12 text-red-500">Failed to load operations data.</div>}

      {data && (
        <>
          {/* Warnings */}
          {data.warnings.length > 0 && (
            <div className="mb-6 space-y-2">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">Warnings</h2>
              {data.warnings.map((w, i) => <WarningBanner key={i} warning={w} />)}
            </div>
          )}

          {/* Capacity Summary — clickable cards with drill-down panels */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">Capacity Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* AI Budget */}
              <button onClick={() => togglePanel('ai')} className="text-left w-full">
                <div className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 border-l-pink-500 border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${expandedPanel === 'ai' ? 'ring-2 ring-pink-400' : ''}`}>
                  <div className="p-2.5 bg-pink-100 dark:bg-pink-900/40 rounded-full"><Brain className="w-5 h-5 text-pink-600 dark:text-pink-400" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400">AI Budget</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-white">${data.system.ai.costThisMonth.toFixed(2)}</p>
                    <p className="text-xs text-gray-400">{data.system.ai.budgetUsedPercent.toFixed(0)}% of ${data.system.ai.monthlyBudget.toFixed(0)}</p>
                  </div>
                  {expandedPanel === 'ai' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>
              {/* Tenants */}
              <button onClick={() => togglePanel('tenants')} className="text-left w-full">
                <div className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 border-l-blue-500 border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${expandedPanel === 'tenants' ? 'ring-2 ring-blue-400' : ''}`}>
                  <div className="p-2.5 bg-blue-100 dark:bg-blue-900/40 rounded-full"><Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Tenants</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.summary.totalTenants}</p>
                  </div>
                  {expandedPanel === 'tenants' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>
              {/* Total Users */}
              <button onClick={() => togglePanel('users')} className="text-left w-full">
                <div className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 border-l-purple-500 border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${expandedPanel === 'users' ? 'ring-2 ring-purple-400' : ''}`}>
                  <div className="p-2.5 bg-purple-100 dark:bg-purple-900/40 rounded-full"><Users className="w-5 h-5 text-purple-600 dark:text-purple-400" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Total Users</p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.summary.totalUsers}</p>
                  </div>
                  {expandedPanel === 'users' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>
              {/* Headroom */}
              <button onClick={() => togglePanel('headroom')} className="text-left w-full">
                <div className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 border-l-emerald-500 border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer ${expandedPanel === 'headroom' ? 'ring-2 ring-emerald-400' : ''}`}>
                  <div className="p-2.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-full"><TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Headroom</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">~{data.summary.estimatedHeadroom} <span className="text-sm font-normal">users</span></p>
                  </div>
                  {expandedPanel === 'headroom' ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>
            </div>

            {/* Drill-down Panels */}
            {expandedPanel && data.drilldown && (
              <div className="mt-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm animate-in fade-in duration-200">
                {/* AI Budget Drill-down */}
                {expandedPanel === 'ai' && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                      <Brain className="w-4 h-4 text-pink-500" /> AI Budget Breakdown
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Total Requests</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{data.system.ai.totalRequests.toLocaleString()}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Input Tokens</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{(data.system.ai.inputTokens / 1000).toFixed(1)}k</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Output Tokens</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{(data.system.ai.outputTokens / 1000).toFixed(1)}k</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Budget Remaining</p>
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">${(data.system.ai.monthlyBudget - data.system.ai.costThisMonth).toFixed(2)}</p>
                      </div>
                    </div>
                    {/* Daily usage mini chart */}
                    {data.drilldown.aiDailyUsage.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Daily Cost This Month</p>
                        <div className="flex items-end gap-1 h-24">
                          {data.drilldown.aiDailyUsage.map((d, i) => {
                            const maxCost = Math.max(...data.drilldown.aiDailyUsage.map(x => x.cost), 0.001);
                            const heightPct = (d.cost / maxCost) * 100;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center group relative">
                                <div
                                  className="w-full bg-pink-400 dark:bg-pink-500 rounded-t hover:bg-pink-500 dark:hover:bg-pink-400 transition-colors"
                                  style={{ height: `${Math.max(heightPct, 2)}%` }}
                                  title={`${d.date}: $${d.cost.toFixed(4)} (${d.requests} reqs)`}
                                />
                                {/* Tooltip on hover */}
                                <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                                  {d.date.slice(5)}: ${d.cost.toFixed(4)}
                                  <br />{d.requests} reqs, {((d.inputTokens + d.outputTokens) / 1000).toFixed(1)}k tok
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>{data.drilldown.aiDailyUsage[0]?.date.slice(5)}</span>
                          <span>{data.drilldown.aiDailyUsage[data.drilldown.aiDailyUsage.length - 1]?.date.slice(5)}</span>
                        </div>
                      </div>
                    )}
                    {/* Per-tenant AI cost */}
                    {data.tenants.length > 1 && (
                      <div className="mt-4">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">AI Cost per Tenant</p>
                        <div className="space-y-1.5">
                          {data.tenants.filter(t => t.aiCostThisMonth > 0).sort((a, b) => b.aiCostThisMonth - a.aiCostThisMonth).map(t => {
                            const pct = data.system.ai.costThisMonth > 0 ? (t.aiCostThisMonth / data.system.ai.costThisMonth) * 100 : 0;
                            return (
                              <div key={t.id} className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 dark:text-gray-300 w-28 truncate">{t.name}</span>
                                <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                  <div className="h-full bg-pink-400 dark:bg-pink-500 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-16 text-right">${t.aiCostThisMonth.toFixed(4)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tenants Drill-down */}
                {expandedPanel === 'tenants' && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-blue-500" /> Tenant Details
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Tenant</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Users</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Active</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Projects</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Tasks</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">AI Tokens</th>
                            <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">AI Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.tenants.map(t => (
                            <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700/50">
                              <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{t.name}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{t.totalUsers}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{t.activeUsers}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{t.projectCount}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{t.taskCount}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{t.aiTokensThisMonth.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">${t.aiCostThisMonth.toFixed(4)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                            <td className="px-3 py-2 text-gray-900 dark:text-white">Totals</td>
                            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{data.tenants.reduce((s, t) => s + t.totalUsers, 0)}</td>
                            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{data.tenants.reduce((s, t) => s + t.activeUsers, 0)}</td>
                            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{data.tenants.reduce((s, t) => s + t.projectCount, 0)}</td>
                            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{data.tenants.reduce((s, t) => s + t.taskCount, 0)}</td>
                            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{data.tenants.reduce((s, t) => s + t.aiTokensThisMonth, 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-gray-900 dark:text-white">${data.tenants.reduce((s, t) => s + t.aiCostThisMonth, 0).toFixed(4)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* Users Drill-down */}
                {expandedPanel === 'users' && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-500" /> Users by Role
                    </h3>
                    {data.drilldown.roleBreakdown.length > 0 ? (
                      <div className="space-y-2">
                        {data.drilldown.roleBreakdown.map(r => {
                          const pct = data.summary.totalUsers > 0 ? (r.count / data.summary.totalUsers) * 100 : 0;
                          return (
                            <div key={r.role} className="flex items-center gap-3">
                              <span className="text-sm text-gray-700 dark:text-gray-300 w-36 capitalize">{r.role.replace(/_/g, ' ')}</span>
                              <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-purple-400 dark:bg-purple-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-10 text-right">{r.count}</span>
                              <span className="text-xs text-gray-400 w-12 text-right">{pct.toFixed(0)}%</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No role data available.</p>
                    )}
                  </div>
                )}

                {/* Headroom Drill-down */}
                {expandedPanel === 'headroom' && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                      <Server className="w-4 h-4 text-emerald-500" /> Capacity Estimate Breakdown
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">OS Total RAM</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{data.drilldown.headroom.osTotalMB} MB</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">OS Used</p>
                        <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{data.drilldown.headroom.osUsedMB} MB</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">OS Available</p>
                        <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{data.drilldown.headroom.osAvailableMB} MB</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Node.js Heap</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{data.drilldown.headroom.heapUsedMB.toFixed(0)} MB</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Node.js RSS</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{data.drilldown.headroom.rssMB.toFixed(0)} MB</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Per-User Estimate</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">~{data.drilldown.headroom.perUserEstimateMB} MB</p>
                      </div>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
                      <p className="text-sm text-gray-700 dark:text-gray-300">
                        <span className="font-semibold">Formula:</span>{' '}
                        Available RAM ({data.drilldown.headroom.osAvailableMB} MB) &divide; Per-user estimate ({data.drilldown.headroom.perUserEstimateMB} MB) ={' '}
                        <span className="font-bold text-emerald-700 dark:text-emerald-400">~{data.drilldown.headroom.estimatedHeadroom} additional concurrent users</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Based on average memory footprint per concurrent session (DB connections, request buffers, session state).
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* System Health Gauges */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">System Health</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <GaugeCard
                label="Node.js Heap"
                value={data.system.memory.heapUsedMB.toFixed(0)}
                max={`${data.system.memory.heapTotalMB.toFixed(0)} MB`}
                unit="MB"
                percent={data.system.memory.percentUsed}
              />
              <GaugeCard
                label="CPU"
                value={(data.system.cpu.userPercent + data.system.cpu.systemPercent).toFixed(1)}
                unit="%"
                percent={data.system.cpu.userPercent + data.system.cpu.systemPercent}
              />
              <GaugeCard
                label="DB Pool"
                value={`${data.system.db.poolActive}`}
                max={`${data.system.db.poolTotal}`}
                percent={data.system.db.poolTotal > 0 ? (data.system.db.poolActive / data.system.db.poolTotal) * 100 : 0}
              />
              <GaugeCard
                label="API p99 Latency"
                value={`${data.system.api.p99Ms}`}
                unit="ms"
                percent={Math.min((data.system.api.p99Ms / 5000) * 100, 100)}
              />
              <GaugeCard
                label="5xx Error Rate"
                value={`${data.system.api.errorRate5xx}`}
                unit="%"
                percent={Math.min(data.system.api.errorRate5xx * 10, 100)}
              />
              <GaugeCard
                label="Redis"
                value={data.system.redis.connected ? (data.system.redis.memoryUsedMB?.toFixed(1) || 'OK') : 'Down'}
                unit={data.system.redis.connected && data.system.redis.memoryUsedMB ? 'MB' : ''}
                percent={data.system.redis.connected ? 20 : 100}
              />
              <GaugeCard
                label="AI Budget"
                value={`$${data.system.ai.costThisMonth.toFixed(2)}`}
                max={`$${data.system.ai.monthlyBudget}`}
                percent={data.system.ai.budgetUsedPercent}
              />
              {data.system.disk && (
                <GaugeCard
                  label="Disk"
                  value={data.system.disk.usedGB.toFixed(1)}
                  max={`${data.system.disk.totalGB.toFixed(1)} GB`}
                  unit="GB"
                  percent={data.system.disk.percentUsed}
                />
              )}
              {data.system.swap && (
                <GaugeCard
                  label="Swap"
                  value={`${data.system.swap.usedMB}`}
                  max={`${data.system.swap.totalMB} MB`}
                  unit="MB"
                  percent={data.system.swap.percentUsed}
                />
              )}
            </div>
            {/* Extra stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              {[
                { label: 'Uptime', value: formatUptime(data.system.uptime), color: 'border-l-sky-500' },
                { label: 'Total Requests', value: data.system.api.totalRequests.toLocaleString(), color: 'border-l-indigo-500' },
                { label: 'DB Queries', value: data.system.db.totalQueries.toLocaleString(), color: 'border-l-violet-500' },
                { label: 'AI Requests', value: data.system.ai.totalRequests.toLocaleString(), color: 'border-l-pink-500' },
              ].map((s) => (
                <div key={s.label} className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 ${s.color} border border-gray-200 dark:border-gray-700 p-3 shadow-sm`}>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section: Security & Auth ── */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4" /> Security & Auth
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Logins (24h)', value: data.security.recentLogins24h, color: 'border-l-emerald-500', icon: CheckCircle, iconColor: 'text-emerald-500' },
                { label: 'Active API Keys', value: `${data.security.activeApiKeys}/${data.security.totalApiKeys}`, color: 'border-l-blue-500', icon: Shield, iconColor: 'text-blue-500' },
                { label: 'Deactivated', value: data.security.deactivatedAccounts, color: data.security.deactivatedAccounts > 0 ? 'border-l-amber-500' : 'border-l-gray-300', icon: XCircle, iconColor: data.security.deactivatedAccounts > 0 ? 'text-amber-500' : 'text-gray-400' },
                { label: 'Never Logged In', value: data.security.usersNeverLoggedIn, color: data.security.usersNeverLoggedIn > 0 ? 'border-l-amber-500' : 'border-l-gray-300', icon: AlertOctagon, iconColor: data.security.usersNeverLoggedIn > 0 ? 'text-amber-500' : 'text-gray-400' },
              ].map(s => (
                <div key={s.label} className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 ${s.color} border border-gray-200 dark:border-gray-700 p-3 shadow-sm`}>
                  <div className="flex items-center gap-2 mb-1">
                    <s.icon className={`w-4 h-4 ${s.iconColor}`} />
                    <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  </div>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Section: Cron / Background Jobs ── */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Cron / Background Jobs
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Job</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Duration</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 uppercase">Last Run</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cronJobs.map(job => {
                    const statusColor = job.status === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : job.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-gray-400';
                    const statusBg = job.status === 'ok' ? 'bg-emerald-100 dark:bg-emerald-900/40' : job.status === 'failed' ? 'bg-red-100 dark:bg-red-900/40' : 'bg-gray-100 dark:bg-gray-700';
                    return (
                      <tr key={job.name} className="border-b border-gray-100 dark:border-gray-700/50">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white font-mono text-xs">{job.name}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusBg} ${statusColor}`}>
                            {job.status === 'ok' ? <CheckCircle className="w-3 h-3" /> : job.status === 'failed' ? <XCircle className="w-3 h-3" /> : null}
                            {job.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300 text-xs">{job.durationMs != null ? `${(job.durationMs / 1000).toFixed(1)}s` : '--'}</td>
                        <td className="px-3 py-2 text-right text-gray-500 dark:text-gray-400 text-xs">{job.finishedAt ? new Date(job.finishedAt).toLocaleString() : 'Never'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section: Database Growth ── */}
          {data.dbGrowth.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Database className="w-4 h-4" /> Database Growth
                <span className="text-xs font-normal text-gray-400 ml-auto">
                  Total: {data.dbGrowth.reduce((s, t) => s + t.sizeMB, 0).toFixed(1)} MB across {data.dbGrowth.length} tables
                </span>
              </h2>
              <div className="space-y-1.5">
                {data.dbGrowth.slice(0, 15).map(t => {
                  const maxSize = Math.max(...data.dbGrowth.map(x => x.sizeMB), 0.01);
                  const pct = (t.sizeMB / maxSize) * 100;
                  return (
                    <div key={t.tableName} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 dark:text-gray-300 w-40 truncate font-mono">{t.tableName}</span>
                      <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                        <div className="h-full bg-cyan-400 dark:bg-cyan-500 rounded transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 w-16 text-right">{t.rows.toLocaleString()}</span>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-16 text-right">{t.sizeMB.toFixed(2)} MB</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Section: Email Delivery ── */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Mail className="w-4 h-4" /> Email Delivery (This Month)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white dark:bg-gray-800 rounded-xl border-l-4 border-l-emerald-500 border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <p className="text-xs text-gray-500 dark:text-gray-400">Sent</p>
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{data.emailStats.sentThisMonth}</p>
              </div>
              <div className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 ${data.emailStats.failedThisMonth > 0 ? 'border-l-red-500' : 'border-l-gray-300'} border border-gray-200 dark:border-gray-700 p-3 shadow-sm`}>
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className={`w-4 h-4 ${data.emailStats.failedThisMonth > 0 ? 'text-red-500' : 'text-gray-400'}`} />
                  <p className="text-xs text-gray-500 dark:text-gray-400">Failed</p>
                </div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{data.emailStats.failedThisMonth}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border-l-4 border-l-blue-500 border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Success Rate</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">
                  {data.emailStats.sentThisMonth + data.emailStats.failedThisMonth > 0
                    ? `${((data.emailStats.sentThisMonth / (data.emailStats.sentThisMonth + data.emailStats.failedThisMonth)) * 100).toFixed(0)}%`
                    : '--'}
                </p>
              </div>
            </div>
          </div>

          {/* ── Section: User Activity ── */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" /> User Activity
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {[
                { label: 'DAU (24h)', value: data.userActivity.dau, color: 'border-l-emerald-500' },
                { label: 'WAU (7d)', value: data.userActivity.wau, color: 'border-l-blue-500' },
                { label: 'MAU (30d)', value: data.userActivity.mau, color: 'border-l-purple-500' },
              ].map(s => (
                <div key={s.label} className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 ${s.color} border border-gray-200 dark:border-gray-700 p-3 shadow-sm`}>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
            {data.userActivity.lastSeenUsers.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Recently Active Users</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left px-3 py-1.5 text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="text-left px-3 py-1.5 text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="text-right px-3 py-1.5 text-xs font-medium text-gray-500 uppercase">Last Login</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.userActivity.lastSeenUsers.map(u => (
                        <tr key={u.username} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-white text-xs">{u.username}</td>
                          <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300 text-xs">{u.fullName}</td>
                          <td className="px-3 py-1.5 text-right text-gray-500 dark:text-gray-400 text-xs">{new Date(u.lastLogin).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Section: Agent Performance ── */}
          {data.agentPerf.length > 0 && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Bot className="w-4 h-4" /> Agent Performance
              </h2>
              <div className="space-y-1.5">
                {data.agentPerf.map(a => {
                  const maxRuns = Math.max(...data.agentPerf.map(x => x.totalRuns), 1);
                  const pct = (a.totalRuns / maxRuns) * 100;
                  return (
                    <div key={a.agentId} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 dark:text-gray-300 w-40 truncate font-mono">{a.agentId}</span>
                      <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
                        <div className="h-full bg-violet-400 dark:bg-violet-500 rounded transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-12 text-right">{a.totalRuns}</span>
                      <span className="text-xs text-gray-400 w-28 text-right">{a.lastRun ? new Date(a.lastRun).toLocaleDateString() : '--'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Section: Webhook / Dead Letter Queue ── */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3 flex items-center gap-2">
              <Webhook className="w-4 h-4" /> Webhooks & Dead Letter Queue
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Deliveries (30d)</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{data.webhookStats.totalDeliveries}</p>
                <div className="flex gap-2 mt-1 text-xs">
                  <span className="text-emerald-600 dark:text-emerald-400">{data.webhookStats.successDeliveries} ok</span>
                  <span className="text-red-500">{data.webhookStats.failedDeliveries} failed</span>
                </div>
              </div>
              <div className={`bg-white dark:bg-gray-800 rounded-xl border-l-4 ${data.webhookStats.dlqPending > 0 ? 'border-l-amber-500' : 'border-l-gray-300'} border border-gray-200 dark:border-gray-700 p-3 shadow-sm`}>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">DLQ Pending</p>
                <p className={`text-xl font-bold ${data.webhookStats.dlqPending > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white'}`}>{data.webhookStats.dlqPending}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 shadow-sm">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">DLQ Status</p>
                <div className="flex gap-2 text-xs mt-1">
                  <span className="text-red-500">{data.webhookStats.dlqFailed} failed</span>
                  <span className="text-emerald-600 dark:text-emerald-400">{data.webhookStats.dlqResolved} resolved</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tenant Usage Table */}
          {data.tenants.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">Tenant Usage</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      {([
                        ['name', 'Name'],
                        ['totalUsers', 'Users'],
                        ['activeUsers', 'Active'],
                        ['projectCount', 'Projects'],
                        ['taskCount', 'Tasks'],
                        ['aiTokensThisMonth', 'AI Tokens'],
                        ['aiCostThisMonth', 'AI Cost'],
                      ] as [keyof TenantRow, string][]).map(([col, label]) => (
                        <th
                          key={col}
                          onClick={() => handleSort(col)}
                          className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 select-none"
                        >
                          <span className="inline-flex items-center gap-1">
                            {label}
                            {sortCol === col && <ArrowUpDown className="w-3 h-3" />}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTenants.map(t => (
                      <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{t.name}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t.totalUsers}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t.activeUsers}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t.projectCount}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t.taskCount}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t.aiTokensThisMonth.toLocaleString()}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">${t.aiCostThisMonth.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </AdminPageWrapper>
  );
}
