import { useEffect, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Eye,
  Activity,
  Clock,
  AlertTriangle,
  AlertCircle,
  TrendingDown,
  DollarSign,
} from 'lucide-react';
import { apiService } from '../services/api';
import { useUIStore } from '../stores/uiStore';
import { AISummaryBanner } from '../components/dashboard/AISummaryBanner';
import { ProjectTable, type ProjectRow } from '../components/dashboard/ProjectTable';
import { IssuesCreatedVsResolvedChart } from '../components/dashboard/widgets/IssuesCreatedVsResolvedChart';
import { MilestonesWidget } from '../components/dashboard/widgets/MilestonesWidget';
import { BudgetWatchWidget } from '../components/dashboard/widgets/BudgetWatchWidget';
import { CustomizeDropdown } from '../components/dashboard/CustomizeDropdown';
import type { WidgetDef } from '../components/dashboard/WidgetRegistry';
import { WidgetGrid } from '../components/dashboard/WidgetGrid';
import { useDashboardPreferences } from '../hooks/useDashboardPreferences';
import { KpiTilePM } from '../components/pm/KpiTilePM';
import { ActionCenterPM } from '../components/pm/ActionCenterPM';
import { ActivityFeedPM } from '../components/pm/ActivityFeedPM';
import { MorningBriefingWidget } from '../components/dashboard/widgets/MorningBriefingWidget';
import { VelocitySparklineWidget } from '../components/dashboard/widgets/VelocitySparklineWidget';
import { StandupSummaryWidget } from '../components/dashboard/widgets/StandupSummaryWidget';
import { SprintSnapshotWidget } from '../components/dashboard/widgets/SprintSnapshotWidget';
import { GoalsWidget } from '../components/dashboard/widgets/GoalsWidget';
import { TeamWorkloadWidget } from '../components/dashboard/widgets/TeamWorkloadWidget';

// ─── Widget registry ──────────────────────────────────────────────────────────

const PM_WIDGETS: WidgetDef[] = [
  // Above the fold — data first, then actionable items
  { id: 'kpi',           label: 'KPI Tiles',              group: 'Overview', defaultOn: true,  size: 'full' },
  { id: 'projects',      label: 'Projects Table',         group: 'Overview', defaultOn: true,  size: 'full' },
  { id: 'briefing',      label: 'Morning Briefing',       group: 'Overview', defaultOn: true,  size: 'full' },
  { id: 'action',        label: 'Action Center',          group: 'Overview', defaultOn: true,  size: 'full' },
  // Below the fold — AI insights, charts, details
  { id: 'intel',         label: 'Portfolio Intelligence',  group: 'AI',       defaultOn: true,  size: 'full' },
  { id: 'trend',         label: 'Issues Trend',           group: 'Charts',   defaultOn: true,  size: 'full' },
  { id: 'velocity',      label: 'Sprint Velocity',        group: 'Charts',   defaultOn: true,  size: 'full' },
  { id: 'milestones',    label: 'Milestones',             group: 'Details',  defaultOn: true,  size: 'third' },
  { id: 'budget',        label: 'Budget Watch',           group: 'Details',  defaultOn: true,  size: 'third' },
  { id: 'activity',      label: 'Activity Feed',          group: 'Details',  defaultOn: true,  size: 'third' },
  { id: 'sprint',        label: 'Sprint Snapshot',        group: 'Details',  defaultOn: true,  size: 'full' },
  { id: 'goals',         label: 'Goals Progress',         group: 'Details',  defaultOn: true,  size: 'full' },
  { id: 'workload',      label: 'Team Workload',          group: 'Details',  defaultOn: true,  size: 'full' },
  { id: 'standup',       label: 'Standup Summary',        group: 'AI',       defaultOn: false, size: 'full' },
];

