import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Layers, DollarSign, TrendingUp, CheckCircle, AlertTriangle, FolderKanban, BarChart3, Users, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { HealthTrendsWidget } from '../components/dashboard/widgets/HealthTrendsWidget';
import { apiService } from '../services/api';
import { GanttChart, type GanttTask } from '../components/schedule/GanttChart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PortfolioItem {
  projectId: string;
  projectName: string;
  status: string;
  priority: string;
  startDate?: string;
  endDate?: string;
  budgetAllocated: number;
  budgetSpent: number;
  progressPercentage: number;
  totalTasks: number;
  completedTasks: number;
  tasks: Array<{
    id: string;
    name: string;
    status: string;
    priority: string;
    startDate?: string;
    endDate?: string;
    progressPercentage?: number;
    parentTaskId?: string;
    assignedTo?: string;
    dependency?: string;
    dependencyType?: string;
  }>;
}

interface PortfolioAnalyticsProject {
  projectId: string;
  projectName: string;
  status: string;
  cpi: number | null;
  spi: number | null;
  cpiTrend: Array<{ date: string; value: number }>;
  spiTrend: Array<{ date: string; value: number }>;
  burndown: Array<{ date: string; ideal: number; actual: number }>;
  percentComplete: number;
  healthScore: number | null;
  healthTrend: 'improving' | 'declining' | 'stable';
  budgetUtilization: number;
  budgetAllocated: number;
  budgetSpent: number;
  totalTasks: number;
  completedTasks: number;
  scheduleVariance: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
  planning: { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
  on_hold: { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
  completed: { bg: 'bg-gray-50 dark:bg-gray-900', text: 'text-gray-600 dark:text-gray-300', dot: 'bg-gray-400' },
  cancelled: { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-400' },
};

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

function healthLabel(item: PortfolioItem): { label: string; color: string } {
  const budgetOk = !item.budgetAllocated || item.budgetSpent <= item.budgetAllocated;
  const now = Date.now();
  const start = item.startDate ? new Date(item.startDate).getTime() : now;
  const end = item.endDate ? new Date(item.endDate).getTime() : 0;
  const elapsed = end > start ? (now - start) / (end - start) : 0;
  const progress = (item.progressPercentage || 0) / 100;
  const scheduleOk = !end || elapsed <= 0 || progress >= elapsed - 0.2;

  if (budgetOk && scheduleOk) return { label: 'On Track', color: 'text-green-600' };
  if (!budgetOk && !scheduleOk) return { label: 'Critical', color: 'text-red-600' };
  return { label: 'At Risk', color: 'text-amber-600' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [view, setView] = useState<'dashboard' | 'gantt' | 'resources'>('dashboard');

  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => apiService.getPortfolio(),
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['portfolioAnalytics'],
    queryFn: () => apiService.getPortfolioAnalytics(),
    staleTime: 5 * 60 * 1000,
  });

  const portfolioItems: PortfolioItem[] = data?.portfolioItems || [];

  // Filtered items
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return portfolioItems;
    return portfolioItems.filter(p => p.status === statusFilter);
  }, [portfolioItems, statusFilter]);

  // KPIs
  const kpis = useMemo(() => {
    const total = portfolioItems.length;
    const active = portfolioItems.filter(p => p.status === 'active').length;
    const totalBudget = portfolioItems.reduce((s, p) => s + (p.budgetAllocated || 0), 0);
    const totalSpent = portfolioItems.reduce((s, p) => s + (p.budgetSpent || 0), 0);
    const totalTasks = portfolioItems.reduce((s, p) => s + p.totalTasks, 0);
    const completedTasks = portfolioItems.reduce((s, p) => s + p.completedTasks, 0);
    const avgProgress = total > 0 ? Math.round(portfolioItems.reduce((s, p) => s + p.progressPercentage, 0) / total) : 0;
    const onTrack = portfolioItems.filter(p => p.status === 'active' && healthLabel(p).label === 'On Track').length;
    const atRisk = portfolioItems.filter(p => p.status === 'active' && healthLabel(p).label !== 'On Track').length;
    return { total, active, totalBudget, totalSpent, totalTasks, completedTasks, avgProgress, onTrack, atRisk };
  }, [portfolioItems]);

