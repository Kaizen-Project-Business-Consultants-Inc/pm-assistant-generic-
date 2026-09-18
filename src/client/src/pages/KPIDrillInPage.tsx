import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import {
  ArrowLeft,
  HeartPulse,
  Clock,
  ShieldAlert,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronUp,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { apiService } from '../services/api';
import { useState, useMemo } from 'react';
import { formatCalendarDate } from '../utils/dateUtils';

type DrillInType = 'health' | 'overdue' | 'risks' | 'at-risk' | 'budget-variance' | 'budget-utilization';

interface ColumnDef {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: any) => React.ReactNode;
}

interface HealthRecord {
  healthScore: number;
  riskLevel: string;
  scheduleHealth: number | null;
  budgetHealth: number | null;
  riskHealth: number | null;
  recordedAt: string;
}

const typeConfig: Record<DrillInType, { title: string; icon: React.ElementType; subtitle: (count: number) => string }> = {
  health: { title: 'Portfolio Health', icon: HeartPulse, subtitle: (n) => `${n} projects` },
  overdue: { title: 'Overdue Tasks', icon: Clock, subtitle: (n) => `${n} overdue tasks` },
  risks: { title: 'Open Risks', icon: ShieldAlert, subtitle: (n) => `${n} projects with elevated risk` },
  'at-risk': { title: 'At-Risk Projects', icon: AlertTriangle, subtitle: (n) => `${n} at-risk projects` },
  'budget-variance': { title: 'Budget Variance', icon: DollarSign, subtitle: (n) => `${n} projects over budget` },
  'budget-utilization': { title: 'Budget Utilization', icon: TrendingUp, subtitle: (n) => `${n} projects over budget` },
};

const validTypes = new Set<string>(['health', 'overdue', 'risks', 'at-risk', 'budget-variance', 'budget-utilization']);

const cardColorMap = {
  green: 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  yellow: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  gray: 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

function getScope(): 'portfolio' | undefined {
  try {
    const val = localStorage.getItem('dashboard:scope');
    return val === 'portfolio' ? 'portfolio' : undefined;
  } catch {
    return undefined;
  }
}

function riskLevelColor(level: string) {
  switch (level?.toLowerCase()) {
    case 'critical': return 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/30';
    case 'high': return 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/30';
    case 'medium': return 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/30';
    case 'low': return 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30';
    default: return 'text-gray-600 bg-gray-50 dark:text-gray-400 dark:bg-gray-800';
  }
}

function healthDot(score: number) {
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color} mr-2`} />;
}

function Sparkline({ data, width = 100, height = 24 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) {
    return (
      <svg width={width} height={height} className="text-gray-300 dark:text-gray-600">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth={1} strokeDasharray="4 2" />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padding + ((max - val) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastScore = data[data.length - 1];
  const color = lastScore >= 70 ? '#10b981' : lastScore >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <svg width={width} height={height}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SummaryCard {
  label: string;
  value: string | number;
  color: keyof typeof cardColorMap;
  icon: React.ElementType;
}

function SummaryCards({ cards }: { cards: SummaryCard[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${cardColorMap[card.color]}`}>
              <card.icon className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{card.value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}

function TrendBadge({ trend }: { trend: 'improving' | 'declining' | 'stable' | undefined }) {
  if (!trend) return null;
  if (trend === 'improving') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
        <TrendingUp className="h-3 w-3" /> Improving from last week
      </span>
    );
  }
  if (trend === 'declining') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded-full">
        <TrendingDown className="h-3 w-3" /> Declining from last week
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded-full">
      <Minus className="h-3 w-3" /> Stable
    </span>
  );
}

function DistributionBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  return (
    <div className="mb-6">
      <div className="h-3 rounded-full overflow-hidden flex bg-gray-100 dark:bg-gray-700">
        {segments.map((seg) => {
          const pct = (seg.value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={seg.label}
              className={`${seg.color} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${seg.value} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 mt-2">
        {segments.filter(s => s.value > 0).map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${seg.color}`} />
            {seg.label} ({seg.value})
          </span>
        ))}
      </div>
    </div>
  );
}