// ─── KPI computation helpers ──────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPM() {
  const {
    enabledIds,
    widgetOrder,
    scope,
    toggleWidget,
    reorder,
    changeScope,
    resetLayout,
  } = useDashboardPreferences(PM_WIDGETS);

  // Set AI panel context
  useEffect(() => {
    useUIStore.getState().setAIPanelContext({ type: 'dashboard' });
  }, []);

  // ─── Data fetching ──────────────────────────────────────────────────────────

  const { data: myProjectsData, isLoading: myLoading } = useQuery({
    queryKey: ['pm-projects'],
    queryFn: () => apiService.getProjects(),
    staleTime: 120_000,
  });

  const { data: allProjectsData } = useQuery({
    queryKey: ['pm-projects', 'portfolio'],
    queryFn: () => apiService.getProjects('portfolio'),
    staleTime: 120_000,
  });

  const { data: predictions } = useQuery({
    queryKey: ['pm-predictions'],
    queryFn: () => apiService.getDashboardPredictions(),
    staleTime: 120_000,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['pm-analytics'],
    queryFn: () => apiService.getAnalyticsSummary(),
    staleTime: 120_000,
  });

  // ─── Derived data ───────────────────────────────────────────────────────────

  const myProjects: ProjectRow[]  = myProjectsData?.data  || myProjectsData?.projects  || [];
  const allProjects: ProjectRow[] = allProjectsData?.data || allProjectsData?.projects || [];
  const showScopeToggle = allProjects.length !== myProjects.length;
  const activeProjects  = scope === 'portfolio' ? allProjects : myProjects;
  const scopeParam      = scope === 'portfolio' ? 'portfolio' as const : undefined;

  // Merge health scores
  const healthMap = new Map<string, number>();
  if (predictions?.projectHealthScores) {
    for (const h of predictions.projectHealthScores) {
      healthMap.set(h.projectId, h.healthScore);
    }
  }
  const projectsWithHealth: ProjectRow[] = activeProjects.map(p => ({
    ...p,
    healthScore: healthMap.get(p.id) ?? p.healthScore,
  }));

  // Slim project list for ActionCenter
  const projectSummaries = activeProjects.map(p => ({ id: p.id, name: p.name }));

  // ─── KPI values ─────────────────────────────────────────────────────────────

  const pred = predictions?.data || predictions;
  const analytics = analyticsData?.data || analyticsData;

  const healthScores: number[] = pred?.projectHealthScores?.map((s: any) => s.healthScore) || [];
  const avgHealth = healthScores.length > 0
    ? Math.round(healthScores.reduce((a: number, b: number) => a + b, 0) / healthScores.length)
    : 0;

  const overdueTasks  = analytics?.tasks?.overdue ?? 0;
  const risks         = pred?.risks;
  const openRisks     = risks ? (risks.critical || 0) + (risks.high || 0) + (risks.medium || 0) : 0;
  const atRiskCount   = analytics?.portfolio?.atRiskProjects?.length ?? 0;

  const allocated     = analytics?.budget?.totalAllocated ?? 0;
  const spent         = analytics?.budget?.totalSpent     ?? 0;
  const variance      = allocated - spent;
  const utilization   = analytics?.budget?.utilizationPercent ?? 0;

  const varianceStr   = variance >= 0
    ? `+$${formatCompact(variance)}`
    : `-$${formatCompact(Math.abs(variance))}`;

  const kpiColor = (v: number, goodBelow: boolean, warnThresh: number, badThresh: number): 'green' | 'amber' | 'red' | 'teal' | 'gray' => {
    if (goodBelow) {
      return v === 0 ? 'green' : v <= warnThresh ? 'amber' : 'red';
    }
    return v >= badThresh ? 'green' : v >= warnThresh ? 'amber' : 'red';
  };

  const healthColor: 'green' | 'amber' | 'red' | 'teal' | 'gray' =
    healthScores.length === 0 ? 'gray' : avgHealth >= 75 ? 'teal' : avgHealth >= 50 ? 'amber' : 'red';
  const varianceColor: 'green' | 'amber' | 'red' | 'teal' | 'gray' = variance >= 0 ? 'green' : 'red';
  const utilColor: 'green' | 'amber' | 'red' | 'teal' | 'gray' =
    utilization > 95 ? 'red' : utilization >= 80 ? 'amber' : 'green';

  // ─── Widget renderer ──────────────────────────────────────────────────────

  const renderWidget = useCallback((id: string): ReactNode => {
    switch (id) {
      case 'briefing':
        return <MorningBriefingWidget scope={scopeParam} />;
      case 'kpi':
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiTilePM label="Portfolio Health" value={`${avgHealth}%`} icon={Activity} color={healthColor} statusDot={healthColor} drillPath="/portfolio" />
            <KpiTilePM label="Overdue Tasks" value={overdueTasks} icon={Clock} color={kpiColor(overdueTasks, true, 5, 10)} statusDot={kpiColor(overdueTasks, true, 5, 10)} drillPath="/kpi/overdue" />
            <KpiTilePM label="Open Risks" value={openRisks} icon={AlertTriangle} color={kpiColor(openRisks, true, 3, 7)} statusDot={kpiColor(openRisks, true, 3, 7)} drillPath="/kpi/risks" />
            <KpiTilePM label="At-Risk Projects" value={atRiskCount} icon={AlertCircle} color={kpiColor(atRiskCount, true, 2, 4)} statusDot={kpiColor(atRiskCount, true, 2, 4)} drillPath="/kpi/at-risk" />
            <KpiTilePM label="Budget Variance" value={varianceStr} icon={TrendingDown} color={varianceColor} statusDot={varianceColor} drillPath="/kpi/budget" />
            <KpiTilePM label="Budget Utilization" value={`${Math.round(utilization)}%`} icon={DollarSign} color={utilColor} statusDot={utilColor} drillPath="/kpi/budget" />
          </div>
        );
      case 'intel':
        return <AISummaryBanner />;
      case 'projects':
        return <ProjectTable projects={projectsWithHealth} />;
      case 'action':
        return <ActionCenterPM projects={projectSummaries} />;
      case 'trend':
        return <IssuesCreatedVsResolvedChart scope={scopeParam} />;
      case 'velocity':
        return <VelocitySparklineWidget projects={projectsWithHealth} />;
      case 'milestones':
        return <MilestonesWidget scope={scopeParam} />;
      case 'budget':
        return <BudgetWatchWidget projects={activeProjects} />;
      case 'activity':
        return <ActivityFeedPM limit={10} />;
      case 'sprint':
        return <SprintSnapshotWidget projects={projectSummaries} />;
      case 'goals':
        return <GoalsWidget />;
      case 'workload':
        return <TeamWorkloadWidget projects={projectSummaries} />;
      case 'standup':
        return <StandupSummaryWidget projects={projectSummaries} />;
      default:
        return null;
    }
  }, [scopeParam, avgHealth, healthColor, overdueTasks, openRisks, atRiskCount, varianceStr, varianceColor, utilization, utilColor, projectsWithHealth, projectSummaries, activeProjects, kpiColor]);

  // ─── Loading state ──────────────────────────────────────────────────────────

  if (myLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400">
            <Eye className="w-3 h-3" />
            Read-only monitoring
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showScopeToggle && (
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => changeScope('mine')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  scope === 'mine'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                My Projects · {myProjects.length}
              </button>
              <button
                onClick={() => changeScope('portfolio')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  scope === 'portfolio'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                All Projects · {allProjects.length}
              </button>
            </div>
          )}
          <CustomizeDropdown
            widgets={PM_WIDGETS}
            enabledIds={enabledIds}
            onToggle={toggleWidget}
            onReset={resetLayout}
          />
        </div>
      </div>

      {/* ── Widget Grid with drag-and-drop ── */}
      <WidgetGrid
        widgets={PM_WIDGETS}
        enabledIds={enabledIds}
        widgetOrder={widgetOrder}
        onReorder={reorder}
        renderWidget={renderWidget}
      />

      {/* ── Footer ── */}
      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-800">
        <span>Last refreshed: {new Date().toLocaleTimeString()}</span>
        <span>PM Assistant v1.0</span>
      </div>

    </div>
  );
}
