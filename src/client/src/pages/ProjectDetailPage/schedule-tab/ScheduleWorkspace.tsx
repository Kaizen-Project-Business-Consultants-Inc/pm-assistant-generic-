/**
 * The Schedule workspace for one schedule: its tasks, filters and quick filters, the Gantt /
 * Kanban / Table / Calendar / Network / Burndown / S-curve views, task form, panels (Review,
 * Calendar, History, AI Reschedule), modals and toasts. The task changes themselves live in
 * useScheduleMutations. Moved out of ScheduleTab.tsx unchanged, keeping its name ScheduleGantt
 * (the product manual refers to it by that name) — code health item 4, phase 4 batch B (2026-10-05).
 */
import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  History,
  AlertTriangle,
} from 'lucide-react';
import { apiService } from '../../../services/api';
import { GanttChart, type GanttTask } from '../../../components/schedule/GanttChart';
import { TaskFormModal } from '../../../components/schedule/TaskFormModal';
import { KanbanBoard } from '../../../components/schedule/KanbanBoard';
import { TableView } from '../../../components/schedule/TableView';
import { CalendarView } from '../../../components/schedule/CalendarView';
import { NetworkDiagramView } from '../../../components/network/NetworkDiagramView';
import { BurndownPanel } from '../../../components/burndown/BurndownPanel';
import { SCurveView } from '../../../components/evm/SCurveView';
import { AutoReschedulePanel } from '../../../components/schedule/AutoReschedulePanel';
// The import window brings the spreadsheet library (~440 KB): loaded the first time it's opened,
// not with every Schedule tab (2026-10-04 audit)
const ImportModal = lazy(() => import('../../../components/schedule/ImportModal').then(m => ({ default: m.ImportModal })));
import { ScheduleReviewPanel, type ScheduleReview } from '../../../components/schedule/review/ScheduleReviewPanel';
import { WorkingCalendarPanel } from '../../../components/schedule/calendar/WorkingCalendarPanel';
import { ScheduleHistoryPanel } from '../../../components/schedule/ScheduleHistoryPanel';
import { useProjectRole } from '../../../hooks/useProjectRole';
import { useColumnState } from '../../../hooks/useColumnState';
import { exportTasksCSV } from '../../../utils/exportUtils';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { ScheduleToolbar } from './ScheduleToolbar';
import { ScheduleOverflowMenu } from './ScheduleOverflowMenu';
import { ScheduleFilterBar } from './ScheduleFilterBar';
import { ScheduleSummaryBar } from './ScheduleSummaryBar';
import { BaselineVarianceReport } from './BaselineVarianceReport';
import { ScenarioComparison } from './ScenarioComparison';
import { ResourceLevelingModal } from './ResourceLevelingModal';
import { QuickFilterPills, type QuickFilterType } from './QuickFilterPills';
import { useScheduleMutations } from './useScheduleMutations';
import { buildTaskRiskMap, DEFAULT_RISK_THRESHOLDS, type RiskThresholds } from '../../../utils/taskRiskAssessment';
import { useAuthStore } from '../../../stores/authStore';
import { useCanOpenPage } from '../../../hooks/useCanOpenPage';
import { ROUTES } from '../../../routes';
import { announce } from '../../../utils/announce';
import { isCalendarOverdue, toCalendarDate } from '../../../utils/dateUtils';
import type { WorkCalendar } from '../../../utils/workingDays';

