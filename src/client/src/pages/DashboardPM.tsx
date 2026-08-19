import { useEffect, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock,
  AlertTriangle,
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
  // Above the fold — essentials only (progressive disclosure: opt-in the rest)
  { id: 'kpi',           label: 'KPI Tiles',              group: 'Overview', defaultOn: true,  size: 'full' },
  { id: 'projects',      label: 'Projects Table',         group: 'Overview', defaultOn: true,  size: 'full' },
  { id: 'briefing',      label: 'Morning Briefing',       group: 'Overview', defaultOn: true,  size: 'full' },
  { id: 'action',        label: 'Action Center',          group: 'Overview', defaultOn: true,  size: 'full' },
  // Below the fold — opt-in via Customize dropdown
  { id: 'intel',         label: 'Portfolio Intelligence',  group: 'AI',       defaultOn: false, size: 'full' },
  { id: 'trend',         label: 'Issues Trend',           group: 'Charts',   defaultOn: false, size: 'full' },
  { id: 'velocity',      label: 'Sprint Velocity',        group: 'Charts',   defaultOn: false, size: 'full' },
  { id: 'milestones',    label: 'Milestones',             group: 'Details',  defaultOn: false, size: 'third' },
  { id: 'budget',        label: 'Budget Watch',           group: 'Details',  defaultOn: false, size: 'third' },
  { id: 'activity',      label: 'Activity Feed',          group: 'Details',  defaultOn: false, size: 'third' },
  { id: 'sprint',        label: 'Sprint Snapshot',        group: 'Details',  defaultOn: false, size: 'full' },
  { id: 'goals',         label: 'Goals Progress',         group: 'Details',  defaultOn: false, size: 'full' },
  { id: 'workload',      label: 'Team Workload',          group: 'Details',  defaultOn: false, size: 'full' },
  { id: 'standup',       label: 'Standup Summary',        group: 'AI',       defaultOn: false, size: 'full' },
];

// ─── KPI computation helpers ──────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DashboardPM() {
  const {
    enabledIds,
    widgetOrder,
    toggleWidget,
    reorder,
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

  const { data: predictions, dataUpdatedAt } = useQuery({
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
  const activeProjects  = myProjects.filter(
    p => p.status !== 'completed' && p.status !== 'cancelled'
  );

  // ─── Unwrap prediction/analytics payloads ─────────────────────────────────

  const pred = predictions?.data || predictions;
  const analytics = analyticsData?.data || analyticsData;

  // Merge health scores
  const healthMap = new Map<string, number>();
  if (pred?.projectHealthScores) {
    for (const h of pred.projectHealthScores) {
      healthMap.set(h.projectId, h.healthScore);
    }
  }
  const projectsWithHealth: ProjectRow[] = activeProjects.map(p => ({
    ...p,
    healthScore: healthMap.get(p.id) ?? p.healthScore,
  }));

  // Slim project list for ActionCenter
  const projectSummaries = activeProjects.map(p => ({ id: p.id, name: p.name }));

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
  // ─── Widget renderer ──────────────────────────────────────────────────────

  const renderWidget = useCallback((id: string): ReactNode => {
    switch (id) {
      case 'briefing':
        return <MorningBriefingWidget scope={undefined} />;
      case 'kpi':
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTilePM label="Portfolio Health" value={`${avgHealth}%`} icon={Activity} color={healthColor} statusDot={healthColor} drillPath="/portfolio" />
            <KpiTilePM label="Overdue Tasks" value={overdueTasks} icon={Clock} color={kpiColor(overdueTasks, true, 5, 10)} statusDot={kpiColor(overdueTasks, true, 5, 10)} drillPath="/kpi/overdue" />
            <KpiTilePM label="Open Risks" value={openRisks} subtitle={atRiskCount > 0 ? `${atRiskCount} project${atRiskCount !== 1 ? 's' : ''} at risk` : undefined} icon={AlertTriangle} color={kpiColor(openRisks, true, 3, 7)} statusDot={kpiColor(openRisks, true, 3, 7)} drillPath="/kpi/risks" />
            <KpiTilePM label="Budget" value={varianceStr} subtitle={`${Math.round(utilization)}% utilized`} icon={DollarSign} color={varianceColor} statusDot={varianceColor} drillPath="/kpi/budget" />
          </div>
        );
      case 'intel':
        return <AISummaryBanner />;
      case 'projects':
        return <ProjectTable projects={projectsWithHealth} />;
      case 'action':
        return <ActionCenterPM projects={projectSummaries} />;
      case 'trend':
        return <IssuesCreatedVsResolvedChart scope={undefined} />;
      case 'velocity':
        return <VelocitySparklineWidget projects={projectsWithHealth} />;
      case 'milestones':
        return <MilestonesWidget scope={undefined} />;
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
  }, [avgHealth, healthColor, overdueTasks, openRisks, atRiskCount, varianceStr, varianceColor, utilization, projectsWithHealth, projectSummaries, activeProjects, kpiColor]);

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
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/projects"
            className="px-3 py-1 text-xs font-medium rounded-md bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-500 transition-colors"
          >
            My Projects · {activeProjects.length}
          </Link>
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
      <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 pt-2 border-t border-gray-100 dark:border-gray-800">
        <span>Updated {dataUpdatedAt ? formatRelativeTime(dataUpdatedAt) : '—'}</span>
        <span>Kovarti PM</span>
      </div>

    </div>
  );
}
