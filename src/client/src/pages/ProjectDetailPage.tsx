import React, { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  TrendingUp,
  Clock,
  ShieldAlert,
  Play,
  ChevronDown,
  Download,
  Printer,
  Save,
  Pencil,
  Zap,
} from 'lucide-react';
import { apiService } from '../services/api';
import { useUIStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { SaveAsTemplateModal } from '../components/templates/SaveAsTemplateModal';
import { usePresence } from '../hooks/usePresence';
import { SetupChecklist } from '../components/project/SetupChecklist';
import { ProjectReadinessBar } from '../components/onboarding/ProjectReadinessBar';
import { EditProjectModal } from '../components/project/EditProjectModal';
import { getPrimaryTabs, getOverflowTabs, getDefaultViewMode, type Methodology } from '../utils/methodology';
import { PresenceIndicator } from '../components/presence/PresenceIndicator';

// Lazy-loaded tab components
const OverviewTab = lazy(() => import('./ProjectDetailPage/OverviewTab').then(m => ({ default: m.OverviewTab })));
const AIInsightsTab = lazy(() => import('./ProjectDetailPage/AIInsightsTab').then(m => ({ default: m.AIInsightsTab })));
const ScenariosTab = lazy(() => import('./ProjectDetailPage/ScenariosTab').then(m => ({ default: m.ScenariosTab })));
const AgentActivityTab = lazy(() => import('./ProjectDetailPage/AgentActivityTab').then(m => ({ default: m.AgentActivityTab })));
const RAIDTab = lazy(() => import('./ProjectDetailPage/RAIDTab').then(m => ({ default: m.RAIDTab })));
const ScheduleTab = lazy(() => import('./ProjectDetailPage/ScheduleTab').then(m => ({ default: m.ScheduleTab })));
const ChangeRequestsTab = lazy(() => import('./ProjectDetailPage/ChangeRequestsTab').then(m => ({ default: m.ChangeRequestsTab })));
const SprintsTab = lazy(() => import('./ProjectDetailPage/SprintsTab').then(m => ({ default: m.SprintsTab })));
const TeamTab = lazy(() => import('./ProjectDetailPage/TeamTab').then(m => ({ default: m.TeamTab })));
const PerformancePanel = lazy(() => import('../components/evm/PerformancePanel').then(m => ({ default: m.PerformancePanel })));
const ResourcesTab = lazy(() => import('../components/project/ResourcesTab').then(m => ({ default: m.ResourcesTab })));
const BacklogView = lazy(() => import('../components/backlog/BacklogView').then(m => ({ default: m.BacklogView })));
const TimeTrackingTab = lazy(() => import('../components/project/TimeTrackingTab').then(m => ({ default: m.TimeTrackingTab })));
const BudgetTab = lazy(() => import('../components/project/BudgetTab').then(m => ({ default: m.BudgetTab })));
const AttachmentPanel = lazy(() => import('../components/attachments/AttachmentPanel').then(m => ({ default: m.AttachmentPanel })));

type Tab = 'overview' | 'schedule' | 'raid' | 'ai-insights' | 'performance' | 'scenarios' | 'team' | 'agent-activity' | 'change-requests' | 'sprints' | 'backlog' | 'resources' | 'time' | 'files' | 'budget';


const statusStyles: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-100 text-green-700' },
  planning: { label: 'Planning', color: 'bg-purple-100 text-purple-700' },
  on_hold: { label: 'On Hold', color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Completed', color: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300' },
};



function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  );
}


// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs: Tab[] = ['overview', 'schedule', 'raid', 'ai-insights', 'performance', 'scenarios', 'team', 'agent-activity', 'change-requests', 'sprints', 'backlog', 'resources', 'time', 'files', 'budget'];
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTabState] = useState<Tab>(tabParam && validTabs.includes(tabParam) ? tabParam : 'overview');
  const setActiveTab = (tab: Tab) => {
    setActiveTabState(tab);
    setSearchParams(tab === 'overview' ? {} : { tab }, { replace: true });
  };
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [showEditProject, setShowEditProject] = useState(false);

  const { user } = useAuthStore();
  const canEditStatus = user?.role === 'admin' || user?.role === 'project_manager';
  const { viewers: presenceViewers, editors: presenceEditors } = usePresence(id);
  const otherViewers = presenceViewers.filter(v => v.userId !== user?.id);

  const queryClient = useQueryClient();

  // Single batch request replaces 5+ sequential queries
  const {
    data: summaryData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['project-summary', id],
    queryFn: () => apiService.getProjectSummary(id!),
    enabled: !!id,
    staleTime: 60_000,
  });

  // Seed individual caches so child components (OverviewTab, ScheduleTab, etc.)
  // get instant cache hits instead of making their own requests
  useEffect(() => {
    if (!summaryData || !id) return;
    queryClient.setQueryData(['project', id], { project: summaryData.project });
    queryClient.setQueryData(['schedules', id], { schedules: summaryData.schedules });
    queryClient.setQueryData(['project-risks-stats', id], { data: summaryData.riskStats });
    queryClient.setQueryData(['project-members', id], { members: summaryData.members });
    queryClient.setQueryData(['sprints', id], { data: summaryData.sprints });
    const firstScheduleId = summaryData.schedules?.[0]?.id;
    if (firstScheduleId) {
      queryClient.setQueryData(['tasks', firstScheduleId], { data: summaryData.tasks, total: summaryData.tasks?.length || 0, page: 1, pageSize: 1000, totalPages: 1 });
      queryClient.setQueryData(['tasks', firstScheduleId, 'overview'], { tasks: summaryData.tasks });
    }
  }, [summaryData, id, queryClient]);

  const project = summaryData?.project;

  const riskStats = summaryData?.riskStats;

  const readinessTasks: any[] = summaryData?.tasks || [];

  const { data: readinessResourcesData } = useQuery({
    queryKey: ['resources'],
    queryFn: () => apiService.getResources(),
    staleTime: 120_000,
  });
  const readinessResources: any[] = readinessResourcesData?.resources || [];

  // Sprint count for readiness bar (agile/hybrid)
  const methodology: Methodology = (project?.methodology || 'waterfall') as Methodology;
  const sprintCount = (summaryData?.sprints || []).length;

  // Velocity data for agile/hybrid context cards (not in summary — lightweight separate call)
  const { data: velocityData } = useQuery({
    queryKey: ['sprint-velocity', id],
    queryFn: () => apiService.getVelocityHistory(id!),
    enabled: !!id && methodology !== 'waterfall',
    staleTime: 120_000,
  });

  const velocitySprints: any[] = velocityData?.velocity?.sprints || [];
  const avgVelocity = velocitySprints.length > 0
    ? Math.round(velocitySprints.reduce((a: number, v: any) => a + (v.velocity || 0), 0) / velocitySprints.length)
    : null;

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const statusMutation = useMutation({
    mutationFn: ({ status, cancellationReason }: { status: string; cancellationReason?: string }) =>
      apiService.updateProjectStatus(id!, status, cancellationReason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      setShowCancelModal(false);
      setCancelReason('');
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiService.updateProject(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setShowEditProject(false);
    },
  });

  // Prefetch EVM data on project open — so Performance tab loads instantly
  useEffect(() => {
    if (id) {
      queryClient.prefetchQuery({
        queryKey: ['evmForecast', id],
        queryFn: () => apiService.getEVMForecast(id),
        staleTime: 5 * 60 * 1000,
      });
      queryClient.prefetchQuery({
        queryKey: ['evmForecastAI', id],
        queryFn: () => apiService.getEVMAIPredictions(id),
        staleTime: 5 * 60 * 1000,
      }).catch(() => { /* AI predictions are optional — budget exceeded or AI disabled */ });
    }
  }, [id, queryClient]);

  // Set AI panel context when project loads
  useEffect(() => {
    if (project) {
      useUIStore.getState().setAIPanelContext({
        type: 'project',
        projectId: id,
        projectName: project.name,
      });
    }
  }, [project, id]);

  // Close export menu on click outside
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-gray-500 dark:text-gray-400">Project not found</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const status = statusStyles[project.status] || statusStyles.planning;
  const progress = project.progressPercentage || project.progress_percentage || 0;
  const budgetAllocated = project.budgetAllocated || project.budget_allocated || 0;
  const budgetSpent = project.budgetSpent || project.budget_spent || 0;
  const budgetPct =
    budgetAllocated > 0 ? Math.round((budgetSpent / budgetAllocated) * 100) : 0;

  const daysRemaining =
    project.endDate || project.end_date
      ? Math.ceil(
          (new Date(project.endDate || project.end_date).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      : null;

  return (
    <div className="space-y-6">
      {/* Back Button + Header */}
      <div>
        <button
          onClick={() => navigate('/dashboard')}
          className="mb-3 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 transition-colors hover:text-gray-700 dark:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white break-words">{project.name}</h1>
              {canEditStatus ? (
                <select
                  value={project.status}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    if (newStatus === 'cancelled') {
                      setShowCancelModal(true);
                    } else {
                      statusMutation.mutate({ status: newStatus });
                    }
                  }}
                  disabled={statusMutation.isPending}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer border border-current border-opacity-30 outline-none pr-5 ${status.color} ${statusMutation.isPending ? 'opacity-60' : 'hover:opacity-80'}`}
                >
                  <option value="planning">Planning</option>
                  <option value="active">Active</option>
                  <option value="on_hold">On Hold</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              ) : (
                <>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.color}`}
                  >
                    {status.label}
                  </span>
                  {project.status === 'planning' && (
                    <button
                      onClick={() => statusMutation.mutate({ status: 'active' })}
                      disabled={statusMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1 text-xs font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" />
                      Start Project
                    </button>
                  )}
                </>
              )}
            </div>
            {(project.description) && (
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{project.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap sm:flex-nowrap">
            {otherViewers.length > 0 && (
              <PresenceIndicator variant="avatars" users={otherViewers} />
            )}
            {canEditStatus && (
              <button
                onClick={() => setShowEditProject(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            <button
              onClick={() => setShowSaveTemplate(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 border border-primary-200 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded-lg transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              Save as Template
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export
                <ChevronDown className="w-3 h-3" />
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
                  <button
                    onClick={() => { apiService.exportProjectCSV(id!); setShowExportMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export as CSV
                  </button>
                  <button
                    onClick={() => { apiService.exportProjectXML(id!); setShowExportMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export for MS Project
                  </button>
                  <button
                    onClick={() => { apiService.exportProjectPDF(id!); setShowExportMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export as PDF
                  </button>
                  <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                  <button
                    onClick={() => { window.print(); setShowExportMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Gantt
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {methodology === 'agile' ? (
          <ContextCard
            label="Velocity"
            value={avgVelocity != null ? `${avgVelocity} pts` : '--'}
            icon={Zap}
            color="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
            detail={<p className="mt-1 text-xs text-gray-500">avg pts/sprint</p>}
          />
        ) : (
          <ContextCard
            label="Progress"
            value={`${progress}%`}
            icon={TrendingUp}
            color="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
            detail={
              <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            }
          />
        )}
        <ContextCard
          label="Budget"
          value={budgetAllocated > 0 ? `$${(budgetSpent / 1000).toFixed(0)}K / $${(budgetAllocated / 1000).toFixed(0)}K` : 'Not set'}
          icon={DollarSign}
          color={budgetAllocated === 0
            ? 'bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500'
            : budgetPct > 90 ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'}
          detail={budgetAllocated > 0 ? (
            <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className={`h-full rounded-full transition-all ${
                  budgetPct > 90 ? 'bg-red-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(budgetPct, 100)}%` }}
              />
            </div>
          ) : undefined}
        />
        <ContextCard
          label="Timeline"
          value={
            daysRemaining !== null ? `${daysRemaining}d remaining` : 'No end date'
          }
          icon={Clock}
          color={
            daysRemaining !== null && daysRemaining < 14
              ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
              : 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
          }
        />
        <ContextCard
          label="Risks"
          value={riskStats ? `${riskStats.openRisks || 0} Open` : '—'}
          icon={ShieldAlert}
          color={
            riskStats?.critical > 0
              ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400'
              : riskStats?.openRisks > 0
                ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                : 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400'
          }
          detail={riskStats?.critical > 0 ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400 font-medium">{riskStats.critical} critical</p>
          ) : undefined}
        />
        {methodology === 'agile' ? (
          <ContextCard
            label="Sprint"
            value={sprintCount > 0 ? `${sprintCount} sprint${sprintCount !== 1 ? 's' : ''}` : 'No sprints'}
            icon={Zap}
            color="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
          />
        ) : methodology === 'hybrid' ? (
          <ContextCard
            label="Velocity"
            value={avgVelocity != null ? `${avgVelocity} pts` : '--'}
            icon={Zap}
            color="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
            detail={<p className="mt-1 text-xs text-gray-500">avg pts/sprint</p>}
          />
        ) : (
          <ContextCard
            label="Status"
            value={status.label}
            icon={Calendar}
            color={status.color}
          />
        )}
      </div>

      {/* Readiness Bar */}
      <ProjectReadinessBar
        projectId={id!}
        tasks={readinessTasks}
        resources={readinessResources}
        methodology={methodology}
        sprintCount={sprintCount}
        onTabChange={(tab) => setActiveTab(tab as Tab)}
      />

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        <nav className="-mb-px flex gap-3 sm:gap-4 md:gap-6">
          {getPrimaryTabs(methodology).map((tab) => {
            const criticalCount = tab.id === 'raid' ? (riskStats?.critical ?? 0) : 0;
            return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 pb-3 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
              {tab.id === 'raid' && criticalCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {criticalCount}
                </span>
              )}
            </button>
            );
          })}
          <TabOverflow
            tabs={getOverflowTabs(methodology)}
            activeTab={activeTab}
            onSelect={setActiveTab}
          />
        </nav>
      </div>

      {/* Setup Checklist */}
      {activeTab === 'overview' && <SetupChecklist project={project} onNavigate={(tab) => setActiveTab(tab as Tab)} />}

      {/* Tab Content */}
      <Suspense fallback={<SectionSpinner />}>
        {activeTab === 'overview' && <OverviewTab project={project} onNavigateToTab={(tab) => setActiveTab(tab as Tab)} canEdit={canEditStatus} presenceEditors={presenceEditors} currentUserId={user?.id} />}
        {activeTab === 'raid' && <RAIDTab projectId={id!} projectName={project.name} />}
        {activeTab === 'schedule' && <ScheduleTab projectId={id!} projectName={project.name} projectStartDate={project.startDate || project.start_date} defaultViewMode={getDefaultViewMode(methodology)} />}
        {activeTab === 'ai-insights' && <AIInsightsTab projectId={id!} />}
        {activeTab === 'performance' && <PerformancePanel projectId={id!} onNavigate={(tab) => setActiveTab(tab as Tab)} />}
        {activeTab === 'scenarios' && <ScenariosTab projectId={id!} />}
        {activeTab === 'team' && <TeamTab projectId={id!} />}
        {activeTab === 'agent-activity' && <AgentActivityTab projectId={id!} />}
        {activeTab === 'change-requests' && <ChangeRequestsTab projectId={id!} />}
        {activeTab === 'sprints' && <SprintsTab projectId={id!} />}
        {activeTab === 'backlog' && <BacklogView projectId={id!} />}
        {activeTab === 'resources' && <ResourcesTab projectId={id!} />}
        {activeTab === 'time' && <TimeTrackingTab projectId={id!} />}
        {activeTab === 'budget' && <BudgetTab projectId={id!} project={project} />}
        {activeTab === 'files' && (
          <div className="mt-6">
            <AttachmentPanel entityType="project" entityId={id!} />
          </div>
        )}
      </Suspense>

      {project && (
        <SaveAsTemplateModal
          isOpen={showSaveTemplate}
          onClose={() => setShowSaveTemplate(false)}
          projectId={id!}
          projectName={project.name}
        />
      )}
      {showEditProject && project && (
        <EditProjectModal
          project={project}
          onSave={(data) => updateProjectMutation.mutate(data)}
          onClose={() => setShowEditProject(false)}
          saving={updateProjectMutation.isPending}
        />
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowCancelModal(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Cancel Project</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Please provide a reason for cancelling this project. This action will be recorded in the audit trail.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation..."
              rows={3}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none resize-none"
              autoFocus
            />
            {statusMutation.isError && (
              <p className="text-sm text-red-600 mt-2">Failed to cancel project. Please try again.</p>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => { setShowCancelModal(false); setCancelReason(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => statusMutation.mutate({ status: 'cancelled', cancellationReason: cancelReason.trim() })}
                disabled={!cancelReason.trim() || statusMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {statusMutation.isPending ? 'Cancelling...' : 'Cancel Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context Card
// ---------------------------------------------------------------------------

function ContextCard({
  label,
  value,
  icon: Icon,
  color,
  detail,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  detail?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <p className="mt-2 text-lg font-bold text-gray-900 dark:text-white">{value}</p>
      {detail}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab Overflow Dropdown (⋯)
// ---------------------------------------------------------------------------

function TabOverflow({
  tabs: overflowTabs,
  activeTab,
  onSelect,
}: {
  tabs: { id: Tab; label: string }[];
  activeTab: Tab;
  onSelect: (id: Tab) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActiveInOverflow = overflowTabs.some(t => t.id === activeTab);
  const activeLabel = overflowTabs.find(t => t.id === activeTab)?.label;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`border-b-2 pb-3 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1 ${
          isActiveInOverflow
            ? 'border-primary-600 text-primary-600 dark:text-primary-400'
            : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
        }`}
      >
        {isActiveInOverflow ? activeLabel : 'More'}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
          {overflowTabs.map(t => (
            <button
              key={t.id}
              onClick={() => { onSelect(t.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                activeTab === t.id
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