export function ScheduleGantt({ schedule, viewMode, projectId, openImportOnLoad, onImportOpened }: { schedule: any; viewMode: 'gantt' | 'kanban' | 'table' | 'calendar' | 'network' | 'burndown' | 'scurve'; projectId: string; openImportOnLoad?: boolean; onImportOpened?: () => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  // The Workload Heatmap is on the Resources page — linked only for roles that may open it (constants/roleRoutes.ts)
  const canOpenResources = useCanOpenPage()(ROUTES.resources);
  const [editingTask, setEditingTask] = useState<GanttTask | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [createTaskDates, setCreateTaskDates] = useState<{ startDate: string; endDate: string; parentTaskId?: string; afterTaskId?: string; beforeTaskId?: string } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importEverOpened, setImportEverOpened] = useState(false);
  useEffect(() => { if (showImportModal) setImportEverOpened(true); }, [showImportModal]);
  useEffect(() => {
    if (openImportOnLoad) {
      setShowImportModal(true);
      onImportOpened?.();
    }
  }, [openImportOnLoad, onImportOpened]);
  // Listen for Mjuzi task creation events to highlight + scroll to new tasks
  useEffect(() => {
    const handler = (e: Event) => {
      const taskId = (e as CustomEvent).detail?.taskId;
      if (taskId) {
        setActiveTaskId(taskId);
        // Scroll to the task row after React re-renders with new data
        setTimeout(() => {
          const row = document.querySelector(`[data-task-id="${taskId}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Flash highlight
            row.classList.add('ring-2', 'ring-yellow-400', 'dark:ring-yellow-500');
            setTimeout(() => row.classList.remove('ring-2', 'ring-yellow-400', 'dark:ring-yellow-500'), 3000);
          }
        }, 300);
      }
    };
    window.addEventListener('mjuzi:task-created', handler);

    // Clear activeTaskId if Mjuzi deletes the selected task
    const deleteHandler = (e: Event) => {
      const deletedId = (e as CustomEvent).detail?.taskId;
      if (deletedId) {
        setActiveTaskId((current) => current === deletedId ? null : current);
      }
    };
    window.addEventListener('mjuzi:task-deleted', deleteHandler);

    return () => {
      window.removeEventListener('mjuzi:task-created', handler);
      window.removeEventListener('mjuzi:task-deleted', deleteHandler);
    };
  }, []);

  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const columnState = useColumnState(schedule.id);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('');
  const [showComparison, setShowComparison] = useState(false);
  const [showReschedulePanel, setShowReschedulePanel] = useState(false);
  // Schedule Review panel + "Show rows" filter from a finding
  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [showCalendarPanel, setShowCalendarPanel] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [reviewRowFilter, setReviewRowFilter] = useState<{ taskIds: Set<string>; label: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Only the project's Manager/Owner (or admin/PMO) edits the schedule — by PROJECT role
  const { user } = useAuthStore();
  const { canEdit } = useProjectRole(projectId);
  const VALID_QF = ['all', 'due', 'late', 'at_risk', 'my_tasks', 'unassigned'];
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const qf = urlParams.get('qf');
      if (qf && VALID_QF.includes(qf)) return qf as QuickFilterType;
      const saved = localStorage.getItem(`schedule-quick-filter-${schedule.id}`);
      if (saved && VALID_QF.includes(saved)) return saved as QuickFilterType;
    } catch { /* noop */ }
    return 'all';
  });
  const [dueWeeks, setDueWeeks] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('schedule-due-weeks');
      if (saved) { const n = Number(saved); if (n >= 1 && n <= 4) return n; }
    } catch { /* noop */ }
    return 2;
  });
  const handleDueWeeksChange = useCallback((weeks: number) => {
    setDueWeeks(weeks);
    try { localStorage.setItem('schedule-due-weeks', String(weeks)); } catch { /* noop */ }
  }, []);
  const [riskThresholds, setRiskThresholds] = useState<RiskThresholds>(() => {
    try {
      const saved = localStorage.getItem('schedule-risk-thresholds');
      if (saved) { const parsed = JSON.parse(saved); if (parsed.atRiskGapPct && parsed.criticalGapPct) return parsed; }
    } catch { /* noop */ }
    return { ...DEFAULT_RISK_THRESHOLDS };
  });

  const handleQuickFilterChange = useCallback((f: QuickFilterType) => {
    setQuickFilter(f);
    try { localStorage.setItem(`schedule-quick-filter-${schedule.id}`, f); } catch { /* noop */ }
    const url = new URL(window.location.href);
    if (f === 'all') url.searchParams.delete('qf');
    else url.searchParams.set('qf', f);
    window.history.replaceState({}, '', url.toString());
  }, [schedule.id]);

  const handleThresholdsChange = useCallback((t: RiskThresholds) => {
    setRiskThresholds(t);
    try { localStorage.setItem('schedule-risk-thresholds', JSON.stringify(t)); } catch { /* noop */ }
  }, []);

  const [levelingResult, setLevelingResult] = useState<any[] | null>(null);
  const [levelingBusy, setLevelingBusy] = useState(false);
  const [showScenarioCompare, setShowScenarioCompare] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPromoteConfirm, setShowPromoteConfirm] = useState(false);
  const [showScenarioPrompt, setShowScenarioPrompt] = useState(false);
  const [scenarioName, setScenarioName] = useState(`Scenario ${new Date().toLocaleDateString()}`);
  const cpmNeeded = columnState.cpmNeeded;

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', schedule.id],
    queryFn: () => apiService.getTasks(schedule.id),
  });

  const tasks: GanttTask[] = tasksData?.data || tasksData?.tasks || [];

  // Non-working dates for Gantt shading
  const taskDateRange = useMemo(() => {
    if (tasks.length === 0) return null;
    let min = Infinity, max = -Infinity;
    for (const t of tasks) {
      if (t.startDate) { const d = new Date(t.startDate).getTime(); if (d < min) min = d; }
      if (t.endDate) { const d = new Date(t.endDate).getTime(); if (d > max) max = d; }
    }
    if (min === Infinity) return null;
    const start = new Date(min - 14 * 86400000).toISOString().slice(0, 10);
    const end = new Date(max + 30 * 86400000).toISOString().slice(0, 10);
    return { start, end };
  }, [tasks]);

  const { data: nwdData } = useQuery({
    queryKey: ['nonWorkingDates', projectId, taskDateRange?.start, taskDateRange?.end],
    queryFn: () => apiService.getNonWorkingDates(projectId, taskDateRange!.start, taskDateRange!.end),
    enabled: !!taskDateRange && (viewMode === 'gantt' || viewMode === 'table' || viewMode === 'calendar'),
    staleTime: 5 * 60 * 1000,
  });

  const nonWorkingDates = useMemo(() => new Set(nwdData?.dates || []), [nwdData]);
  // The project calendar for the Duration column (working days). Until it loads, weekends are off.
  const workCalendar = useMemo<WorkCalendar | null>(
    () => (nwdData && taskDateRange ? { nonWorking: nonWorkingDates, from: taskDateRange.start, to: taskDateRange.end } : null),
    [nwdData, nonWorkingDates, taskDateRange],
  );

  // What-if scenarios
  const { data: scenariosData } = useQuery({
    queryKey: ['scenarios', schedule.id],
    queryFn: () => apiService.getScenarios(schedule.id),
    enabled: !schedule.isScenario && viewMode === 'gantt',
  });
  const scenarios: any[] = scenariosData?.scenarios || [];

  const { data: scenarioCompareData } = useQuery({
    queryKey: ['scenarioCompare', schedule.id, selectedScenarioId],
    queryFn: () => apiService.compareSchedules(schedule.id, selectedScenarioId),
    enabled: !!selectedScenarioId && showScenarioCompare,
  });

  // Critical Path
  const { data: cpmData } = useQuery({
    queryKey: ['criticalPath', schedule.id],
    queryFn: () => apiService.getCriticalPath(schedule.id),
    enabled: showCriticalPath || cpmNeeded,
  });

  // Baselines
  const { data: baselinesData } = useQuery({
    queryKey: ['baselines', schedule.id],
    queryFn: () => apiService.getBaselines(schedule.id),
    enabled: showComparison || viewMode === 'gantt',
  });

  const baselines = baselinesData?.baselines || [];
  const selectedBaseline = baselines.find((b: any) => b.id === selectedBaselineId);

  // Baseline comparison
  const { data: comparisonData } = useQuery({
    queryKey: ['baselineComparison', schedule.id, selectedBaselineId],
    queryFn: () => apiService.compareBaseline(schedule.id, selectedBaselineId),
    enabled: !!selectedBaselineId && showComparison,
  });

  const comparison = comparisonData?.comparison;

  const {
    createBaselineMutation, createMutation, updateMutation,
    canUndo, canRedo, undoDescription, redoDescription, undo, redo,
    undoToast, setUndoToast, toastTimerRef,
    saveError, setSaveError,
    deleteMutation,
    loadWarning, setLoadWarning, loadTimerRef,
    updateTaskWithUndo, handleTaskDragEndWithUndo, handleTaskReorder, handleBulkUpdate,
    rowNumbers, handleBulkLink, handleGroupTasks, handleBulkDelete, handleDuplicateTasks,
    handleKanbanStatusChange,
  } = useScheduleMutations({ schedule, tasks, queryClient, setShowAddForm, setActiveTaskId, setEditingTask });

  // Unique values for filter dropdowns
  const uniqueStatuses = useMemo(() => [...new Set(tasks.map(t => t.status))].sort(), [tasks]);
  const uniquePriorities = useMemo(() => [...new Set(tasks.map(t => t.priority).filter((p): p is string => !!p))].sort(), [tasks]);
  const uniqueAssignees = useMemo(() => [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort() as string[], [tasks]);

  // Risk map (computed once for all tasks)
  const taskRiskMap = useMemo(() => buildTaskRiskMap(tasks, riskThresholds), [tasks, riskThresholds]);

  // Filtered tasks — dropdown filters first, then quick filter
  const dropdownFilteredTasks = useMemo(() => {
    let result = tasks;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.assignedTo?.toLowerCase().includes(q));
    }
    if (filterStatus) result = result.filter(t => t.status === filterStatus);
    if (filterPriority) result = result.filter(t => t.priority === filterPriority);
    if (filterAssignee) result = result.filter(t => t.assignedTo === filterAssignee);
    return result;
  }, [tasks, searchQuery, filterStatus, filterPriority, filterAssignee]);

  // Quick filter counts (computed from dropdown-filtered tasks)
  // Tasks are assigned to a resource, which may be linked to a login. "My tasks" used to compare the
  // assignee with the login id only, so it never found tasks assigned through your resource.
  const { data: resourcesData } = useQuery({ queryKey: ['resources'], queryFn: () => apiService.getResources(), staleTime: 300_000 });
  const myResourceIds = useMemo(
    () => new Set<string>(((resourcesData?.resources ?? []) as Array<{ id: string; userId?: string | null }>)
      .filter(r => r.userId && r.userId === user?.id).map(r => r.id)),
    [resourcesData, user?.id],
  );

  const quickFilterCounts = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const dueEnd = new Date(now);
    dueEnd.setDate(dueEnd.getDate() + dueWeeks * 7);
    const userId = user?.id;
    const isMine = (assignedTo?: string | null) => !!assignedTo && (assignedTo === userId || myResourceIds.has(assignedTo));

    const counts: Record<QuickFilterType, number> = { all: dropdownFilteredTasks.length, due: 0, late: 0, at_risk: 0, my_tasks: 0, unassigned: 0 };
    for (const t of dropdownFilteredTasks) {
      const risk = taskRiskMap.get(t.id);
      const status = t.status?.toLowerCase();
      const isFinished = status === 'completed' || status === 'done' || status === 'cancelled';
      if (t.endDate && !isFinished) {
        // the stored calendar day at LOCAL midnight (new Date('YYYY-MM-DD') is the day before west of UTC)
        const end = toCalendarDate(t.endDate);
        if (end && end >= now && end <= dueEnd) counts.due++;
      }
      if (risk === 'late') counts.late++;
      if (risk === 'at_risk' || risk === 'critical') counts.at_risk++;
      if (isMine(t.assignedTo)) counts.my_tasks++;
      if (!t.assignedTo) counts.unassigned++;
    }
    return counts;
  }, [dropdownFilteredTasks, taskRiskMap, user?.id, dueWeeks, myResourceIds]);

  const filteredTasks = useMemo(() => {
    const base = reviewRowFilter ? dropdownFilteredTasks.filter(t => reviewRowFilter.taskIds.has(t.id)) : dropdownFilteredTasks;
    if (quickFilter === 'all') return base;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const userId = user?.id;
    return base.filter(t => {
      const risk = taskRiskMap.get(t.id);
      const status = t.status?.toLowerCase();
      const isFinished = status === 'completed' || status === 'done' || status === 'cancelled';
      switch (quickFilter) {
        case 'due': {
          if (!t.endDate || isFinished) return false;
          const end = toCalendarDate(t.endDate);
          const dueEnd = new Date(now); dueEnd.setDate(dueEnd.getDate() + dueWeeks * 7);
          return !!end && end >= now && end <= dueEnd;
        }
        case 'late': return risk === 'late';
        case 'at_risk': return risk === 'at_risk' || risk === 'critical';
        case 'my_tasks': return !!t.assignedTo && (t.assignedTo === userId || myResourceIds.has(t.assignedTo));
        case 'unassigned': return !t.assignedTo;
        default: return true;
      }
    });
  }, [dropdownFilteredTasks, quickFilter, taskRiskMap, user?.id, dueWeeks, reviewRowFilter, myResourceIds]);

  const hasActiveFilters = !!(searchQuery || filterStatus || filterPriority || filterAssignee || quickFilter !== 'all' || reviewRowFilter);

  // Latest Schedule Review → row indicators for Critical/High findings
  const { data: latestReview } = useQuery<ScheduleReview | null>({
    queryKey: ['schedule-review', schedule.id, 'latest'],
    queryFn: () => apiService.getScheduleReviewLatest(schedule.id),
    staleTime: 60_000,
  });
  const reviewFlagMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of latestReview?.findings ?? []) {
      if (f.severity !== 'critical' && f.severity !== 'high') continue;
      for (const id of f.taskIds) if (!m.has(id)) m.set(id, f.rule);
    }
    return m;
  }, [latestReview]);
  const handleShowReviewRows = useCallback((taskIds: string[] | null, label: string | null) => {
    setReviewRowFilter(taskIds && taskIds.length > 0 && label ? { taskIds: new Set(taskIds), label } : null);
  }, []);

  // Announce filter result count to screen readers
  const prevFilteredRef = useRef(filteredTasks.length);
  useEffect(() => {
    if (hasActiveFilters && filteredTasks.length !== prevFilteredRef.current) {
      announce(`${filteredTasks.length} of ${tasks.length} tasks shown`);
    }
    prevFilteredRef.current = filteredTasks.length;
  }, [filteredTasks.length, tasks.length, hasActiveFilters]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setFilterStatus('');
    setFilterPriority('');
    setFilterAssignee('');
    handleQuickFilterChange('all');
  }, [handleQuickFilterChange]);

  // Task stats for summary bar (use filtered tasks)
  const taskStats = (() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter(t => t.status === 'completed' || t.status === 'done').length;
    const inProgress = filteredTasks.filter(t => t.status === 'in_progress').length;
    const pending = filteredTasks.filter(t => t.status === 'pending' || t.status === 'not_started').length;
    const overdue = filteredTasks.filter(t => {
      if (t.status === 'completed' || t.status === 'done' || t.status === 'cancelled') return false;
      const due = t.endDate;
      // Calendar-day comparison: a task due today is not overdue. `new Date(due)` is
      // midnight UTC, so the old test marked today's work late from the previous evening.
      return !!due && isCalendarOverdue(due);
    }).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, pending, overdue, pct };
  })();

  // ---- Task link: /project/:id?tab=schedule&schedule=S&task=T (Morning Briefing) ----
  const [focusParams, setFocusParams] = useSearchParams();
  const linkedTask = focusParams.get('task');
  const linkedSchedule = focusParams.get('schedule');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!linkedTask || tasksLoading) return;
    if (linkedSchedule && linkedSchedule !== schedule.id) return; // the right schedule is on its way
    const clearParams = () => setFocusParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('task');
      next.delete('schedule');
      return next;
    }, { replace: true });
    if (!tasks.some(t => t.id === linkedTask)) {
      setFocusNotice('That task is no longer in this schedule. It may have been deleted or moved.');
      clearParams();
      return;
    }
    if (!filteredTasks.some(t => t.id === linkedTask)) {
      setSearchQuery(''); setFilterStatus(''); setFilterPriority(''); setFilterAssignee('');
      setReviewRowFilter(null); setQuickFilter('all');
      setFocusNotice('Filters were cleared so you can see this task.');
    }
    setFocusTaskId(linkedTask);
    clearParams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedTask, linkedSchedule, tasksLoading, schedule.id]);
  // Rows a Propose-fixes suggestion changes: highlighted while it's the chosen suggestion, and the
  // first one scrolled into view (filters that hide them are cleared, with a note).
  const [highlightTaskIds, setHighlightTaskIds] = useState<Set<string>>(new Set());
  const handleHighlightTasks = useCallback((ids: string[] | null) => {
    const list = (ids ?? []).filter(id => tasks.some(t => t.id === id));
    setHighlightTaskIds(new Set(list));
    if (list.length === 0) { setFocusTaskId(null); return; }
    if (list.some(id => !filteredTasks.some(t => t.id === id))) {
      setSearchQuery(''); setFilterStatus(''); setFilterPriority(''); setFilterAssignee('');
      setReviewRowFilter(null); setQuickFilter('all');
      setFocusNotice('Filters were cleared so you can see these rows.');
    }
    setFocusTaskId(null);
    setTimeout(() => setFocusTaskId(list[0]), 0); // re-scroll even if it's the same row as before
  }, [tasks, filteredTasks]);
  const rowNumberOf = useCallback((id: string) => rowNumbers.get(id), [rowNumbers]);

  // The highlight and the note fade after a few seconds; the row stays where it is.
  useEffect(() => {
    if (!focusTaskId) return;
    const t = setTimeout(() => setFocusTaskId(null), 8000);
    return () => clearTimeout(t);
  }, [focusTaskId]);
  useEffect(() => {
    if (!focusNotice) return;
    const t = setTimeout(() => setFocusNotice(null), 8000);
    return () => clearTimeout(t);
  }, [focusNotice]);

  if (tasksLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-4 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-4 w-20 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-4 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
                <div className="h-4 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${40 + (i * 7) % 30}%` }} />
                <div className="h-4 w-20 animate-pulse bg-gray-100 dark:bg-gray-600 rounded" />
                <div className="h-3 w-32 animate-pulse bg-gray-100 dark:bg-gray-600 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // One "More actions" menu (baselines, scenarios, import/export, AI Reschedule, Level
  // Resources) shared by the Gantt and Table toolbars — the Table used to get none.
  const scheduleMoreMenu = canEdit ? (
      <ScheduleOverflowMenu
        schedule={schedule}
        projectId={projectId}
        baselines={baselines}
        selectedBaselineId={selectedBaselineId}
        setSelectedBaselineId={setSelectedBaselineId}
        showComparison={showComparison}
        setShowComparison={setShowComparison}
        createBaselineMutation={createBaselineMutation}
        scenarios={scenarios}
        selectedScenarioId={selectedScenarioId}
        setSelectedScenarioId={setSelectedScenarioId}
        showScenarioCompare={showScenarioCompare}
        setShowScenarioCompare={setShowScenarioCompare}
        setShowImportModal={setShowImportModal}
        setShowReschedulePanel={setShowReschedulePanel}
        levelingBusy={levelingBusy}
        onLevelResources={async () => {
          setLevelingBusy(true);
          try {
            const res = await apiService.levelResources(schedule.id);
            const adjustments = res?.result?.adjustedTasks || res?.adjustedTasks || [];
            setLevelingResult(adjustments.length === 0 ? [] : adjustments);
          } catch {
            setLevelingResult([]);
          } finally {
            setLevelingBusy(false);
          }
        }}
        exportCSV={() => exportTasksCSV(filteredTasks, schedule.name || 'tasks')}
        queryClient={queryClient}
        onDeleteSchedule={() => setShowDeleteConfirm(true)}
        onCreateScenario={() => {
          setScenarioName(`Scenario ${new Date().toLocaleDateString()}`);
          setShowScenarioPrompt(true);
        }}
      />
  ) : undefined;
  // AI Reschedule gets its own labelled button next to the menu, in the AI colour — it was
  // only inside the unlabelled ⋮ menu and the user couldn't find it.
  // History sits next to them for everyone: every group change of the last 30 days, with
  // Undo (editors) — including changes Claude made through the connector.
  const historyButton = (
    <button
      type="button"
      onClick={() => setShowHistoryPanel(true)}
      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-primary-600 text-primary-700 bg-white hover:bg-primary-50 dark:bg-gray-800 dark:border-primary-400 dark:text-primary-300 dark:hover:bg-primary-900/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 whitespace-nowrap"
      title="See and undo changes made to many tasks at once"
    >
      <History className="w-3.5 h-3.5" aria-hidden="true" />
      History
    </button>
  );
  const scheduleOverflowMenu = canEdit ? (
    <>
      {historyButton}
      <button
        type="button"
        onClick={() => setShowReschedulePanel(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-ai-primary text-white hover:bg-ai-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-ai-border focus-visible:ring-offset-1 whitespace-nowrap"
        title="Let AI suggest new dates for late or at-risk tasks"
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        AI Reschedule
      </button>
      {scheduleMoreMenu}
    </>
  ) : historyButton;

  return (
    <>
      {/* Row 1: Toolbar + Quick filter pills (merged) */}
      <div className="flex items-center gap-2 flex-wrap mb-1">
        {viewMode !== 'gantt' && (
        <ScheduleToolbar
          viewMode={viewMode}
          tasksCount={tasks.length}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onToggleFilters={() => setShowFilters(!showFilters)}
          hasActiveFilters={hasActiveFilters}
          activeFilterCount={[filterStatus, filterPriority, filterAssignee].filter(Boolean).length}
          columnState={columnState}
          onOpenReview={() => setShowReviewPanel(true)}
          reviewActive={showReviewPanel || !!reviewRowFilter}
          onOpenCalendar={() => setShowCalendarPanel(true)}
          calendarActive={showCalendarPanel}
          showCriticalPath={showCriticalPath}
          onCriticalPathChange={setShowCriticalPath}
          overflowMenu={scheduleOverflowMenu}
          onExportCSV={() => exportTasksCSV(filteredTasks, schedule.name || 'tasks')}
          filteredCount={filteredTasks.length}
          totalCount={tasks.length}
        />
        )}
        {tasks.length > 0 && (
          <QuickFilterPills
            activeFilter={quickFilter}
            onFilterChange={handleQuickFilterChange}
            dueWeeks={dueWeeks}
            onDueWeeksChange={handleDueWeeksChange}
            counts={quickFilterCounts}
            thresholds={riskThresholds}
            onThresholdsChange={handleThresholdsChange}
          />
        )}
        {/* Task counts share this row with the chips (2026-10-01: one row less above the Gantt) */}
        {tasks.length > 0 && filteredTasks.length > 0 && (
          <div className="ml-auto"><ScheduleSummaryBar stats={taskStats} /></div>
        )}
      </div>

      {/* Row 2: the filter bar, when open */}
      {tasks.length > 0 && showFilters && (
        <div className="flex items-center gap-3 flex-wrap mb-1">
          {showFilters && (
            <ScheduleFilterBar
              filterStatus={filterStatus}
              filterPriority={filterPriority}
              filterAssignee={filterAssignee}
              onFilterStatusChange={setFilterStatus}
              onFilterPriorityChange={setFilterPriority}
              onFilterAssigneeChange={setFilterAssignee}
              uniqueStatuses={uniqueStatuses}
              uniquePriorities={uniquePriorities}
              uniqueAssignees={uniqueAssignees}
              hasActiveFilters={hasActiveFilters}
              onClearAll={clearAllFilters}
            />
          )}
        </div>
      )}

      {reviewRowFilter && (
        <div className="flex items-center gap-3 px-3 py-1.5 mb-2 bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-800 rounded-lg text-xs" role="status">
          <span className="font-medium text-orange-800 dark:text-orange-300">Schedule Review: {reviewRowFilter.label}</span>
          <span className="text-orange-700 dark:text-orange-300">{filteredTasks.length} flagged row{filteredTasks.length === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => setReviewRowFilter(null)} className="ml-auto text-orange-800 dark:text-orange-300 hover:underline font-medium">Clear</button>
        </div>
      )}

      {showCriticalPath && cpmData && (
        <div className="flex items-center gap-4 px-3 py-1.5 mb-2 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg text-xs">
          <span className="font-medium text-red-700 dark:text-red-400">Critical Path</span>
          <span className="text-red-600 dark:text-red-300">{cpmData.projectDuration} days</span>
          <span className="text-red-600 dark:text-red-300">{cpmData.criticalPathTaskIds?.length || 0} critical tasks</span>
        </div>
      )}

      {focusNotice && (
        <div role="status" className="mb-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          {focusNotice}
        </div>
      )}
      {viewMode === 'gantt' && (
        <GanttChart
          tasks={filteredTasks}
          allTasks={tasks}
          onBulkLink={canEdit ? handleBulkLink : undefined}
          onGroupTasks={canEdit ? handleGroupTasks : undefined}
          scheduleName={schedule.name}
          scheduleId={schedule.id}
          focusTaskId={focusTaskId}
          highlightTaskIds={highlightTaskIds}
          workCalendar={workCalendar}
          onTaskSelect={(task) => setActiveTaskId(task.id)}
          onTaskClick={(task) => setEditingTask(task)}
          activeTaskId={activeTaskId}
          onAddTask={canEdit ? () => setShowAddForm(true) : undefined}
          onQuickAdd={canEdit ? (name) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '' } as any);
          } : undefined}
          onCreateTaskWithDates={canEdit ? (startDate, endDate, parentTaskId) => {
            setCreateTaskDates({ startDate, endDate, parentTaskId });
            setShowAddForm(true);
          } : undefined}
          onDeleteTask={canEdit ? (taskId) => deleteMutation.mutate(taskId) : undefined}
          onInlineInsert={canEdit ? (name, afterTaskId, parentTaskId) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '', afterTaskId, parentTaskId: parentTaskId || undefined } as any);
          } : undefined}
          onInlineInsertBefore={canEdit ? (name, beforeTaskId, parentTaskId) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '', beforeTaskId, parentTaskId: parentTaskId || undefined } as any);
          } : undefined}
          onInsertBefore={canEdit ? (beforeTaskId, parentTaskId) => {
            setCreateTaskDates({ startDate: '', endDate: '', parentTaskId, beforeTaskId });
            setShowAddForm(true);
          } : undefined}
          onInsertAfter={canEdit ? (afterTaskId, parentTaskId) => {
            setCreateTaskDates({ startDate: '', endDate: '', parentTaskId, afterTaskId });
            setShowAddForm(true);
          } : undefined}
          columnState={columnState}
          onTaskDragEnd={canEdit ? handleTaskDragEndWithUndo : undefined}
          onTaskUpdate={canEdit ? updateTaskWithUndo : undefined}
          onTaskReorder={canEdit ? handleTaskReorder : undefined}
          onBulkUpdate={canEdit ? handleBulkUpdate : undefined}
          onBulkDelete={canEdit ? handleBulkDelete : undefined}
          canUndo={canUndo}
          canRedo={canRedo}
          undoDescription={undoDescription}
          redoDescription={redoDescription}
          onUndo={undo}
          onRedo={redo}
          criticalPathTaskIds={showCriticalPath ? cpmData?.criticalPathTaskIds : undefined}
          taskFloatMap={showCriticalPath && cpmData?.tasks ? Object.fromEntries(cpmData.tasks.map((t: any) => [t.taskId, t.totalFloat])) : undefined}
          baselineTasks={selectedBaseline?.tasks?.map((bt: any) => ({
            taskId: bt.taskId,
            startDate: bt.startDate,
            endDate: bt.endDate,
          }))}
          nonWorkingDates={nonWorkingDates}
          onDuplicateTasks={canEdit ? handleDuplicateTasks : undefined}
          taskRiskMap={taskRiskMap}
          showCriticalPath={showCriticalPath}
          onCriticalPathChange={setShowCriticalPath}
          onOpenReview={() => setShowReviewPanel(true)}
          reviewActive={showReviewPanel || !!reviewRowFilter}
          onOpenCalendar={() => setShowCalendarPanel(true)}
          calendarActive={showCalendarPanel}
          reviewFlagMap={reviewFlagMap}
          scheduleOverflowMenu={scheduleOverflowMenu}
        />
      )}
      {viewMode === 'kanban' && (
        <KanbanBoard
          tasks={filteredTasks}
          allTasks={tasks}
          taskRiskMap={taskRiskMap}
          onTaskClick={(task) => { setActiveTaskId(task.id); setEditingTask(task as GanttTask); }}
          onStatusChange={canEdit ? handleKanbanStatusChange : undefined}
          onQuickAdd={canEdit ? (name, status) => {
            createMutation.mutate({ name, status, priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '' } as any);
          } : undefined}
          activeTaskId={activeTaskId}
        />
      )}
      {viewMode === 'table' && (
        <TableView
          tasks={filteredTasks}
          allTasks={tasks}
          onBulkLink={canEdit ? handleBulkLink : undefined}
          onGroupTasks={canEdit ? handleGroupTasks : undefined}
          scheduleId={schedule.id}
          reviewFlagMap={reviewFlagMap}
          focusTaskId={focusTaskId}
          highlightTaskIds={highlightTaskIds}
          workCalendar={workCalendar}
          onTaskSelect={(task) => setActiveTaskId(task.id)}
          onTaskClick={(task) => setEditingTask(task)}
          activeTaskId={activeTaskId}
          onTaskUpdate={canEdit ? updateTaskWithUndo : undefined}
          onTaskReorder={canEdit ? handleTaskReorder : undefined}
          onQuickAdd={canEdit ? (name) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '' } as any);
          } : undefined}
          columnState={columnState}
          cpmData={cpmData}
          baselineData={comparison}
          scheduleStartDate={schedule.startDate}
          onBulkUpdate={canEdit ? handleBulkUpdate : undefined}
          onBulkDelete={canEdit ? handleBulkDelete : undefined}
          onDeleteTask={canEdit ? (taskId) => deleteMutation.mutate(taskId) : undefined}
          onInlineInsert={canEdit ? (name, afterTaskId, parentTaskId) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '', afterTaskId, parentTaskId: parentTaskId || undefined } as any);
          } : undefined}
          onInsertBefore={canEdit ? (beforeTaskId, parentTaskId) => {
            createMutation.mutate({ name: 'New Task', status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '', beforeTaskId, parentTaskId: parentTaskId || undefined } as any);
          } : undefined}
          canUndo={canEdit ? canUndo : false}
          canRedo={canEdit ? canRedo : false}
          undoDescription={undoDescription}
          redoDescription={redoDescription}
          onUndo={canEdit ? undo : undefined}
          onRedo={canEdit ? redo : undefined}
          onDuplicateTasks={canEdit ? handleDuplicateTasks : undefined}
          taskRiskMap={taskRiskMap}
        />
      )}
      {viewMode === 'calendar' && (
        <CalendarView
          tasks={filteredTasks}
          onTaskClick={(task) => { setActiveTaskId(task.id); setEditingTask(task); }}
          onTaskReschedule={canEdit ? (taskId, newStart, newEnd) => {
            updateTaskWithUndo(taskId, { startDate: newStart, endDate: newEnd });
          } : undefined}
          workCalendar={workCalendar}
        />
      )}
      {viewMode === 'network' && (
        <NetworkDiagramView scheduleId={schedule.id} />
      )}
      {viewMode === 'burndown' && (
        <BurndownPanel scheduleId={schedule.id} />
      )}
      {viewMode === 'scurve' && (
        <SCurveView projectId={projectId} />
      )}

      {/* Baseline Variance Report */}
      {showComparison && comparison && (
        <BaselineVarianceReport
          comparison={comparison}
          onClose={() => setShowComparison(false)}
        />
      )}

      {/* Scenario Comparison */}
      {showScenarioCompare && scenarioCompareData && (
        <ScenarioComparison
          data={scenarioCompareData}
          onClose={() => setShowScenarioCompare(false)}
          onPromote={() => setShowPromoteConfirm(true)}
        />
      )}

      {/* Edit modal */}
      {editingTask && (
        <TaskFormModal
          task={editingTask}
          allTasks={tasks}
          scheduleId={schedule.id}
          projectId={projectId}
          workCalendar={workCalendar}
          onSave={canEdit ? (data) => updateMutation.mutate({ taskId: editingTask.id, data }) : undefined}
          onDelete={canEdit ? (taskId) => deleteMutation.mutate(taskId) : undefined}
          onClose={() => setEditingTask(null)}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* Add modal — editors only */}
      {showAddForm && canEdit && (
        <TaskFormModal
          task={null}
          allTasks={tasks}
          scheduleId={schedule.id}
          projectId={projectId}
          workCalendar={workCalendar}
          activeTaskId={createTaskDates?.parentTaskId || activeTaskId}
          initialStartDate={createTaskDates?.startDate}
          initialEndDate={createTaskDates?.endDate}
          onSave={(data) => {
            let afterTaskId: string | undefined = createTaskDates?.afterTaskId;
            let beforeTaskId: string | undefined = createTaskDates?.beforeTaskId;
            if (!afterTaskId && !beforeTaskId) {
              const activeTask = activeTaskId ? tasks.find(t => t.id === activeTaskId) : null;
              if (activeTask) {
                const hasChildren = tasks.some(t => t.parentTaskId === activeTask.id);
                if (!hasChildren) {
                  afterTaskId = activeTask.id;
                }
              }
            }
            createMutation.mutate({ ...data, afterTaskId, beforeTaskId } as any);
          }}
          onClose={() => { setShowAddForm(false); setCreateTaskDates(null); }}
          isSaving={createMutation.isPending}
        />
      )}

      {/* Import CSV Modal — mounted once first opened, then kept (it remembers an import in progress) */}
      {importEverOpened && (
      <Suspense fallback={null}>
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        scheduleId={schedule.id}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
          queryClient.invalidateQueries({ queryKey: ['schedule-review', schedule.id] });
          queryClient.invalidateQueries({ queryKey: ['schedule-changes', schedule.id] });
        }}
        onOpenReview={() => { setShowImportModal(false); setShowReviewPanel(true); }}
      />
      </Suspense>
      )}

      {/* Schedule Review panel */}
      {showHistoryPanel && (
        <ScheduleHistoryPanel
          scheduleId={schedule.id}
          canEdit={canEdit}
          currentUserId={user?.id}
          onClose={() => setShowHistoryPanel(false)}
        />
      )}
      {showCalendarPanel && (
        <WorkingCalendarPanel
          projectId={projectId}
          canEdit={canEdit}
          onClose={() => setShowCalendarPanel(false)}
          onApplied={() => {
            // Every plan in the project may have moved; only the open one refetches now
            queryClient.invalidateQueries({ queryKey: ['tasks'] });
            queryClient.invalidateQueries({ queryKey: ['nonWorkingDates', projectId] });
            queryClient.invalidateQueries({ queryKey: ['schedule-changes', schedule.id] });
          }}
        />
      )}
      {showReviewPanel && (
        <ScheduleReviewPanel
          scheduleId={schedule.id}
          canEdit={canEdit}
          onClose={() => { setShowReviewPanel(false); handleHighlightTasks(null); }}
          onShowRows={handleShowReviewRows}
          activeRowFilterLabel={reviewRowFilter?.label ?? null}
          onHighlightTasks={handleHighlightTasks}
          rowNumberOf={rowNumberOf}
        />
      )}

      {/* AI Reschedule Panel */}
      {showReschedulePanel && (
        <AutoReschedulePanel
          scheduleId={schedule.id}
          onClose={() => {
            setShowReschedulePanel(false);
            queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
          }}
        />
      )}

      {/* Resource Leveling Results Modal */}
      {levelingResult !== null && (
        <ResourceLevelingModal
          result={levelingResult}
          onClose={() => setLevelingResult(null)}
          onApply={async () => {
            try {
              await apiService.applyResourceLeveling(schedule.id, levelingResult);
              queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
            } catch { /* ignore */ }
            setLevelingResult(null);
          }}
        />
      )}

      {/* Undo toast */}
      {undoToast && (
        <div role="alert" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 dark:bg-gray-700 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-200">
          <span>{undoToast}</span>
          <button
            onClick={undo}
            className="font-semibold text-primary-300 hover:text-primary-200 transition-colors"
          >
            Undo
          </button>
          <span className="text-gray-500 text-xs">Ctrl+Z</span>
          <button
            onClick={() => { setUndoToast(null); clearTimeout(toastTimerRef.current); }}
            className="text-gray-500 hover:text-gray-200 ml-1"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* A save that failed: what did not save and what to do (screen readers hear it via announce) */}
      {saveError && (
        <div data-testid="schedule-save-error" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-start gap-2 max-w-xl bg-red-50 dark:bg-red-900/80 border border-red-300 dark:border-red-700 text-red-900 dark:text-red-100 text-sm px-4 py-2.5 rounded-lg shadow-lg">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-white ml-1"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {loadWarning && (
        <div role="status" aria-live="polite" className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-start gap-2 max-w-xl bg-amber-50 dark:bg-amber-900/80 border border-amber-300 dark:border-amber-600 text-amber-900 dark:text-amber-100 text-sm px-4 py-2.5 rounded-lg shadow-lg">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {loadWarning}{' '}
            {canOpenResources && <a href="/resources?tab=workload" className="underline font-medium">See Workload Heatmap</a>}
          </span>
          <button
            onClick={() => { setLoadWarning(null); clearTimeout(loadTimerRef.current); }}
            className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-white ml-1"
            aria-label="Dismiss warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* Delete Schedule Confirm */}
      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Schedule"
          message={`Delete "${schedule.name}"? All tasks, baselines, and scenarios will be permanently removed.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            apiService.deleteSchedule(schedule.id).then(() => {
              queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
            });
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Promote Scenario Confirm */}
      {showPromoteConfirm && (
        <ConfirmModal
          title="Promote Scenario"
          message="This will update the base schedule with scenario dates and delete the scenario."
          confirmLabel="Promote"
          variant="warning"
          onConfirm={async () => {
            setShowPromoteConfirm(false);
            await apiService.promoteScenario(schedule.id, selectedScenarioId);
            setShowScenarioCompare(false);
            setSelectedScenarioId('');
            queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
            queryClient.invalidateQueries({ queryKey: ['scenarios', schedule.id] });
            queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
          }}
          onCancel={() => setShowPromoteConfirm(false)}
        />
      )}

      {/* Create Scenario Prompt */}
      {showScenarioPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowScenarioPrompt(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm mx-4 w-full">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Create Scenario</h3>
            <p id={`${uid}-enter-a-name-label`} className="text-sm text-gray-600 dark:text-gray-400 mb-3">Enter a name for the scenario.</p>
            <input
              aria-labelledby={`${uid}-enter-a-name-label`}
              type="text"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && scenarioName.trim()) {
                  setShowScenarioPrompt(false);
                  apiService.cloneSchedule(schedule.id, scenarioName.trim()).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['scenarios', schedule.id] });
                    queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
                  });
                }
              }}
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowScenarioPrompt(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!scenarioName.trim()) return;
                  setShowScenarioPrompt(false);
                  apiService.cloneSchedule(schedule.id, scenarioName.trim()).then(() => {
                    queryClient.invalidateQueries({ queryKey: ['scenarios', schedule.id] });
                    queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
                  });
                }}
                disabled={!scenarioName.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
