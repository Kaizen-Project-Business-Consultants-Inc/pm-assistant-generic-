import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  BarChart3,
  Kanban,
  Users,
  Activity,
  Target,
  DollarSign,
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  CalendarClock,
  Plus,
  ChevronDown,
  Link2,
  MessageSquare,
  Flag,
  Paperclip,
  GripVertical,
  Mic,
  FileText,
  BookOpen,
  X,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { ProjectBriefCard } from '../../components/project/ProjectBriefCard';
import { CustomFieldsSection } from '../../components/customfields/CustomFieldsSection';
import { PortalLinkManager } from '../../components/portal/PortalLinkManager';

interface ProjectOverview {
  id: string;
  name?: string;
  description?: string;
  priority?: string;
  category?: string;
  type?: string;
  status?: string;
  methodology?: string;
  location?: string;
  currency?: string;
  budgetAllocated?: number;
  budgetSpent?: number;
  startDate?: string;
  start_date?: string;
  endDate?: string;
  end_date?: string;
  updatedAt?: string;
  updated_at?: string;
}

type CardId = 'brief' | 'task-summary' | 'timeline' | 'milestones' | 'health' | 'evm' | 'budget' | 'due-soon' | 'raid' | 'sprint' | 'activity' | 'blocked' | 'comments' | 'goals' | 'attachments' | 'latest-meeting';

const DEFAULT_CARD_ORDER: CardId[] = [
  'brief',
  'task-summary', 'timeline', 'milestones',
  'health', 'evm', 'budget',
  'due-soon', 'raid', 'sprint',
  'activity', 'blocked', 'comments',
  'goals', 'attachments', 'latest-meeting',
];