  // Status breakdown
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of portfolioItems) counts[p.status] = (counts[p.status] || 0) + 1;
    return counts;
  }, [portfolioItems]);

  // Gantt tasks
  const ganttTasks: GanttTask[] = useMemo(() => {
    const tasks: GanttTask[] = [];
    for (const item of filtered) {
      const projectTaskId = `project-${item.projectId}`;
      let earliest = item.startDate;
      let latest = item.endDate;
      for (const t of item.tasks) {
        if (t.startDate && (!earliest || new Date(t.startDate) < new Date(earliest))) earliest = t.startDate;
        if (t.endDate && (!latest || new Date(t.endDate) > new Date(latest))) latest = t.endDate;
      }
      tasks.push({
        id: projectTaskId,
        name: item.projectName,
        status: item.status === 'active' ? 'in_progress' : item.status === 'planning' ? 'pending' : item.status,
        priority: item.priority,
        startDate: earliest ? new Date(earliest).toISOString() : undefined,
        endDate: latest ? new Date(latest).toISOString() : undefined,
        progressPercentage: item.progressPercentage,
      });
      for (const t of item.tasks) {
        if (!t.parentTaskId) {
          tasks.push({
            id: t.id, name: t.name, status: t.status, priority: t.priority,
            startDate: t.startDate ? new Date(t.startDate).toISOString() : undefined,
            endDate: t.endDate ? new Date(t.endDate).toISOString() : undefined,
            progressPercentage: t.progressPercentage, parentTaskId: projectTaskId,
            assignedTo: t.assignedTo, dependency: t.dependency, dependencyType: t.dependencyType,
          });
        }
      }
    }
    return tasks;
  }, [filtered]);

  const handleTaskClick = (task: GanttTask) => {
    if (task.id.startsWith('project-')) navigate(`/project/${task.id.replace('project-', '')}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-gray-500 dark:text-gray-400">Failed to load portfolio data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/40">
            <Layers className="h-5 w-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Portfolio Overview</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{kpis.total} projects &middot; {kpis.totalTasks} tasks</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('dashboard')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === 'dashboard' ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <BarChart3 className="w-3.5 h-3.5 inline mr-1" />Dashboard
          </button>
          <button
            onClick={() => setView('gantt')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === 'gantt' ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Layers className="w-3.5 h-3.5 inline mr-1" />Timeline
          </button>
          <button
            onClick={() => setView('resources')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === 'resources' ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
          >
            <Users className="w-3.5 h-3.5 inline mr-1" />Resources
          </button>
        </div>
      </div>

      {portfolioItems.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
          <Layers className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No Projects</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No projects found in your portfolio.</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Total Projects" value={String(kpis.total)} icon={FolderKanban} color="bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400" />
            <KPICard label="Active" value={String(kpis.active)} icon={TrendingUp} color="bg-green-50 text-green-600" />
            <KPICard label="On Track" value={String(kpis.onTrack)} icon={CheckCircle} color="bg-emerald-50 text-emerald-600" />
            <KPICard label="At Risk" value={String(kpis.atRisk)} icon={AlertTriangle} color="bg-amber-50 text-amber-600" />
            <KPICard label="Budget" value={formatCurrency(kpis.totalBudget)} icon={DollarSign} color="bg-blue-50 text-blue-600" />
            <KPICard label="Spent" value={formatCurrency(kpis.totalSpent)} icon={DollarSign} color={kpis.totalSpent > kpis.totalBudget ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'} />
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${statusFilter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
            >
              All ({portfolioItems.length})
            </button>
            {Object.entries(statusCounts).map(([status, count]) => {
              const sc = STATUS_COLORS[status] || STATUS_COLORS.active;
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors capitalize ${statusFilter === status ? `${sc.bg} ${sc.text} ring-2 ring-offset-1 ring-current` : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
                >
                  {status.replace('_', ' ')} ({count})
                </button>
              );
            })}
          </div>

          {view === 'resources' ? (
            <PortfolioResourcesView />
          ) : view === 'dashboard' ? (
            <>
              {/* Budget Overview Bar */}
              {kpis.totalBudget > 0 && (
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Portfolio Budget</h3>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {formatCurrency(kpis.totalSpent)} of {formatCurrency(kpis.totalBudget)} ({kpis.totalBudget > 0 ? Math.round((kpis.totalSpent / kpis.totalBudget) * 100) : 0}%)
                    </span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${kpis.totalSpent > kpis.totalBudget ? 'bg-red-500' : kpis.totalSpent > kpis.totalBudget * 0.9 ? 'bg-amber-500' : 'bg-primary-500'}`}
                      style={{ width: `${Math.min(100, kpis.totalBudget > 0 ? (kpis.totalSpent / kpis.totalBudget) * 100 : 0)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Portfolio Analytics Panels */}
              {analyticsData?.projects?.length > 0 && (
                <>
                  <CPISPIComparison projects={analyticsData.projects} onProjectClick={(id) => navigate(`/project/${id}`)} />
                  <BurndownTrends projects={analyticsData.projects} />
                  <ProjectComparisonMatrix projects={analyticsData.projects} onProjectClick={(id) => navigate(`/project/${id}`)} />
                </>
              )}

              {/* Health Trends */}
              <HealthTrendsWidget projects={filtered.map(p => ({ id: p.projectId, name: p.projectName }))} />

              {/* Project Cards */}
              <div className="space-y-3">
                {filtered.map(item => {
                  const health = healthLabel(item);
                  const budgetPct = item.budgetAllocated > 0 ? Math.round((item.budgetSpent / item.budgetAllocated) * 100) : 0;
                  const sc = STATUS_COLORS[item.status] || STATUS_COLORS.active;
                  return (
                    <div
                      key={item.projectId}
                      onClick={() => navigate(`/project/${item.projectId}`)}
                      className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-shadow cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{item.projectName}</h3>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${sc.bg} ${sc.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                              {item.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                            <span>{item.completedTasks}/{item.totalTasks} tasks</span>
                            {item.budgetAllocated > 0 && <span>{formatCurrency(item.budgetSpent)} / {formatCurrency(item.budgetAllocated)}</span>}
                            {item.endDate && <span>Due {new Date(item.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-xs font-semibold ${health.color}`}>{health.label}</span>
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{item.progressPercentage}%</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Progress bar */}
                        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${item.progressPercentage}%` }} />
                        </div>
                        {/* Budget bar (if applicable) */}
                        {item.budgetAllocated > 0 && (
                          <div className="w-24 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden" title={`Budget: ${budgetPct}%`}>
                            <div
                              className={`h-full rounded-full ${budgetPct > 100 ? 'bg-red-500' : budgetPct > 90 ? 'bg-amber-500' : 'bg-blue-500'}`}
                              style={{ width: `${Math.min(100, budgetPct)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Gantt Timeline View */
            <GanttChart
              tasks={ganttTasks}
              scheduleName="Portfolio Timeline"
              onTaskClick={handleTaskClick}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio Resources View
// ---------------------------------------------------------------------------

interface PortfolioResource {
  resourceId: string;
  resourceName: string;
  role: string;
  costRateHourly: number | null;
  projects: { projectId: string; projectName: string; averageUtilization: number }[];
  combinedUtilization: number;
  isOverAllocated: boolean;
}

interface PortfolioContention {
  resourceId: string;
  resourceName: string;
  role: string;
  projects: { projectId: string; projectName: string; averageUtilization: number }[];
  combinedUtilization: number;
}

interface PortfolioResourcesSummary {
  totalResources: number;
  overAllocatedCount: number;
  avgUtilization: number;
  totalWeeklyCost: number;
}

function PortfolioResourcesView() {
  const { data, isLoading } = useQuery({
    queryKey: ['portfolioResources'],
    queryFn: () => apiService.getPortfolioResources(),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const resources: PortfolioResource[] = data?.resources || [];
  const contentions: PortfolioContention[] = data?.contentions || [];
  const summary: PortfolioResourcesSummary = data?.summary || { totalResources: 0, overAllocatedCount: 0, avgUtilization: 0, totalWeeklyCost: 0 };

  if (resources.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <Users className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">No Resource Data</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">No resources are assigned across your projects.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Total Resources" value={String(summary.totalResources)} icon={Users} color="bg-blue-50 text-blue-600" />
        <KPICard label="Over-Allocated" value={String(summary.overAllocatedCount)} icon={AlertTriangle} color={summary.overAllocatedCount > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'} />
        <KPICard label="Avg Utilization" value={`${summary.avgUtilization}%`} icon={TrendingUp} color="bg-purple-50 text-purple-600" />
        <KPICard label="Weekly Cost" value={summary.totalWeeklyCost > 0 ? `$${summary.totalWeeklyCost.toLocaleString()}` : '--'} icon={DollarSign} color="bg-blue-50 text-blue-600" />
      </div>

      {/* Cross-project contention */}
      {contentions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Cross-Project Contention</h3>
            <span className="text-xs text-red-500">{contentions.length} resource{contentions.length !== 1 ? 's' : ''} over-allocated across projects</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Resource</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Role</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Projects</th>
                  <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Combined</th>
                </tr>
              </thead>
              <tbody>
                {contentions.map(c => (
                  <tr key={c.resourceId} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{c.resourceName}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{c.role}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.projects.map(p => (
                          <span key={p.projectId} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                            {p.projectName} ({p.averageUtilization}%)
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white ${c.combinedUtilization > 150 ? 'bg-red-500' : 'bg-amber-500'}`}>
                        {c.combinedUtilization}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All resources table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Resource Utilization</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Resource</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Role</th>
                <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">$/hr</th>
                <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300"># Projects</th>
                <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Utilization</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Projects</th>
              </tr>
            </thead>
            <tbody>
              {resources.map(r => (
                <tr key={r.resourceId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{r.resourceName}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{r.role}</td>
                  <td className="px-4 py-2 text-center text-gray-600 dark:text-gray-400">
                    {r.costRateHourly != null ? `$${r.costRateHourly.toFixed(0)}` : '--'}
                  </td>
                  <td className="px-4 py-2 text-center text-gray-600 dark:text-gray-400">{r.projects.length}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold text-white ${
                      r.combinedUtilization > 120 ? 'bg-red-500' : r.combinedUtilization > 100 ? 'bg-amber-500' : r.combinedUtilization > 80 ? 'bg-blue-500' : 'bg-green-500'
                    }`}>
                      {r.combinedUtilization}%
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                    {r.projects.map(p => p.projectName).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline SVG
// ---------------------------------------------------------------------------

function Sparkline({ data, width = 80, height = 20, color = '#3b82f6' }: { data: number[]; width?: number; height?: number; color?: string }) {
  if (data.length < 2) return <span className="text-xs text-gray-400">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 2) - 1}`).join(' ');
  return (
    <svg width={width} height={height}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BurndownSparkline({ data, width = 100, height = 24 }: { data: Array<{ ideal: number; actual: number }>; width?: number; height?: number }) {
  if (data.length < 2) return <span className="text-xs text-gray-400">—</span>;
  const maxVal = Math.max(...data.map(d => Math.max(d.ideal, d.actual))) || 1;
  const toPoints = (values: number[]) => values.map((v, i) => `${(i / (values.length - 1)) * width},${height - (v / maxVal) * (height - 2) - 1}`).join(' ');
  return (
    <svg width={width} height={height}>
      <polyline points={toPoints(data.map(d => d.ideal))} fill="none" stroke="#9ca3af" strokeWidth={1} strokeDasharray="3,2" />
      <polyline points={toPoints(data.map(d => d.actual))} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CPI/SPI color helper
// ---------------------------------------------------------------------------

function cpiSpiColor(val: number | null): string {
  if (val === null) return 'text-gray-400';
  if (val >= 1.0) return 'text-green-600';
  if (val >= 0.85) return 'text-amber-600';
  return 'text-red-600';
}

function cpiSpiSparklineColor(val: number | null): string {
  if (val === null) return '#9ca3af';
  if (val >= 1.0) return '#16a34a';
  if (val >= 0.85) return '#d97706';
  return '#dc2626';
}

// ---------------------------------------------------------------------------
// CPI/SPI Comparison Panel
// ---------------------------------------------------------------------------

function CPISPIComparison({ projects, onProjectClick }: { projects: PortfolioAnalyticsProject[]; onProjectClick: (id: string) => void }) {
  const [sortKey, setSortKey] = useState<'cpi' | 'spi'>('cpi');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const withData = projects.filter(p => p.cpi !== null || p.spi !== null);
    return [...withData].sort((a, b) => {
      const av = sortKey === 'cpi' ? (a.cpi ?? 0) : (a.spi ?? 0);
      const bv = sortKey === 'cpi' ? (b.cpi ?? 0) : (b.spi ?? 0);
      return sortAsc ? av - bv : bv - av;
    });
  }, [projects, sortKey, sortAsc]);

  const toggleSort = (key: 'cpi' | 'spi') => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  if (sorted.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">CPI / SPI Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700">
              <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Project</th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer select-none" onClick={() => toggleSort('cpi')}>
                <span className="inline-flex items-center gap-1">CPI {sortKey === 'cpi' && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
              </th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer select-none" onClick={() => toggleSort('spi')}>
                <span className="inline-flex items-center gap-1">SPI {sortKey === 'spi' && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
              </th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">CPI Trend</th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">SPI Trend</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => (
              <tr key={p.projectId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => onProjectClick(p.projectId)}>
                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{p.projectName}</td>
                <td className={`px-4 py-2 text-center font-bold ${cpiSpiColor(p.cpi)}`}>{p.cpi !== null ? p.cpi.toFixed(2) : '—'}</td>
                <td className={`px-4 py-2 text-center font-bold ${cpiSpiColor(p.spi)}`}>{p.spi !== null ? p.spi.toFixed(2) : '—'}</td>
                <td className="px-4 py-2 text-center"><Sparkline data={p.cpiTrend.map(t => t.value)} color={cpiSpiSparklineColor(p.cpi)} /></td>
                <td className="px-4 py-2 text-center"><Sparkline data={p.spiTrend.map(t => t.value)} color={cpiSpiSparklineColor(p.spi)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Burndown Trends Panel
// ---------------------------------------------------------------------------

function BurndownTrends({ projects }: { projects: PortfolioAnalyticsProject[] }) {
  const withBurndown = projects.filter(p => p.burndown.length >= 2);
  if (withBurndown.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Burndown Trends</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700">
              <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Project</th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Burndown</th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Complete</th>
              <th className="text-center px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Variance</th>
            </tr>
          </thead>
          <tbody>
            {withBurndown.map(p => (
              <tr key={p.projectId} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-4 py-2 font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{p.projectName}</td>
                <td className="px-4 py-2 text-center">
                  <BurndownSparkline data={p.burndown} />
                </td>
                <td className="px-4 py-2 text-center font-bold text-gray-900 dark:text-white">{p.percentComplete}%</td>
                <td className="px-4 py-2 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                    p.scheduleVariance >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {p.scheduleVariance >= 0 ? '+' : ''}{p.scheduleVariance}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project Comparison Matrix
// ---------------------------------------------------------------------------

type ComparisonSortKey = 'health' | 'cpi' | 'spi' | 'budget' | 'progress' | 'tasks';

function ProjectComparisonMatrix({ projects, onProjectClick }: { projects: PortfolioAnalyticsProject[]; onProjectClick: (id: string) => void }) {
  const [sortKey, setSortKey] = useState<ComparisonSortKey>('health');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = useCallback((key: ComparisonSortKey) => {
    if (sortKey === key) setSortAsc(prev => !prev);
    else { setSortKey(key); setSortAsc(false); }
  }, [sortKey]);

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      let av: number, bv: number;
      switch (sortKey) {
        case 'health': av = a.healthScore ?? 0; bv = b.healthScore ?? 0; break;
        case 'cpi': av = a.cpi ?? 0; bv = b.cpi ?? 0; break;
        case 'spi': av = a.spi ?? 0; bv = b.spi ?? 0; break;
        case 'budget': av = a.budgetUtilization; bv = b.budgetUtilization; break;
        case 'progress': av = a.percentComplete; bv = b.percentComplete; break;
        case 'tasks': av = a.totalTasks; bv = b.totalTasks; break;
        default: av = 0; bv = 0;
      }
      return sortAsc ? av - bv : bv - av;
    });
  }, [projects, sortKey, sortAsc]);

  const SortHeader = ({ label, k }: { label: string; k: ComparisonSortKey }) => (
    <th className="text-center px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{label} {sortKey === k && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
    </th>
  );

  const healthDotColor = (score: number | null) => {
    if (score === null) return 'bg-gray-300';
    if (score >= 75) return 'bg-green-500';
    if (score >= 50) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <ArrowUpDown className="w-4 h-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Project Comparison</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700">
              <th className="text-left px-4 py-2 font-semibold text-gray-600 dark:text-gray-300">Project</th>
              <SortHeader label="Health" k="health" />
              <SortHeader label="CPI" k="cpi" />
              <SortHeader label="SPI" k="spi" />
              <SortHeader label="Budget %" k="budget" />
              <SortHeader label="Progress" k="progress" />
              <SortHeader label="Tasks" k="tasks" />
              <th className="text-center px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(p => {
              const sc = STATUS_COLORS[p.status] || STATUS_COLORS.active;
              return (
                <tr key={p.projectId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => onProjectClick(p.projectId)}>
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-white truncate max-w-[200px]">{p.projectName}</td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${healthDotColor(p.healthScore)}`} />
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{p.healthScore !== null ? p.healthScore : '—'}</span>
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-center font-bold ${cpiSpiColor(p.cpi)}`}>{p.cpi !== null ? p.cpi.toFixed(2) : '—'}</td>
                  <td className={`px-3 py-2 text-center font-bold ${cpiSpiColor(p.spi)}`}>{p.spi !== null ? p.spi.toFixed(2) : '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs font-bold ${p.budgetUtilization > 100 ? 'text-red-600' : p.budgetUtilization > 90 ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300'}`}>
                      {p.budgetAllocated > 0 ? `${p.budgetUtilization}%` : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${p.percentComplete}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{p.percentComplete}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-gray-600 dark:text-gray-400">{p.completedTasks}/{p.totalTasks}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${sc.bg} ${sc.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                      {p.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KPICard({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ElementType; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}