export function KPIDrillInPage() {
  const { type } = useParams<{ type: string }>();
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const scope = getScope();

  const isValid = validTypes.has(type || '');
  const config = isValid ? typeConfig[type as DrillInType] : null;

  const needsPredictions = type === 'health' || type === 'risks';
  const needsOverdue = type === 'overdue';
  const needsAnalytics = type === 'at-risk' || type === 'budget-variance' || type === 'budget-utilization' || type === 'health' || type === 'overdue';

  const { data: predictions, isLoading: predictionsLoading } = useQuery({
    queryKey: ['dashboard-predictions'],
    queryFn: () => apiService.getDashboardPredictions(),
    staleTime: 120_000,
    enabled: needsPredictions,
  });

  const { data: overdueTasks, isLoading: overdueLoading } = useQuery({
    queryKey: ['dashboard-overdue-tasks', scope],
    queryFn: () => apiService.getDashboardOverdueTasks(scope),
    staleTime: 120_000,
    enabled: needsOverdue,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics-summary', scope],
    queryFn: () => apiService.getAnalyticsSummary(scope),
    staleTime: 120_000,
    enabled: needsAnalytics,
  });

  // Health history queries (only for health type)
  const healthProjects = useMemo(() => {
    if (type !== 'health') return [];
    return (predictions?.projectHealthScores || []).map((s: any) => s.projectId || s.id).filter(Boolean);
  }, [type, predictions]);

  const healthHistoryQueries = useQueries({
    queries: healthProjects.map((projectId: string) => ({
      queryKey: ['health-history', projectId],
      queryFn: () => apiService.getHealthHistory(projectId, 30),
      staleTime: 120_000,
    })),
  });

  const isLoading = (needsPredictions && predictionsLoading) || (needsOverdue && overdueLoading) || (needsAnalytics && analyticsLoading);

  // Build health history map: projectId -> HealthRecord[]
  const healthHistoryMap = useMemo(() => {
    if (type !== 'health') return new Map<string, HealthRecord[]>();
    const map = new Map<string, HealthRecord[]>();
    healthProjects.forEach((id: string, idx: number) => {
      const result = healthHistoryQueries[idx]?.data as any;
      map.set(id, result?.data || []);
    });
    return map;
  }, [type, healthProjects, healthHistoryQueries]);

  // Trend from analytics
  const trendIndicators = useMemo(() => {
    const summary = analytics?.summary || analytics?.data || analytics;
    return summary?.trendIndicators;
  }, [analytics]);

  // Summary cards per type
  const summaryCards = useMemo((): SummaryCard[] => {
    if (!isValid) return [];
    switch (type as DrillInType) {
      case 'health': {
        const scores = predictions?.projectHealthScores || [];
        const healthValues: number[] = scores.map((s: any) => s.healthScore);
        const avg = healthValues.length > 0 ? Math.round(healthValues.reduce((a: number, b: number) => a + b, 0) / healthValues.length) : 0;
        const healthy = healthValues.filter((v: number) => v >= 75).length;
        const critical = scores.filter((s: any) => s.riskLevel?.toLowerCase() === 'critical').length;
        const atRisk = healthValues.filter((v: number) => v < 50).length;
        return [
          { label: 'Avg Health', value: `${avg}%`, color: avg >= 75 ? 'green' : avg >= 50 ? 'yellow' : 'red', icon: HeartPulse },
          { label: 'Healthy (>=75%)', value: healthy, color: 'green', icon: HeartPulse },
          { label: 'Projects At Risk', value: atRisk, color: atRisk > 0 ? 'red' : 'green', icon: AlertTriangle },
          { label: 'Critical', value: critical, color: critical > 0 ? 'red' : 'green', icon: ShieldAlert },
        ];
      }
      case 'overdue': {
        const tasks = overdueTasks?.tasks || overdueTasks || [];
        const total = tasks.length;
        const daysArr = tasks.map((t: any) => {
          const due = t.dueDate || t.end_date;
          return due ? Math.max(0, Math.floor((Date.now() - new Date(due).getTime()) / 86400000)) : 0;
        });
        const avgDays = daysArr.length > 0 ? Math.round(daysArr.reduce((a: number, b: number) => a + b, 0) / daysArr.length) : 0;
        const criticalCount = tasks.filter((t: any) => (t.priority || '').toLowerCase() === 'critical').length;
        // Most affected project
        const projectCounts: Record<string, number> = {};
        tasks.forEach((t: any) => {
          const pn = t.projectName || t.project_name || 'Unknown';
          projectCounts[pn] = (projectCounts[pn] || 0) + 1;
        });
        const mostAffected = Object.entries(projectCounts).sort(([, a], [, b]) => (b as number) - (a as number))[0];
        return [
          { label: 'Total Overdue', value: total, color: total > 0 ? 'red' : 'green', icon: Clock },
          { label: 'Avg Days Overdue', value: avgDays, color: avgDays > 7 ? 'red' : avgDays > 3 ? 'yellow' : 'green', icon: Clock },
          { label: 'Most Affected', value: mostAffected ? `${mostAffected[0]}` : '-', color: 'blue', icon: AlertTriangle },
          { label: 'Critical Priority', value: criticalCount, color: criticalCount > 0 ? 'red' : 'green', icon: ShieldAlert },
        ];
      }
      case 'risks': {
        const risks = predictions?.risks;
        const critical = risks?.critical || 0;
        const high = risks?.high || 0;
        const medium = risks?.medium || 0;
        const total = critical + high + medium;
        return [
          { label: 'Total Elevated', value: total, color: total > 0 ? 'red' : 'green', icon: ShieldAlert },
          { label: 'Critical', value: critical, color: critical > 0 ? 'red' : 'green', icon: ShieldAlert },
          { label: 'High', value: high, color: high > 0 ? 'yellow' : 'green', icon: ShieldAlert },
          { label: 'Medium', value: medium, color: medium > 0 ? 'yellow' : 'green', icon: ShieldAlert },
        ];
      }
      case 'at-risk': {
        const projects = analytics?.portfolio?.atRiskProjects || [];
        const totalProjects = analytics?.portfolio?.totalProjects ?? analytics?.summary?.totalProjects ?? 0;
        const reasons: Record<string, number> = {};
        projects.forEach((p: any) => {
          const r = p.reason || p.status || 'Unknown';
          reasons[r] = (reasons[r] || 0) + 1;
        });
        const topReason = Object.entries(reasons).sort(([, a], [, b]) => (b as number) - (a as number))[0];
        return [
          { label: 'At-Risk Projects', value: projects.length, color: projects.length > 0 ? 'red' : 'green', icon: AlertTriangle },
          { label: 'Total Projects', value: totalProjects, color: 'blue', icon: HeartPulse },
          { label: 'Top Reason', value: topReason ? topReason[0] : '-', color: 'yellow', icon: AlertTriangle },
        ];
      }
      case 'budget-variance':
      case 'budget-utilization': {
        const projectsOver = analytics?.budget?.projectsOverBudget || [];
        const overrunPcts = projectsOver.map((p: any) => p.overrunPercent ?? p.overrun ?? 0);
        const avgOverrun = overrunPcts.length > 0 ? overrunPcts.reduce((a: number, b: number) => a + b, 0) / overrunPcts.length : 0;
        const worst = overrunPcts.length > 0 ? Math.max(...overrunPcts) : 0;
        return [
          { label: 'Over Budget', value: projectsOver.length, color: projectsOver.length > 0 ? 'red' : 'green', icon: DollarSign },
          { label: 'Avg Overrun', value: `${avgOverrun.toFixed(1)}%`, color: avgOverrun > 20 ? 'red' : avgOverrun > 10 ? 'yellow' : 'green', icon: DollarSign },
          { label: 'Worst Overrun', value: `${worst.toFixed(1)}%`, color: worst > 20 ? 'red' : worst > 10 ? 'yellow' : 'green', icon: TrendingUp },
        ];
      }
      default:
        return [];
    }
  }, [type, predictions, overdueTasks, analytics, isValid]);

  // Distribution bar segments
  const distributionSegments = useMemo(() => {
    if (type === 'health') {
      const scores = predictions?.projectHealthScores || [];
      const healthy = scores.filter((s: any) => s.healthScore >= 75).length;
      const warning = scores.filter((s: any) => s.healthScore >= 50 && s.healthScore < 75).length;
      const critical = scores.filter((s: any) => s.healthScore < 50).length;
      return [
        { label: 'Healthy', value: healthy, color: 'bg-green-500' },
        { label: 'Warning', value: warning, color: 'bg-amber-500' },
        { label: 'Critical', value: critical, color: 'bg-red-500' },
      ];
    }
    if (type === 'risks') {
      const risks = predictions?.risks;
      return [
        { label: 'Critical', value: risks?.critical || 0, color: 'bg-red-500' },
        { label: 'High', value: risks?.high || 0, color: 'bg-orange-500' },
        { label: 'Medium', value: risks?.medium || 0, color: 'bg-amber-500' },
      ];
    }
    return null;
  }, [type, predictions]);

  // Trend for header
  const headerTrend = useMemo((): 'improving' | 'declining' | 'stable' | undefined => {
    if (type === 'health') return trendIndicators?.healthTrend;
    if (type === 'overdue') return trendIndicators?.overdueTasksTrend;
    return undefined;
  }, [type, trendIndicators]);

  const { rows, columns } = useMemo(() => {
    if (!isValid) return { rows: [], columns: [] };

    switch (type as DrillInType) {
      case 'health': {
        const scores = predictions?.projectHealthScores || [];
        const enriched = scores.map((s: any) => {
          const pid = s.projectId || s.id;
          const history: HealthRecord[] = pid ? (healthHistoryMap.get(pid) || []) : [];
          const latest = history.length > 0 ? history[history.length - 1] : null;
          return {
            ...s,
            scheduleHealth: latest?.scheduleHealth ?? null,
            budgetHealth: latest?.budgetHealth ?? null,
            riskHealth: latest?.riskHealth ?? null,
            sparklineData: history.map(h => h.healthScore),
          };
        });
        const cols: ColumnDef[] = [
          { key: 'projectName', label: 'Project', sortable: true },
          {
            key: 'healthScore', label: 'Health Score', sortable: true,
            render: (r: any) => <span className="flex items-center">{healthDot(r.healthScore)}{r.healthScore}%</span>,
          },
          {
            key: 'scheduleHealth', label: 'Schedule', sortable: true,
            render: (r: any) => r.scheduleHealth != null ? <span className="text-sm">{r.scheduleHealth}%</span> : <span className="text-gray-500">-</span>,
          },
          {
            key: 'budgetHealth', label: 'Budget', sortable: true,
            render: (r: any) => r.budgetHealth != null ? <span className="text-sm">{r.budgetHealth}%</span> : <span className="text-gray-500">-</span>,
          },
          {
            key: 'riskHealth', label: 'Risk', sortable: true,
            render: (r: any) => r.riskHealth != null ? <span className="text-sm">{r.riskHealth}%</span> : <span className="text-gray-500">-</span>,
          },
          {
            key: 'sparklineData', label: '30-Day Trend', sortable: false,
            render: (r: any) => <Sparkline data={r.sparklineData || []} />,
          },
          {
            key: 'riskLevel', label: 'Risk Level', sortable: true,
            render: (r: any) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${riskLevelColor(r.riskLevel)}`}>{r.riskLevel}</span>,
          },
        ];
        return { rows: enriched, columns: cols };
      }

      case 'overdue': {
        const tasks = overdueTasks?.tasks || overdueTasks || [];
        const withDays = tasks.map((t: any) => {
          const due = t.dueDate || t.end_date;
          const daysOverdue = due ? Math.max(0, Math.floor((Date.now() - new Date(due).getTime()) / 86400000)) : 0;
          return { ...t, daysOverdue, dueDate: due };
        });
        const cols: ColumnDef[] = [
          { key: 'name', label: 'Task', sortable: true, render: (r: any) => r.name || r.title },
          { key: 'projectName', label: 'Project', sortable: true, render: (r: any) => r.projectName || r.project_name || '-' },
          {
            key: 'priority', label: 'Priority', sortable: true,
            render: (r: any) => {
              const p = r.priority || 'medium';
              const cls = p === 'critical' || p === 'high' ? 'text-red-600' : p === 'medium' ? 'text-amber-600' : 'text-gray-500';
              return <span className={`text-xs font-medium ${cls}`}>{p}</span>;
            },
          },
          { key: 'dueDate', label: 'Due Date', sortable: true, render: (r: any) => r.dueDate ? formatCalendarDate(r.dueDate) : '-' },
          {
            key: 'daysOverdue', label: 'Days Overdue', sortable: true,
            render: (r: any) => <span className="text-red-600 font-medium">{r.daysOverdue}</span>,
          },
        ];
        return { rows: withDays, columns: cols };
      }

      case 'risks': {
        const scores = (predictions?.projectHealthScores || []).filter((s: any) => s.riskLevel && s.riskLevel.toLowerCase() !== 'low');
        const cols: ColumnDef[] = [
          { key: 'projectName', label: 'Project', sortable: true },
          {
            key: 'riskLevel', label: 'Risk Level', sortable: true,
            render: (r: any) => <span className={`px-2 py-0.5 rounded text-xs font-medium ${riskLevelColor(r.riskLevel)}`}>{r.riskLevel}</span>,
          },
          {
            key: 'healthScore', label: 'Health Score', sortable: true,
            render: (r: any) => <span className="flex items-center">{healthDot(r.healthScore)}{r.healthScore}%</span>,
          },
        ];
        return { rows: scores, columns: cols };
      }

      case 'at-risk': {
        const projects = analytics?.portfolio?.atRiskProjects || [];
        const cols: ColumnDef[] = [
          { key: 'name', label: 'Project', sortable: true },
          { key: 'reason', label: 'Reason', sortable: true, render: (r: any) => r.reason || r.status || '-' },
        ];
        return { rows: projects, columns: cols };
      }

      case 'budget-variance':
      case 'budget-utilization': {
        const projects = analytics?.budget?.projectsOverBudget || [];
        const cols: ColumnDef[] = [
          { key: 'name', label: 'Project', sortable: true, render: (r: any) => r.name || r.projectName },
          {
            key: 'overrunPercent', label: 'Overrun %', sortable: true,
            render: (r: any) => {
              const pct = r.overrunPercent ?? r.overrun ?? 0;
              const cls = pct > 20 ? 'text-red-600' : pct > 10 ? 'text-amber-600' : 'text-green-600';
              return <span className={`font-medium ${cls}`}>{typeof pct === 'number' ? `${pct.toFixed(1)}%` : pct}</span>;
            },
          },
        ];
        return { rows: projects, columns: cols };
      }

      default:
        return { rows: [], columns: [] };
    }
  }, [type, predictions, overdueTasks, analytics, isValid, healthHistoryMap]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function getRowProjectId(row: any): string | undefined {
    return row.projectId || row.project_id || row.id;
  }

  if (!isValid) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400 mb-4">Page not found</p>
        <button onClick={() => navigate('/dashboard')} className="text-primary-600 hover:underline flex items-center gap-1 mx-auto">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </button>
      </div>
    );
  }

  const Icon = config!.icon;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Back link */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{config!.title}</h1>
            <TrendBadge trend={headerTrend} />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{config!.subtitle(sortedRows.length)}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          {summaryCards.length > 0 && <SummaryCards cards={summaryCards} />}

          {/* Distribution Bar */}
          {distributionSegments && <DistributionBar segments={distributionSegments} />}

          {/* Table */}
          {sortedRows.length === 0 ? (
            <div className="text-center py-16 text-gray-500 dark:text-gray-400">
              No data available
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300 ${col.sortable ? 'cursor-pointer hover:text-gray-900 dark:hover:text-white select-none' : ''}`}
                        onClick={() => col.sortable && handleSort(col.key)}
                      >
                        <span className="flex items-center gap-1">
                          {col.label}
                          {col.sortable && sortKey === col.key && (
                            sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row: any, i: number) => {
                    const projectId = getRowProjectId(row);
                    return (
                      <tr
                        key={row.id || i}
                        className={`border-b border-gray-100 dark:border-gray-700/50 ${projectId ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50' : ''}`}
                        onClick={() => projectId && navigate(`/project/${projectId}`)}
                      >
                        {columns.map((col) => (
                          <td key={col.key} className="px-4 py-3 text-gray-900 dark:text-gray-100">
                            {col.render ? col.render(row) : (row[col.key] ?? '-')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