export function OverviewTab({ project, onNavigateToTab, canEdit, presenceEditors, currentUserId }: { project: ProjectOverview; onNavigateToTab?: (tab: string) => void; canEdit?: boolean; presenceEditors?: { userId: string; username: string; field: string }[]; currentUserId?: string }) {
  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['project-members', project.id],
    queryFn: () => apiService.getProjectMembers(project.id),
    enabled: !!project.id,
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['project-analytics', project.id],
    queryFn: () => apiService.getProjectAnalyticsSummary(project.id),
    enabled: !!project.id,
  });

  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', project.id],
    queryFn: () => apiService.getSchedules(project.id),
    enabled: !!project.id,
  });
  const schedules: any[] = schedulesData?.schedules || [];
  const primaryScheduleId = schedules.length > 0 ? schedules[0].id : null;

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', primaryScheduleId, 'overview'],
    queryFn: () => apiService.getTasks(primaryScheduleId!),
    enabled: !!primaryScheduleId,
    staleTime: 60_000,
  });
  const allTasks: any[] = tasksData?.tasks || [];
  const milestones = allTasks
    .filter((t: any) => t.isMilestone || t.is_milestone)
    .sort((a: any, b: any) => {
      const da = a.endDate || a.end_date || a.startDate || a.start_date || '';
      const db = b.endDate || b.end_date || b.startDate || b.start_date || '';
      return da.localeCompare(db);
    })
    .slice(0, 5);

  const { data: raidStats } = useQuery({
    queryKey: ['raidStats', project.id],
    queryFn: () => apiService.getRiskStats(project.id),
    enabled: !!project.id,
    staleTime: 60_000,
  });

  const { data: sprintData } = useQuery({
    queryKey: ['sprints', project.id, 'active'],
    queryFn: () => apiService.getSprints(project.id),
    enabled: !!project.id,
    staleTime: 60_000,
  });
  const activeSprint = (sprintData?.data || sprintData?.sprints || []).find((s: any) => s.status === 'active');

  const { data: auditData } = useQuery({
    queryKey: ['auditTrail', project.id, 'overview'],
    queryFn: () => apiService.getAuditTrail(project.id, 50),
    enabled: !!project.id,
    staleTime: 60_000,
  });
  const recentActivity: any[] = auditData?.activities || [];

  const { data: velocityData } = useQuery({
    queryKey: ['velocity', primaryScheduleId, 'overview'],
    queryFn: () => apiService.getVelocityData(primaryScheduleId!),
    enabled: !!primaryScheduleId,
    staleTime: 300_000,
  });

  const { data: goalsData } = useQuery({
    queryKey: ['goals', project.id, 'overview'],
    queryFn: () => apiService.listGoals({ projectId: project.id }),
    enabled: !!project.id,
    staleTime: 300_000,
  });
  const goals: any[] = goalsData?.goals || goalsData?.data || (Array.isArray(goalsData) ? goalsData : []);

  const { data: attachmentsData } = useQuery({
    queryKey: ['attachments', 'project', project.id, 'overview'],
    queryFn: () => apiService.getAttachments('project', project.id),
    enabled: !!project.id,
    staleTime: 300_000,
  });
  const attachments: any[] = attachmentsData?.attachments || attachmentsData?.data || (Array.isArray(attachmentsData) ? attachmentsData : []);

  const { data: meetingData } = useQuery({
    queryKey: ['meeting-history', project.id, 'overview'],
    queryFn: () => apiService.getMeetingHistory(project.id),
    enabled: !!project.id,
    staleTime: 300_000,
  });
  const meetings: any[] = meetingData?.analyses || meetingData?.history || (Array.isArray(meetingData) ? meetingData : []);
  const latestMeeting = meetings.length > 0 ? meetings[0] : null;

  const { data: healthHistoryData } = useQuery({
    queryKey: ['health-history', project.id],
    queryFn: () => apiService.getHealthHistory(project.id, 30),
    enabled: !!project.id,
    staleTime: 300_000,
  });
  const healthHistory: Array<{ healthScore: number; recordedAt: string }> = healthHistoryData?.history || healthHistoryData || [];

  const { data: evmData } = useQuery({
    queryKey: ['evm-overview', project.id],
    queryFn: () => apiService.getEVMForecast(project.id),
    enabled: !!project.id,
    staleTime: 300_000,
  });

  // Kickoff lessons — show relevant lessons for planning-stage projects
  const [dismissedKickoffLessons, setDismissedKickoffLessons] = useState(false);
  const { data: kickoffLessonsData } = useQuery({
    queryKey: ['kickoff-lessons', project.type, project.category],
    queryFn: () => apiService.getRelevantLessons(project.type || undefined, project.category || undefined),
    enabled: project.status === 'planning' && !dismissedKickoffLessons,
    staleTime: 300_000,
  });
  const kickoffLessons: any[] = (kickoffLessonsData?.lessons || []).slice(0, 5);

  const members: any[] = membersData?.members || [];
  const summary = analyticsData?.summary || analyticsData;

  const formatDate = (d: string | undefined) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  const priorityColors: Record<string, string> = {
    urgent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  };

  const startDate = project.startDate || project.start_date;
  const endDate = project.endDate || project.end_date;

  const now = new Date();
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  const elapsedPct = start && end && end > start
    ? Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
    : 0;
  const taskProgressPct = summary?.portfolio?.avgProgress ?? summary?.tasks?.completionRate ?? 0;
  const isOverdue = end ? now > end : false;
  const onTrack = isOverdue ? false : taskProgressPct >= elapsedPct - 10;

  const budgetAllocated = project.budgetAllocated || 0;
  const budgetSpent = project.budgetSpent || 0;
  const budgetUtilization = budgetAllocated > 0 ? Math.round((budgetSpent / budgetAllocated) * 100) : 0;
  const isOverBudget = budgetUtilization > 100;
  const budgetCurrency = (project.currency || 'USD').toUpperCase();

  const currentHealth = healthHistory.length > 0 ? healthHistory[healthHistory.length - 1]?.healthScore ?? healthHistory[0]?.healthScore : null;
  const healthTrend: 'improving' | 'declining' | 'stable' = (() => {
    if (healthHistory.length < 2) return 'stable';
    const recent = healthHistory[healthHistory.length - 1]?.healthScore ?? healthHistory[0]?.healthScore;
    const older = healthHistory.length >= 7 ? healthHistory[healthHistory.length - 7]?.healthScore ?? healthHistory[Math.max(0, healthHistory.length - 7)]?.healthScore : healthHistory[0]?.healthScore;
    if (recent == null || older == null) return 'stable';
    const diff = recent - older;
    if (diff > 2) return 'improving';
    if (diff < -2) return 'declining';
    return 'stable';
  })();

  const cpi: number | null = evmData?.currentMetrics?.CPI ?? null;
  const spi: number | null = evmData?.currentMetrics?.SPI ?? null;
  const eac: number | null = evmData?.currentMetrics?.EAC ?? null;

  const dueSoonTasks = allTasks
    .filter((t: any) => {
      if (t.status === 'completed' || t.status === 'done') return false;
      const dueDate = t.endDate || t.end_date || t.dueDate || t.due_date;
      if (!dueDate) return false;
      const due = new Date(dueDate);
      const in7Days = new Date();
      in7Days.setDate(in7Days.getDate() + 7);
      return due >= now && due <= in7Days;
    })
    .sort((a: any, b: any) => {
      const da = a.endDate || a.end_date || a.dueDate || a.due_date || '';
      const db = b.endDate || b.end_date || b.dueDate || b.due_date || '';
      return da.localeCompare(db);
    })
    .slice(0, 5);

  const methodology = project.methodology || 'waterfall';

  const manager = members.find((m: any) => m.role === 'owner' || m.role === 'manager');
  const managerName = manager ? (manager.user?.name || manager.name || manager.email) : 'Not assigned';

  const maxVisibleMembers = 6;
  const visibleMembers = members.slice(0, maxVisibleMembers);
  const overflowCount = members.length - maxVisibleMembers;

  const taskStats = summary?.tasks;

  const raidTrend = (() => {
    if (!recentActivity.length) return null;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    let opened = 0;
    let closed = 0;
    for (const a of recentActivity) {
      const ts = new Date(a.createdAt || a.timestamp);
      if (ts < weekAgo) continue;
      const action = (a.action || a.description || a.summary || '').toLowerCase();
      if (action.includes('risk') || action.includes('issue') || action.includes('raid')) {
        if (action.includes('creat') || action.includes('add') || action.includes('open')) opened++;
        if (action.includes('clos') || action.includes('mitigat') || action.includes('resolv')) closed++;
      }
    }
    if (opened === 0 && closed === 0) return null;
    return { opened, closed, net: opened - closed };
  })();

  const memberWorkload = (() => {
    if (!members.length || !allTasks.length) return [];
    const activeTasks = allTasks.filter((t: any) => t.status !== 'completed' && t.status !== 'done' && t.status !== 'cancelled');
    const counts: Record<string, number> = {};
    for (const t of activeTasks) {
      const assignee = t.assignedTo || t.assigned_to || t.assigneeId || t.assignee_id;
      if (assignee) counts[assignee] = (counts[assignee] || 0) + 1;
    }
    const maxCount = Math.max(1, ...Object.values(counts));
    return members.slice(0, 6).map((m: any) => {
      const userId = m.userId || m.user_id || m.user?.id || m.id;
      const name = m.user?.name || m.name || m.email || 'Unknown';
      const count = counts[userId] || 0;
      return { name: name.split(' ')[0], count, pct: (count / maxCount) * 100 };
    });
  })();

  const completionForecast = (() => {
    const avgVelocity = velocityData?.averageVelocity;
    if (!avgVelocity || avgVelocity <= 0) return null;
    const totalTasks = taskStats?.total ?? allTasks.length;
    const completedTasks = taskStats?.byStatus?.completed ?? 0;
    const remaining = totalTasks - completedTasks;
    if (remaining <= 0) return { date: null, label: 'All tasks complete' };
    const weeksRemaining = remaining / avgVelocity;
    const forecastDate = new Date();
    forecastDate.setDate(forecastDate.getDate() + Math.ceil(weeksRemaining * 7));
    return { date: forecastDate, label: forecastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
  })();

  const blockedTasks = allTasks.filter((t: any) => {
    if (t.status === 'completed' || t.status === 'done' || t.status === 'cancelled') return false;
    const deps: any[] = t.dependencies || [];
    if (deps.length === 0) return false;
    return deps.some((d: any) => {
      const depTask = allTasks.find((dt: any) => dt.id === d.dependencyId || dt.id === d.dependency_id);
      return depTask && depTask.status !== 'completed' && depTask.status !== 'done';
    });
  }).slice(0, 5);

  const recentComments = recentActivity
    .filter((a: any) => {
      const action = (a.action || a.description || a.summary || '').toLowerCase();
      return action.includes('comment') || action.includes('mention');
    })
    .slice(0, 5);

  // ── Card order + drag-to-reorder ──────────────────
  const [cardOrder, setCardOrder] = useState<CardId[]>(() => {
    try {
      const saved = localStorage.getItem('overview-card-order');
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const validIds = new Set<string>(DEFAULT_CARD_ORDER);
        const filtered = parsed.filter(id => validIds.has(id)) as CardId[];
        const missing = DEFAULT_CARD_ORDER.filter(id => !filtered.includes(id));
        return [...filtered, ...missing];
      }
    } catch { /* noop */ }
    return [...DEFAULT_CARD_ORDER];
  });
  const [dragId, setDragId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, cardId: string) => {
    setDragId(cardId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', cardId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragId || dragId === targetId) return;
    setCardOrder(prev => {
      const next = [...prev];
      const from = next.indexOf(dragId as CardId);
      const to = next.indexOf(targetId as CardId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragId as CardId);
      try { localStorage.setItem('overview-card-order', JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, [dragId]);

  const handleDragEnd = useCallback(() => { setDragId(null); }, []);

  const resetCardOrder = useCallback(() => {
    setCardOrder([...DEFAULT_CARD_ORDER]);
    try { localStorage.removeItem('overview-card-order'); } catch { /* noop */ }
  }, []);

  // Animate progress bars on mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }, []);

  // ── Card metadata ──────────────────────────────
  const cardMeta: Record<CardId, { icon: ReactNode; title: string }> = {
    'brief': { icon: <FileText className="w-4 h-4" />, title: 'Project Brief' },
    'task-summary': { icon: <BarChart3 className="w-4 h-4" />, title: 'Task Summary' },
    'timeline': { icon: <Clock className="w-4 h-4" />, title: 'Timeline Progress' },
    'milestones': { icon: <Target className="w-4 h-4" />, title: 'Key Milestones' },
    'health': { icon: <Heart className="w-4 h-4" />, title: 'Project Health' },
    'evm': { icon: <TrendingUp className="w-4 h-4" />, title: 'Earned Value' },
    'budget': { icon: <DollarSign className="w-4 h-4" />, title: 'Budget' },
    'due-soon': { icon: <CalendarClock className="w-4 h-4" />, title: 'Due This Week' },
    'raid': { icon: <ShieldAlert className="w-4 h-4" />, title: 'RAID Summary' },
    'sprint': { icon: <Kanban className="w-4 h-4" />, title: activeSprint ? 'Current Sprint' : 'Sprint' },
    'activity': { icon: <Activity className="w-4 h-4" />, title: 'Recent Activity' },
    'blocked': { icon: <Link2 className="w-4 h-4" />, title: `Blocked Tasks (${blockedTasks.length})` },
    'comments': { icon: <MessageSquare className="w-4 h-4" />, title: 'Recent Comments' },
    'goals': { icon: <Flag className="w-4 h-4" />, title: `Goals (${goals.length})` },
    'attachments': { icon: <Paperclip className="w-4 h-4" />, title: `Files (${attachments.length})` },
    'latest-meeting': { icon: <Mic className="w-4 h-4" />, title: 'Latest Meeting' },
  };

  const isCardVisible = (id: CardId): boolean => {
    switch (id) {
      case 'sprint': return methodology !== 'waterfall';
      case 'blocked': return blockedTasks.length > 0;
      case 'comments': return recentComments.length > 0;
      case 'goals': return goals.length > 0;
      case 'attachments': return attachments.length > 0;
      case 'latest-meeting': return meetings.length > 0;
      default: return true;
    }
  };

  const cardClass = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 min-h-[200px]';
  const skeletonPulse = 'animate-pulse bg-gray-200 dark:bg-gray-700 rounded';

  // ── Card content ──────────────────────────────
  const cardContent: Record<CardId, ReactNode> = {
    'brief': (
      <ProjectBriefCard
        projectId={project.id}
        description={project.description}
        canEdit={canEdit ?? false}
        cardClass=""
        presenceEditors={presenceEditors}
        currentUserId={currentUserId}
        updatedAt={project.updatedAt || project.updated_at}
      />
    ),
    'task-summary': analyticsLoading ? (
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => <div key={i} className={`h-16 ${skeletonPulse}`} />)}
      </div>
    ) : (
      <>
        <div className="grid grid-cols-2 gap-3">
          <StatBox label="Total Tasks" value={taskStats?.total ?? 0} onClick={() => onNavigateToTab?.('schedule')} />
          <StatBox label="Completed" value={taskStats?.byStatus?.completed ?? 0} color="text-green-600 dark:text-green-400" onClick={() => onNavigateToTab?.('schedule')} />
          <StatBox label="Overdue" value={taskStats?.overdue ?? 0} color={taskStats?.overdue > 0 ? 'text-red-600 dark:text-red-400' : undefined} onClick={() => onNavigateToTab?.('schedule')} />
          <StatBox label="In Progress" value={taskStats?.byStatus?.in_progress ?? 0} color="text-blue-600 dark:text-blue-400" onClick={() => onNavigateToTab?.('schedule')} />
        </div>
        {taskStats?.completedLast30Days != null && (
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Completed last 30 days: {taskStats.completedLast30Days}
          </p>
        )}
      </>
    ),

    'timeline': !start || !end ? (
      <EmptyState icon={<Clock className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No start/end dates set" cta="Set dates" onAction={() => onNavigateToTab?.('settings')} />
    ) : (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Elapsed</span>
            <span className="ml-1 font-semibold text-gray-900 dark:text-white">{Math.round(elapsedPct)}%</span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Complete</span>
            <span className="ml-1 font-semibold text-gray-900 dark:text-white">{Math.round(taskProgressPct)}%</span>
          </div>
        </div>
        <div className="relative">
          <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${isOverdue ? 'bg-red-500' : onTrack ? 'bg-green-500' : 'bg-orange-500'}`}
              style={{ width: mounted ? `${Math.min(100, elapsedPct)}%` : '0%' }}
            />
          </div>
          {elapsedPct > 0 && elapsedPct < 100 && (
            <div className="absolute top-0 w-0.5 h-3 bg-gray-900 dark:bg-white" style={{ left: `${elapsedPct}%` }} title="Today" />
          )}
        </div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{formatDate(startDate)}</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">Today</span>
          <span>{formatDate(endDate)}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isOverdue ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Overdue
              </span>
            ) : onTrack ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> On track
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400">
                <AlertTriangle className="w-3.5 h-3.5" /> Behind schedule
              </span>
            )}
          </div>
          {completionForecast && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {completionForecast.date
                ? <>Est. completion: <span className={`font-medium ${end && completionForecast.date > end ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>{completionForecast.label}</span></>
                : <span className="text-green-600 dark:text-green-400 font-medium">{completionForecast.label}</span>
              }
            </span>
          )}
        </div>
      </div>
    ),

    'milestones': tasksLoading || (!primaryScheduleId && schedules.length === 0) ? (
      !primaryScheduleId && !tasksLoading ? (
        <EmptyState icon={<Target className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No schedule created yet" cta="Create schedule" onAction={() => onNavigateToTab?.('schedule')} />
      ) : (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className={`h-10 ${skeletonPulse}`} />)}
        </div>
      )
    ) : milestones.length === 0 ? (
      <EmptyState icon={<Target className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No milestones defined" cta="Mark milestones in Schedule" onAction={() => onNavigateToTab?.('schedule')} />
    ) : (
      <div className="space-y-2.5">
        {milestones.map((m: any) => {
          const mDate = m.endDate || m.end_date || m.startDate || m.start_date;
          const mStatus = m.status || 'not_started';
          const isPast = mDate && new Date(mDate) < now;
          const isDone = mStatus === 'completed' || mStatus === 'done';
          return (
            <div
              key={m.id}
              className="flex items-start gap-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-1 rounded-lg transition-colors"
              onClick={() => onNavigateToTab?.('schedule')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigateToTab?.('schedule'); } }}
            >
              <div className="mt-0.5 flex-shrink-0">
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : isPast ? (
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                ) : (
                  <div className="w-3 h-3 mt-0.5 rotate-45 border-2 border-primary-500 bg-transparent" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium truncate ${isDone ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                  {m.name}
                </p>
                <p className={`text-xs ${isPast && !isDone ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                  {mDate ? formatDate(mDate) : 'No date'}
                  {isPast && !isDone && ' — overdue'}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    ),

    'health': currentHealth === null ? (
      <EmptyState icon={<Heart className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No health data yet" cta={undefined} />
    ) : (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white ${
            currentHealth >= 75 ? 'bg-green-500' : currentHealth >= 50 ? 'bg-amber-500' : 'bg-red-500'
          }`}>
            {currentHealth}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              {healthTrend === 'improving' && <TrendingUp className="w-4 h-4 text-green-500" />}
              {healthTrend === 'declining' && <TrendingDown className="w-4 h-4 text-red-500" />}
              {healthTrend === 'stable' && <Minus className="w-4 h-4 text-gray-400" />}
              <span className={`text-sm font-medium capitalize ${
                healthTrend === 'improving' ? 'text-green-600 dark:text-green-400' :
                healthTrend === 'declining' ? 'text-red-600 dark:text-red-400' :
                'text-gray-500 dark:text-gray-400'
              }`}>{healthTrend}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">vs. 7 days ago</p>
          </div>
        </div>
        {healthHistory.length >= 2 && (
          <HealthSparkline data={healthHistory.map(h => h.healthScore)} />
        )}
      </div>
    ),

    'evm': cpi === null && spi === null ? (
      <EmptyState icon={<TrendingUp className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No EVM data available" cta="Learn about EVM" />
    ) : (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">CPI</p>
            <p className={`text-2xl font-bold ${cpiSpiColor(cpi)}`}>
              {cpi !== null ? cpi.toFixed(2) : '—'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {cpi !== null ? (cpi >= 1.0 ? 'Under budget' : 'Over budget') : ''}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">SPI</p>
            <p className={`text-2xl font-bold ${cpiSpiColor(spi)}`}>
              {spi !== null ? spi.toFixed(2) : '—'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {spi !== null ? (spi >= 1.0 ? 'Ahead of schedule' : 'Behind schedule') : ''}
            </p>
          </div>
        </div>
        {eac !== null && budgetAllocated > 0 && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500 dark:text-gray-400">Est. at Completion</span>
              <span className={`font-medium ${eac > budgetAllocated ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {formatCurrency(eac, budgetCurrency)}
              </span>
            </div>
          </div>
        )}
      </div>
    ),

    'budget': budgetAllocated === 0 ? (
      <EmptyState icon={<DollarSign className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No budget allocated" cta="Set budget" onAction={() => onNavigateToTab?.('budget')} />
    ) : (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold text-gray-900 dark:text-white">
            {formatCurrency(budgetSpent, budgetCurrency)}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            / {formatCurrency(budgetAllocated, budgetCurrency)}
          </span>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500 dark:text-gray-400">Utilization</span>
            <span className={`font-bold ${isOverBudget ? 'text-red-600' : budgetUtilization > 90 ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300'}`}>
              {budgetUtilization}%
            </span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${isOverBudget ? 'bg-red-500' : budgetUtilization > 90 ? 'bg-amber-500' : 'bg-green-500'}`}
              style={{ width: mounted ? `${Math.min(100, budgetUtilization)}%` : '0%' }}
            />
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Remaining: {formatCurrency(Math.max(0, budgetAllocated - budgetSpent), budgetCurrency)}</span>
          {isOverBudget && (
            <span className="text-red-600 dark:text-red-400 font-medium">
              Over by {formatCurrency(budgetSpent - budgetAllocated, budgetCurrency)}
            </span>
          )}
        </div>
      </div>
    ),

    'due-soon': tasksLoading ? (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className={`h-8 ${skeletonPulse}`} />)}
      </div>
    ) : dueSoonTasks.length === 0 ? (
      <EmptyState icon={<CheckCircle2 className="w-5 h-5 text-green-400 dark:text-green-500" />} message="No tasks due in the next 7 days" />
    ) : (
      <div className="space-y-2 max-h-[200px] overflow-y-auto">
        {dueSoonTasks.map((t: any) => {
          const dueDate = t.endDate || t.end_date || t.dueDate || t.due_date;
          const daysLeft = Math.ceil((new Date(dueDate).getTime() - now.getTime()) / 86400000);
          return (
            <div key={t.id} className="flex items-start gap-2.5">
              <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                daysLeft <= 1 ? 'bg-red-500' : daysLeft <= 3 ? 'bg-amber-500' : 'bg-blue-500'
              }`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 dark:text-white truncate">{t.name}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  {daysLeft === 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : `${daysLeft} days left`}
                  {t.assigneeName && ` · ${t.assigneeName}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    ),

    'raid': !raidStats ? (
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => <div key={i} className={`h-16 rounded-lg ${skeletonPulse}`} />)}
      </div>
    ) : (
      <>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {([
            { value: raidStats.openRisks || 0, label: 'Open Risks', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-600 dark:text-red-400', sub: 'text-red-500 dark:text-red-400' },
            { value: raidStats.openIssues || 0, label: 'Open Issues', bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-600 dark:text-orange-400', sub: 'text-orange-500 dark:text-orange-400' },
            { value: raidStats.openActions || 0, label: 'Open Actions', bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-600 dark:text-blue-400', sub: 'text-blue-500 dark:text-blue-400' },
            { value: raidStats.pendingDecisions || 0, label: 'Pending Decisions', bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-600 dark:text-purple-400', sub: 'text-purple-500 dark:text-purple-400' },
          ] as const).map((item) => (
            <div
              key={item.label}
              className={`rounded-lg ${item.bg} p-2.5 text-center ${item.value > 0 ? 'cursor-pointer hover:ring-1 hover:ring-primary-300 dark:hover:ring-primary-700 transition-all' : ''}`}
              onClick={item.value > 0 ? () => onNavigateToTab?.('raid') : undefined}
              role={item.value > 0 ? 'button' : undefined}
              tabIndex={item.value > 0 ? 0 : undefined}
              onKeyDown={item.value > 0 ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigateToTab?.('raid'); } } : undefined}
            >
              <p className={`text-xl font-bold ${item.text}`}>{item.value}</p>
              <p className={`text-[10px] ${item.sub}`}>{item.label}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {raidStats.critical > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" /> {raidStats.critical} critical
            </span>
          )}
          {raidStats.triggered > 0 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
              {raidStats.triggered} triggered
            </span>
          )}
          {raidTrend && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              raidTrend.net > 0
                ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                : raidTrend.net < 0
                ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                : 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800'
            }`}>
              {raidTrend.net > 0 ? <TrendingUp className="w-3 h-3" /> : raidTrend.net < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
              {raidTrend.opened > 0 && `+${raidTrend.opened}`}
              {raidTrend.opened > 0 && raidTrend.closed > 0 && ' / '}
              {raidTrend.closed > 0 && `-${raidTrend.closed}`}
              {' this week'}
            </span>
          )}
        </div>
      </>
    ),

    'sprint': !activeSprint ? (
      <EmptyState icon={<Kanban className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No active sprint" cta="Manage sprints" onAction={() => onNavigateToTab?.('sprints')} />
    ) : (() => {
      const total = activeSprint.totalTasks || 0;
      const done = activeSprint.completedTasks || 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const sprintStart = new Date(activeSprint.startDate);
      const sprintEnd = new Date(activeSprint.endDate);
      const totalDays = Math.max(1, Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / 86400000));
      const elapsed = Math.max(0, Math.ceil((now.getTime() - sprintStart.getTime()) / 86400000));
      return (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{activeSprint.name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Day {Math.min(elapsed, totalDays)} of {totalDays} &middot; {formatDate(activeSprint.startDate)} - {formatDate(activeSprint.endDate)}
            </p>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500 dark:text-gray-400">Progress</span>
              <span className="font-medium text-gray-900 dark:text-white">{done}/{total} tasks ({pct}%)</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
              <div className="bg-primary-500 h-2 rounded-full transition-all duration-700 ease-out" style={{ width: mounted ? `${pct}%` : '0%' }} />
            </div>
          </div>
          {activeSprint.goal && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Sprint Goal</p>
              <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">{activeSprint.goal}</p>
            </div>
          )}
        </div>
      );
    })(),

    'activity': recentActivity.length === 0 ? (
      <EmptyState icon={<Activity className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No recent activity" />
    ) : (
      <div className="space-y-2.5 max-h-[220px] overflow-y-auto">
        {recentActivity.map((a: any, i: number) => (
          <div key={a.id || i} className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Activity className="w-3 h-3 text-gray-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-800 dark:text-gray-200 truncate">
                {a.action || a.description || a.summary || a.message || 'Activity'}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                {a.userName || a.user || ''}{a.userName || a.user ? ' · ' : ''}
                {new Date(a.createdAt || a.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    ),

    'blocked': (
      <div className="space-y-2">
        {blockedTasks.map((t: any) => {
          const deps: any[] = t.dependencies || [];
          const blockerNames = deps
            .map((d: any) => {
              const dep = allTasks.find((dt: any) => dt.id === d.dependencyId || dt.id === d.dependency_id);
              return dep && dep.status !== 'completed' && dep.status !== 'done' ? dep.name : null;
            })
            .filter(Boolean);
          return (
            <div
              key={t.id}
              className="flex items-start gap-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-1.5 rounded-lg transition-colors"
              onClick={() => onNavigateToTab?.('schedule')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigateToTab?.('schedule'); } }}
            >
              <div className="mt-0.5 flex-shrink-0">
                <Link2 className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 dark:text-white truncate">{t.name}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                  Waiting on: {blockerNames.join(', ')}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    ),

    'comments': (
      <div className="space-y-2.5">
        {recentComments.map((a: any, i: number) => (
          <div key={a.id || i} className="flex items-start gap-2.5">
            <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
              <MessageSquare className="w-3 h-3 text-blue-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-800 dark:text-gray-200 truncate">
                {a.action || a.description || a.summary || a.message || 'Comment'}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                {a.userName || a.user || ''}{a.userName || a.user ? ' · ' : ''}
                {new Date(a.createdAt || a.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>
    ),

    'goals': (
      <div className="space-y-2.5">
        {goals.slice(0, 6).map((g: any) => {
          const progress = g.progressPercentage ?? g.progress ?? 0;
          const status = g.status || 'active';
          const isDone = status === 'completed' || status === 'achieved';
          return (
            <div key={g.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium truncate flex-1 mr-2 ${isDone ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
                  {g.name || g.title}
                </p>
                <span className={`text-xs font-medium ${isDone ? 'text-green-600 dark:text-green-400' : progress >= 75 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-green-500' : progress >= 75 ? 'bg-blue-500' : progress >= 50 ? 'bg-amber-500' : 'bg-gray-400'}`}
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
              {g.targetDate && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500">
                  Target: {new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              )}
            </div>
          );
        })}
        {goals.length > 6 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">+{goals.length - 6} more goals</p>
        )}
      </div>
    ),

    'attachments': (
      <div className="space-y-2">
        {attachments.slice(0, 5).map((a: any) => {
          const name = a.originalName || a.fileName || a.name || 'File';
          const size = a.fileSize || a.size;
          const date = a.createdAt || a.uploadedAt || a.timestamp;
          return (
            <div
              key={a.id}
              className="flex items-center gap-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 py-1.5 rounded-lg transition-colors"
              onClick={() => onNavigateToTab?.('files')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigateToTab?.('files'); } }}
            >
              <Paperclip className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 dark:text-white truncate">{name}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  {size ? `${(size / 1024).toFixed(0)} KB · ` : ''}
                  {date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                </p>
              </div>
            </div>
          );
        })}
        {attachments.length > 5 && (
          <p className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-primary-600" onClick={() => onNavigateToTab?.('files')}>
            +{attachments.length - 5} more files
          </p>
        )}
      </div>
    ),

    'latest-meeting': latestMeeting ? (
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {latestMeeting.title || latestMeeting.meetingTitle || 'Meeting'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {latestMeeting.analyzedAt || latestMeeting.createdAt
              ? new Date(latestMeeting.analyzedAt || latestMeeting.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : ''}
          </p>
        </div>
        {latestMeeting.summary && (
          <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-3">{latestMeeting.summary}</p>
        )}
        {(latestMeeting.actionItems || latestMeeting.actions) && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium mb-1.5">Action Items</p>
            <div className="space-y-1">
              {(latestMeeting.actionItems || latestMeeting.actions || []).slice(0, 3).map((item: any, idx: number) => (
                <div key={idx} className="flex items-start gap-1.5">
                  <div className="mt-1 w-1.5 h-1.5 rounded-full bg-primary-400 flex-shrink-0" />
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">
                    {typeof item === 'string' ? item : item.description || item.action || item.text || ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {(latestMeeting.decisions || []).length > 0 && (
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
            <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wider font-medium mb-1.5">Decisions</p>
            <div className="space-y-1">
              {latestMeeting.decisions.slice(0, 2).map((d: any, idx: number) => (
                <p key={idx} className="text-xs text-gray-700 dark:text-gray-300 truncate">
                  {typeof d === 'string' ? d : d.description || d.decision || d.text || ''}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : (
      <EmptyState icon={<Mic className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No meetings analyzed yet" />
    ),
  };

  const isCustomOrder = JSON.stringify(cardOrder) !== JSON.stringify(DEFAULT_CARD_ORDER);

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      {onNavigateToTab && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onNavigateToTab('schedule')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-400 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Task
          </button>
          <button
            onClick={() => onNavigateToTab('raid')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-400 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Log Risk
          </button>
          <button
            onClick={() => onNavigateToTab('team')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-400 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
          >
            <Users className="w-3.5 h-3.5" /> Manage Team
          </button>
        </div>
      )}

      {/* Kickoff Lessons Banner — planning-stage projects */}
      {project.status === 'planning' && kickoffLessons.length > 0 && !dismissedKickoffLessons && (
        <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/50 dark:bg-primary-900/10 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              <h3 className="text-sm font-semibold text-primary-800 dark:text-primary-300">Lessons from Similar Projects</h3>
            </div>
            <button onClick={() => setDismissedKickoffLessons(true)} className="p-1 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-800/50" aria-label="Dismiss">
              <X className="w-3.5 h-3.5 text-primary-500" />
            </button>
          </div>
          <p className="text-xs text-primary-600 dark:text-primary-400 mb-2">
            These lessons from past projects may help during your planning phase:
          </p>
          <div className="space-y-1.5">
            {kickoffLessons.map((lesson: any) => (
              <div key={lesson.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-primary-100 dark:border-primary-900/30">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{lesson.title}</p>
                  {lesson.recommendation && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{lesson.recommendation}</p>}
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium shrink-0">{lesson.category}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 1: Project Details + Team Members (fixed position) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`lg:col-span-2 space-y-6`}>
          <div className={cardClass}>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Project Details</h3>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {project.priority && (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500 dark:text-gray-400">Priority</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${priorityColors[project.priority] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                    {project.priority}
                  </span>
                </span>
              )}
              {project.category && (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500 dark:text-gray-400">Category</span>
                  <span className="font-medium text-gray-900 dark:text-white capitalize">{project.category}</span>
                </span>
              )}
              {project.type && (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500 dark:text-gray-400">Type</span>
                  <span className="font-medium text-gray-900 dark:text-white capitalize">{project.type}</span>
                </span>
              )}
              {project.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  <span className="font-medium text-gray-900 dark:text-white">{project.location}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <span className="text-gray-500 dark:text-gray-400">PM</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {membersLoading ? <span className={`inline-block h-4 w-20 ${skeletonPulse}`} /> : managerName}
                </span>
              </span>
              {startDate && (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500 dark:text-gray-400">Start</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatDate(startDate)}</span>
                </span>
              )}
              {endDate && (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500 dark:text-gray-400">End</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatDate(endDate)}</span>
                </span>
              )}
              {project.currency && (
                <span className="flex items-center gap-1.5">
                  <span className="text-gray-500 dark:text-gray-400">Currency</span>
                  <span className="font-medium text-gray-900 dark:text-white">{project.currency.toUpperCase()}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Team Members */}
        <div className={cardClass}>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Team Members</span>
          </h3>
          {membersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full ${skeletonPulse}`} />
                  <div className={`h-4 w-28 ${skeletonPulse}`} />
                </div>
              ))}
            </div>
          ) : members.length === 0 ? (
            <EmptyState icon={<Users className="w-5 h-5 text-gray-300 dark:text-gray-500" />} message="No team members assigned" cta="Invite team" onAction={() => onNavigateToTab?.('team')} />
          ) : (
            <div className="space-y-3">
              {visibleMembers.map((m: any, idx: number) => {
                const name = m.user?.name || m.name || m.email || 'Unknown';
                const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
                const colors = [
                  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500',
                ];
                return (
                  <div key={m.id || idx} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium ${colors[idx % colors.length]}`}>
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 capitalize">
                      {m.role || 'member'}
                    </span>
                  </div>
                );
              })}
              {overflowCount > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">+{overflowCount} more</p>
              )}
              {memberWorkload.length > 0 && memberWorkload.some(w => w.count > 0) && (
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wider font-medium">Active Tasks</p>
                  <div className="space-y-1.5">
                    {memberWorkload.map((w) => (
                      <div key={w.name} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 dark:text-gray-400 w-12 truncate">{w.name}</span>
                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-primary-400 dark:bg-primary-500 rounded-full transition-all duration-500"
                            style={{ width: `${w.pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 w-4 text-right">{w.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Reorderable Cards — drag to customize layout */}
      {isCustomOrder && (
        <div className="flex justify-end">
          <button
            onClick={resetCardOrder}
            className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Reset card order
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cardOrder.filter(isCardVisible).map(id => {
          const meta = cardMeta[id];
          // Brief card has its own header — render directly without CollapsibleCard wrapper
          if (id === 'brief') {
            return (
              <div
                key={id}
                className={`col-span-full ${cardClass} transition-all duration-150 ${dragId === id ? 'opacity-40 scale-[0.97] ring-2 ring-primary-300 dark:ring-primary-600' : ''} ${dragId && dragId !== id ? 'hover:ring-2 hover:ring-primary-200 dark:hover:ring-primary-800' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, id)}
                onDragOver={(e) => handleDragOver(e, id)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => e.preventDefault()}
              >
                {cardContent[id]}
              </div>
            );
          }
          return (
            <CollapsibleCard
              key={id}
              id={id}
              icon={meta.icon}
              title={meta.title}
              className={`${cardClass} transition-all duration-150 ${dragId === id ? 'opacity-40 scale-[0.97] ring-2 ring-primary-300 dark:ring-primary-600' : ''} ${dragId && dragId !== id ? 'hover:ring-2 hover:ring-primary-200 dark:hover:ring-primary-800' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, id)}
              onDragOver={(e) => handleDragOver(e, id)}
              onDragEnd={handleDragEnd}
            >
              {cardContent[id]}
            </CollapsibleCard>
          );
        })}
      </div>

      {/* Custom Fields + Portal Links (fixed position) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {project.id && (
          <div className={cardClass}>
            <CustomFieldsSection entityType="project" entityId={project.id} projectId={project.id} />
          </div>
        )}
        {project.id && (
          <div className={cardClass}>
            <PortalLinkManager projectId={project.id} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, color, onClick }: { label: string; value: number; color?: string; onClick?: () => void }) {
  const interactive = onClick && value > 0;
  return (
    <div
      className={`rounded-lg bg-gray-50 dark:bg-gray-900/50 p-3 text-center ${interactive ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900/80 hover:ring-1 hover:ring-primary-300 dark:hover:ring-primary-700 transition-all' : ''}`}
      onClick={interactive ? onClick : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <p className={`text-2xl font-bold ${color || 'text-gray-900 dark:text-white'}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  );
}

function CollapsibleCard({ id, icon, title, className, children, draggable, onDragStart, onDragOver, onDragEnd }: {
  id: string;
  icon: ReactNode;
  title: string;
  className: string;
  children: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const storageKey = `overview-card-${id}`;
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, [storageKey]);
  return (
    <div
      className={className}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between mb-0 group">
        {draggable && (
          <div
            className="mr-1.5 cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Drag to reorder"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <button onClick={toggle} className="flex items-center justify-between flex-1 text-base font-semibold text-gray-900 dark:text-white">
          <span className="flex items-center gap-2">{icon} {title}</span>
          <ChevronDown className={`w-4 h-4 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
        </button>
      </div>
      <div className={`transition-all duration-200 overflow-hidden ${collapsed ? 'max-h-0 opacity-0 mt-0' : 'max-h-[2000px] opacity-100 mt-4'}`}>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ icon, message, cta, onAction }: { icon: ReactNode; message: string; cta?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-col items-center py-5 text-center">
      <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center mb-2.5">
        {icon}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
      {cta && onAction && (
        <button onClick={onAction} className="mt-2 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors">
          {cta} &rarr;
        </button>
      )}
    </div>
  );
}

function cpiSpiColor(val: number | null): string {
  if (val === null) return 'text-gray-400';
  if (val >= 1.0) return 'text-green-600 dark:text-green-400';
  if (val >= 0.85) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}

function HealthSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const width = 200;
  const height = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`
  ).join(' ');
  const lastVal = data[data.length - 1];
  const isDark = document.documentElement.classList.contains('dark');
  const color = lastVal >= 75
    ? (isDark ? '#4ade80' : '#22c55e')
    : lastVal >= 50
    ? (isDark ? '#fbbf24' : '#f59e0b')
    : (isDark ? '#f87171' : '#ef4444');
  return (
    <svg width={width} height={height} className="w-full">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={isDark ? 0.85 : 1} />
    </svg>
  );
}
