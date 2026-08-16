import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  CalendarDays,
  TrendingUp,
  Upload,
  BarChart3,
  Kanban,
  GanttChartSquare,
  Table2,
  Save,
  MapPin,
  Bot,
  Search,
  Filter,
  X,
  Download,
  Trash2,
} from 'lucide-react';
import { apiService } from '../../services/api';
import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TaskFormModal, type TaskFormData } from '../../components/schedule/TaskFormModal';
import { KanbanBoard } from '../../components/schedule/KanbanBoard';
import { TableView } from '../../components/schedule/TableView';
import { CalendarView } from '../../components/schedule/CalendarView';
import { NetworkDiagramView } from '../../components/network/NetworkDiagramView';
import { BurndownPanel } from '../../components/burndown/BurndownPanel';
import { AutoReschedulePanel } from '../../components/schedule/AutoReschedulePanel';
import { ImportModal } from '../../components/schedule/ImportModal';
import { ColumnPickerDropdown } from '../../components/schedule/ColumnPickerDropdown';
import { TaskListMobile } from '../../components/tasks/TaskListMobile';
import { useColumnState } from '../../hooks/useColumnState';
import { useUndoRedo } from '../../hooks/useUndoRedo';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { COLUMN_DEFS } from '../../components/schedule/tableColumns';
import { exportTasksCSV } from '../../utils/exportUtils';
import { getViewPref, setViewPref } from '../../hooks/useViewPreferences';

export function ScheduleTab({ projectId, projectName, projectStartDate, defaultViewMode = 'gantt' }: { projectId: string; projectName?: string; projectStartDate?: string; defaultViewMode?: string }) {
  const queryClient = useQueryClient();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [viewMode, setViewModeRaw] = useState<'gantt' | 'kanban' | 'table' | 'calendar' | 'network' | 'burndown'>(() => {
    const serverPref = getViewPref('scheduleViewMode');
    if (serverPref) return serverPref;
    try {
      const saved = localStorage.getItem('schedule-view-mode');
      if (saved && ['gantt', 'kanban', 'table', 'calendar', 'network', 'burndown'].includes(saved)) return saved as any;
    } catch { /* noop */ }
    return defaultViewMode as any;
  });
  const setViewMode = useCallback((mode: typeof viewMode) => {
    setViewModeRaw(mode);
    try { localStorage.setItem('schedule-view-mode', mode); } catch { /* noop */ }
    setViewPref('scheduleViewMode', mode);
  }, []);
  const [uploadingSchedule, setUploadingSchedule] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const scheduleFileRef = useRef<HTMLInputElement>(null);

  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });

  const schedules: any[] = schedulesData?.schedules || [];

  const handleScheduleFileUpload = useCallback(async (file: File) => {
    setUploadError(null);
    setUploadingSchedule(true);
    try {
      let csvText: string;
      const ext = file.name.toLowerCase().split('.').pop();
      const isExcel = ext === 'xlsx' || ext === 'xls' || ext === 'xlsb' ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel';

      if (isExcel) {
        const XLSX = await import('xlsx');
        const { cleanCsvForImport, sheetToCsv } = await import('../../utils/csvCleaner');
        const buffer = await file.arrayBuffer();
        const data = new Uint8Array(buffer);
        const workbook = XLSX.read(data, { type: 'array' });
        csvText = cleanCsvForImport(sheetToCsv(XLSX, workbook.Sheets[workbook.SheetNames[0]]));
      } else if (ext === 'csv') {
        const { cleanCsvForImport } = await import('../../utils/csvCleaner');
        csvText = cleanCsvForImport(await file.text());
      } else {
        setUploadError('Please upload a .csv, .xlsx, or .xls file.');
        setUploadingSchedule(false);
        return;
      }

      const startDate = projectStartDate || new Date().toISOString().split('T')[0];
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);

      const schedule = await apiService.createSchedule({
        projectId,
        name: `${projectName || 'Project'} Schedule`,
        startDate,
        endDate: endDate.toISOString().split('T')[0],
      });
      const scheduleId = schedule.schedule?.id || schedule.id;
      if (scheduleId) {
        await apiService.importTasks(scheduleId, csvText);
      }
      queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
    } catch {
      setUploadError('Failed to create schedule or import tasks.');
    } finally {
      setUploadingSchedule(false);
      if (scheduleFileRef.current) scheduleFileRef.current.value = '';
    }
  }, [projectId, projectName, projectStartDate, queryClient]);

  if (schedulesLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-72 animate-pulse bg-gray-200 dark:bg-gray-700 rounded-lg" />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-4 animate-pulse bg-gray-200 dark:bg-gray-700 rounded" />
                <div className={`h-4 animate-pulse bg-gray-200 dark:bg-gray-700 rounded`} style={{ width: `${40 + (i * 7) % 30}%` }} />
                <div className="h-4 w-20 animate-pulse bg-gray-100 dark:bg-gray-600 rounded" />
                <div className="h-3 w-32 animate-pulse bg-gray-100 dark:bg-gray-600 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (schedules.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
        <Calendar className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">No Schedules</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          No schedules have been created for this project yet.
        </p>
        <div className="mt-4 flex flex-col items-center gap-3">
          <button
            onClick={async () => {
              try {
                const startDate = projectStartDate || new Date().toISOString().split('T')[0];
                const endDate = new Date(startDate);
                endDate.setFullYear(endDate.getFullYear() + 1);
                await apiService.createSchedule({
                  projectId,
                  name: `${projectName || 'Project'} Schedule`,
                  startDate,
                  endDate: endDate.toISOString().split('T')[0],
                });
                queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
              } catch {
                setUploadError('Failed to create schedule.');
              }
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            <Calendar className="w-4 h-4" />
            Create Schedule
          </button>
          <span className="text-xs text-gray-400 dark:text-gray-500">or</span>
          <button
            onClick={() => scheduleFileRef.current?.click()}
            disabled={uploadingSchedule}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:bg-gray-300 rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {uploadingSchedule ? 'Importing…' : 'Upload Schedule (.xlsx / .csv)'}
          </button>
          {uploadError && (
            <p className="text-xs text-red-600">{uploadError}</p>
          )}
          <input
            ref={scheduleFileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleScheduleFileUpload(file);
            }}
          />
        </div>
      </div>
    );
  }

  if (isMobile) {
    return <MobileScheduleView schedules={schedules} />;
  }

  return (
    <div className="space-y-4">
      {/* View Toggle */}
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5 overflow-x-auto">
          {([
            { mode: 'gantt' as const, icon: GanttChartSquare, label: 'Gantt' },
            { mode: 'kanban' as const, icon: Kanban, label: 'Kanban' },
            { mode: 'table' as const, icon: Table2, label: 'Table' },
            { mode: 'calendar' as const, icon: CalendarDays, label: 'Calendar' },
            { mode: 'network' as const, icon: MapPin, label: 'Network' },
            { mode: 'burndown' as const, icon: TrendingUp, label: 'Burndown' },
          ] as const).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                viewMode === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {schedules.map((schedule: any) => (
        <ScheduleGantt key={schedule.id} schedule={schedule} viewMode={viewMode} projectId={projectId} />
      ))}
    </div>
  );
}

function MobileScheduleView({ schedules }: { schedules: any[] }) {
  const queryClient = useQueryClient();
  const [mobileView, setMobileView] = useState<'list' | 'kanban' | 'calendar'>('list');
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', schedules[0]?.id],
    queryFn: () => apiService.getTasks(schedules[0]?.id),
    enabled: schedules.length > 0,
  });

  const tasks = tasksData?.data || tasksData?.tasks || [];
  const schedule = schedules[0];

  const handleStatusChange = useCallback((taskId: string, newStatus: string) => {
    apiService.updateTask(schedule.id, taskId, { status: newStatus }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
    });
  }, [schedule?.id, queryClient]);

  return (
    <div className="space-y-3">
      {/* Mobile view switcher */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {schedule?.name || 'Tasks'}
        </h3>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5">
          {([
            { mode: 'list' as const, label: 'List' },
            { mode: 'kanban' as const, label: 'Board' },
            { mode: 'calendar' as const, label: 'Cal' },
          ] as const).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setMobileView(mode)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mobileView === mode
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mobileView === 'list' && (
        <TaskListMobile tasks={tasks} onStatusChange={handleStatusChange} />
      )}
      {mobileView === 'kanban' && (
        <KanbanBoard
          tasks={tasks}
          onTaskClick={() => {}}
          onStatusChange={handleStatusChange}
          scheduleId={schedule?.id}
        />
      )}
      {mobileView === 'calendar' && (
        <CalendarView
          tasks={tasks}
          onTaskClick={() => {}}
        />
      )}
    </div>
  );
}

function ScheduleGantt({ schedule, viewMode, projectId }: { schedule: any; viewMode: 'gantt' | 'kanban' | 'table' | 'calendar' | 'network' | 'burndown'; projectId: string }) {
  const queryClient = useQueryClient();
  const [editingTask, setEditingTask] = useState<GanttTask | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [createTaskDates, setCreateTaskDates] = useState<{ startDate: string; endDate: string; parentTaskId?: string; afterTaskId?: string; beforeTaskId?: string } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCriticalPath, setShowCriticalPath] = useState(false);
  const columnState = useColumnState(schedule.id);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('');
  const [showComparison, setShowComparison] = useState(false);
  const [showReschedulePanel, setShowReschedulePanel] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [levelingResult, setLevelingResult] = useState<any[] | null>(null);
  const [levelingBusy, setLevelingBusy] = useState(false);
  const [showScenarioCompare, setShowScenarioCompare] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
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
    enabled: !!taskDateRange && viewMode === 'gantt',
    staleTime: 5 * 60 * 1000,
  });

  const nonWorkingDates = useMemo(() => new Set(nwdData?.dates || []), [nwdData]);

  // What-if scenarios
  const { data: scenariosData } = useQuery({
    queryKey: ['scenarios', schedule.id],
    queryFn: () => apiService.getScenarios(schedule.id),
    enabled: !schedule.isScenario,
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

  const createBaselineMutation = useMutation({
    mutationFn: () => apiService.createBaseline(schedule.id, `Baseline ${new Date().toLocaleDateString()}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['baselines', schedule.id] });
    },
  });

  // Create task mutation
  const createMutation = useMutation({
    mutationFn: (data: TaskFormData & { afterTaskId?: string; beforeTaskId?: string }) => {
      const deps = (data.predecessors || [])
        .filter(p => p.dependencyId)
        .map(p => ({ dependencyId: p.dependencyId, dependencyType: p.dependencyType || 'FS', lagDays: parseInt(p.lagDays) || 0 }));
      const payload: Record<string, unknown> = {
        name: data.name,
        description: data.description || undefined,
        status: data.status,
        priority: data.priority,
        assignedTo: data.assignedTo || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        progressPercentage: data.progressPercentage,
        parentTaskId: data.parentTaskId || undefined,
        estimatedDays: data.estimatedDays ? parseInt(data.estimatedDays) : undefined,
        recurrenceRule: data.recurrenceRule || undefined,
        isRecurrenceTemplate: data.isRecurrenceTemplate || undefined,
        isMilestone: data.isMilestone || undefined,
        budgetAllocated: data.budgetAllocated ? parseFloat(data.budgetAllocated) : undefined,
        actualCost: data.actualCost ? parseFloat(data.actualCost) : undefined,
        constraintType: data.constraintType && data.constraintType !== 'ASAP' ? data.constraintType : undefined,
        constraintDate: data.constraintDate || undefined,
        assignments: data.assignments?.filter(a => a.resourceId).length ? data.assignments.filter(a => a.resourceId) : undefined,
        dependencies: deps.length > 0 ? deps : undefined,
        afterTaskId: data.afterTaskId || undefined,
        beforeTaskId: data.beforeTaskId || undefined,
      };
      return apiService.createTask(schedule.id, payload as Parameters<typeof apiService.createTask>[1]);
    },
    onSuccess: (result: any) => {
      const createdTask = result?.task || result;
      // Auto-expand recurrence if this is a template
      if (createdTask?.isRecurrenceTemplate && createdTask?.id) {
        apiService.expandRecurrence(schedule.id, createdTask.id).then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
        }).catch(() => { /* silent */ });
      }
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      setShowAddForm(false);
      setActiveTaskId(null);
    },
  });

  // Update task mutation
  const updateMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: string; data: TaskFormData | Record<string, unknown> }) => {
      if ('name' in data && 'status' in data && 'priority' in data && 'assignedTo' in data) {
        const d = data as TaskFormData;
        const deps = (d.predecessors || [])
          .filter(p => p.dependencyId)
          .map(p => ({ dependencyId: p.dependencyId, dependencyType: p.dependencyType || 'FS', lagDays: parseInt(p.lagDays) || 0 }));
        const payload: Record<string, unknown> = {
          name: d.name,
          description: d.description || undefined,
          status: d.status,
          priority: d.priority,
          assignedTo: d.assignedTo || undefined,
          startDate: d.startDate || undefined,
          endDate: d.endDate || undefined,
          progressPercentage: d.progressPercentage,
          parentTaskId: d.parentTaskId || undefined,
          estimatedDays: d.estimatedDays ? parseInt(d.estimatedDays) : undefined,
          recurrenceRule: d.recurrenceRule || undefined,
          isRecurrenceTemplate: d.isRecurrenceTemplate || undefined,
          isMilestone: d.isMilestone || undefined,
          budgetAllocated: d.budgetAllocated ? parseFloat(d.budgetAllocated) : undefined,
          actualCost: d.actualCost ? parseFloat(d.actualCost) : undefined,
          constraintType: d.constraintType && d.constraintType !== 'ASAP' ? d.constraintType : undefined,
          constraintDate: d.constraintDate || undefined,
          assignments: d.assignments?.filter(a => a.resourceId).length ? d.assignments.filter(a => a.resourceId) : undefined,
          dependencies: deps,
        };
        return apiService.updateTask(schedule.id, taskId, payload);
      }
      return apiService.updateTask(schedule.id, taskId, data as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      setEditingTask(null);
    },
    onError: (error: any) => {
      const msg = error?.response?.data?.message || error?.message || 'Failed to update task';
      console.error('Task update failed:', msg);
    },
  });

  // Delete task
  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => {
      return apiService.deleteTask(schedule.id, taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      setEditingTask(null);
      setActiveTaskId(null);
    },
  });

  // Undo/redo
  const { canUndo, canRedo, undoDescription, redoDescription, pushAction: rawPushAction, undo: rawUndo, redo } = useUndoRedo();

  // Undo toast
  const [undoToast, setUndoToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const pushAction = useCallback((action: Parameters<typeof rawPushAction>[0]) => {
    rawPushAction(action);
    setUndoToast(action.description);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setUndoToast(null), 4000);
  }, [rawPushAction]);

  const undo = useCallback(() => {
    rawUndo();
    setUndoToast(null);
    clearTimeout(toastTimerRef.current);
  }, [rawUndo]);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // Update task with undo support
  const updateTaskWithUndo = useCallback((taskId: string, data: Record<string, unknown>) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) { updateMutation.mutate({ taskId, data }); return; }
    const oldValues: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      const val = (task as unknown as Record<string, unknown>)[key];
      oldValues[key] = val === undefined ? null : val;
    }
    const fieldNames = Object.keys(data).join(', ');
    pushAction({
      description: `Edit ${task.name} (${fieldNames})`,
      undo: () => updateMutation.mutate({ taskId, data: oldValues }),
      redo: () => updateMutation.mutate({ taskId, data }),
    });
    updateMutation.mutate({ taskId, data });
  }, [tasks, updateMutation, pushAction]);

  // Drag-end with undo (bar drag for dates)
  const handleTaskDragEndWithUndo = useCallback((taskId: string, newStart: string, newEnd: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const oldStart = task.startDate;
    const oldEnd = task.endDate;

    queryClient.setQueryData(['tasks', schedule.id], (old: any) => {
      if (!old) return old;
      const list = old.data || old.tasks || old;
      if (!Array.isArray(list)) return old;
      const updated = list.map((t: any) =>
        t.id === taskId ? { ...t, startDate: newStart, endDate: newEnd } : t
      );
      if (old.data) return { ...old, data: updated };
      if (old.tasks) return { ...old, tasks: updated };
      return updated;
    });

    pushAction({
      description: `Move ${task.name}`,
      undo: () => updateMutation.mutate({ taskId, data: { startDate: oldStart, endDate: oldEnd } }),
      redo: () => updateMutation.mutate({ taskId, data: { startDate: newStart, endDate: newEnd } }),
    });
    updateMutation.mutate({ taskId, data: { startDate: newStart, endDate: newEnd } });
  }, [tasks, updateMutation, pushAction, queryClient, schedule.id]);

  // Row reorder with undo
  const handleTaskReorder = useCallback((updates: Array<{ taskId: string; sortOrder: number }>) => {
    const oldOrders = updates.map(u => {
      const t = tasks.find(tt => tt.id === u.taskId);
      return { taskId: u.taskId, sortOrder: t?.sortOrder ?? 0 };
    });
    pushAction({
      description: `Reorder tasks`,
      undo: async () => {
        await apiService.bulkUpdateTasks(oldOrders.map(o => ({ id: o.taskId, scheduleId: schedule.id, sortOrder: o.sortOrder })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        await apiService.bulkUpdateTasks(updates.map(u => ({ id: u.taskId, scheduleId: schedule.id, sortOrder: u.sortOrder })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    });
    apiService.bulkUpdateTasks(updates.map(u => ({ id: u.taskId, scheduleId: schedule.id, sortOrder: u.sortOrder })))
      .then(() => queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] }));
  }, [tasks, schedule.id, pushAction, queryClient]);

  // Bulk update with undo
  const handleBulkUpdate = useCallback(async (taskIds: string[], field: string, value: string) => {
    const oldValues = taskIds.map(id => {
      const t = tasks.find(tt => tt.id === id);
      const val = t ? (t as unknown as Record<string, unknown>)[field] : undefined;
      return { id, oldValue: val === undefined ? null : val };
    });
    const apiValue = (field === 'parentTaskId' && !value) ? null : value;
    pushAction({
      description: `Bulk update ${field} on ${taskIds.length} tasks`,
      undo: async () => {
        await apiService.bulkUpdateTasks(oldValues.map(o => ({ id: o.id, scheduleId: schedule.id, [field]: o.oldValue })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        await apiService.bulkUpdateTasks(taskIds.map(id => ({ id, scheduleId: schedule.id, [field]: apiValue })));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    });
    await apiService.bulkUpdateTasks(taskIds.map(id => ({ id, scheduleId: schedule.id, [field]: apiValue })));
    queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
  }, [tasks, schedule.id, pushAction, queryClient]);

  // Bulk delete with undo
  const handleBulkDelete = useCallback(async (taskIds: string[]) => {
    // Capture full task data before deleting so undo can recreate them
    const deletedTasks = taskIds
      .map(id => tasks.find(t => t.id === id))
      .filter((t): t is typeof tasks[number] => !!t)
      .map(t => ({
        name: t.name,
        description: t.description || undefined,
        status: t.status,
        priority: t.priority,
        assignedTo: t.assignedTo || undefined,
        startDate: t.startDate || undefined,
        endDate: t.endDate || undefined,
        estimatedDays: t.estimatedDays || undefined,
        progressPercentage: t.progressPercentage || undefined,
        parentTaskId: t.parentTaskId || undefined,
        dependency: t.dependency || undefined,
        isMilestone: t.isMilestone || undefined,
        sortOrder: t.sortOrder,
      }));

    await Promise.all(taskIds.map(id => apiService.deleteTask(schedule.id, id)));
    queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });

    pushAction({
      description: `Delete ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`,
      undo: async () => {
        for (const taskData of deletedTasks) {
          await apiService.createTask(schedule.id, taskData);
        }
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
      redo: async () => {
        // Re-fetch current task IDs by name since IDs change after recreation
        const currentTasks = queryClient.getQueryData<typeof tasks>(['tasks', schedule.id]) || [];
        const idsToDelete = deletedTasks
          .map(dt => currentTasks.find(ct => ct.name === dt.name)?.id)
          .filter((id): id is string => !!id);
        await Promise.all(idsToDelete.map(id => apiService.deleteTask(schedule.id, id)));
        queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
      },
    });
  }, [schedule.id, queryClient, tasks, pushAction]);

  // Duplicate/paste tasks — creates copies with "(copy)" suffix
  const handleDuplicateTasks = useCallback(async (srcTasks: GanttTask[]) => {
    for (const t of srcTasks) {
      await createMutation.mutateAsync({
        name: `${t.name} (copy)`,
        status: t.status || 'pending',
        priority: t.priority || 'medium',
        assignedTo: t.assignedTo || '',
        startDate: t.startDate || '',
        endDate: t.endDate || '',
        progressPercentage: t.progressPercentage || 0,
        description: t.description || '',
        parentTaskId: t.parentTaskId || undefined,
        estimatedDays: t.estimatedDays != null ? String(t.estimatedDays) : undefined,
        isMilestone: t.isMilestone || undefined,
      } as any);
    }
  }, [createMutation]);

  // Kanban status change
  const handleKanbanStatusChange = (taskId: string, newStatus: string) => {
    updateMutation.mutate({ taskId, data: { status: newStatus } });
  };

  // Unique values for filter dropdowns
  const uniqueStatuses = useMemo(() => [...new Set(tasks.map(t => t.status))].sort(), [tasks]);
  const uniquePriorities = useMemo(() => [...new Set(tasks.map(t => t.priority).filter(Boolean))].sort(), [tasks]);
  const uniqueAssignees = useMemo(() => [...new Set(tasks.map(t => t.assignedTo).filter(Boolean))].sort() as string[], [tasks]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
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

  const hasActiveFilters = !!(searchQuery || filterStatus || filterPriority || filterAssignee);
  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setFilterStatus('');
    setFilterPriority('');
    setFilterAssignee('');
  }, []);

  // Task stats for summary bar (use filtered tasks)
  const taskStats = (() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter(t => t.status === 'completed' || t.status === 'done').length;
    const inProgress = filteredTasks.filter(t => t.status === 'in_progress').length;
    const pending = filteredTasks.filter(t => t.status === 'pending' || t.status === 'not_started').length;
    const overdue = filteredTasks.filter(t => {
      if (t.status === 'completed' || t.status === 'done' || t.status === 'cancelled') return false;
      const due = t.endDate;
      return due && new Date(due) < new Date();
    }).length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, pending, overdue, pct };
  })();

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

  return (
    <>
      {/* Controls bar */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <ColumnPickerDropdown
          columns={COLUMN_DEFS}
          visibleKeys={columnState.visibleKeys}
          onToggle={columnState.toggleColumn}
          onToggleGroup={columnState.toggleGroup}
          onMoveColumn={columnState.moveColumn}
          columnOrder={columnState.columnOrder}
          onResetOrder={() => columnState.setColumnOrder([])}
        />

        {viewMode === 'gantt' && (
          <>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showCriticalPath}
              onChange={(e) => setShowCriticalPath(e.target.checked)}
              className="accent-red-600 w-3.5 h-3.5"
            />
            Show Critical Path
          </label>

          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

          <button
            onClick={() => createBaselineMutation.mutate()}
            disabled={createBaselineMutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:hover:bg-primary-900/40 rounded-md transition-colors"
          >
            <Save className="w-3 h-3" />
            Save Baseline
          </button>

          {baselines.length > 0 && (
            <>
              <select
                value={selectedBaselineId}
                onChange={(e) => { setSelectedBaselineId(e.target.value); setShowComparison(false); }}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800"
              >
                <option value="">No baseline overlay</option>
                {baselines.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({new Date(b.createdAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
              {selectedBaselineId && (
                <button
                  onClick={() => setShowComparison(!showComparison)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    showComparison
                      ? 'bg-primary-600 text-white'
                      : 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:hover:bg-primary-900/40'
                  }`}
                >
                  <BarChart3 className="w-3 h-3" />
                  Variance Report
                </button>
              )}
            </>
          )}

          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
          >
            <Upload className="w-3 h-3" />
            Import
          </button>

          <button
            onClick={() => setShowReschedulePanel(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-md transition-colors"
          >
            <Bot className="w-3 h-3" />
            AI Reschedule
          </button>

          <button
            onClick={async () => {
              setLevelingBusy(true);
              try {
                const res = await apiService.levelResources(schedule.id);
                const adjustments = res?.result?.adjustedTasks || res?.adjustedTasks || [];
                if (adjustments.length === 0) {
                  setLevelingResult([]);
                } else {
                  setLevelingResult(adjustments);
                }
              } catch {
                setLevelingResult([]);
              } finally {
                setLevelingBusy(false);
              }
            }}
            disabled={levelingBusy}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-md transition-colors disabled:opacity-50"
          >
            {levelingBusy ? (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75"/></svg>
            ) : (
              <BarChart3 className="w-3 h-3" />
            )}
            Level Resources
          </button>

          <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />

          <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            <span className="text-[10px] font-semibold text-gray-400 uppercase">% Mode:</span>
            <select
              value={schedule.progressMode || 'duration'}
              onChange={async (e) => {
                const mode = e.target.value as 'duration' | 'work';
                await apiService.updateSchedule(schedule.id, { progressMode: mode } as any);
                queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
                queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
              }}
              className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-1.5 py-0.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <option value="duration">Duration</option>
              <option value="work">Work (Hours)</option>
            </select>
          </div>

          {!schedule.isScenario && (
            <>
              <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
              <button
                onClick={async () => {
                  const label = prompt('Scenario name:', `Scenario ${new Date().toLocaleDateString()}`);
                  if (!label) return;
                  await apiService.cloneSchedule(schedule.id, label);
                  queryClient.invalidateQueries({ queryKey: ['scenarios', schedule.id] });
                  queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
                }}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/40 dark:text-indigo-400 rounded-md transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                Create Scenario
              </button>
              {scenarios.length > 0 && (
                <>
                  <select
                    value={selectedScenarioId}
                    onChange={(e) => { setSelectedScenarioId(e.target.value); setShowScenarioCompare(false); }}
                    className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800"
                  >
                    <option value="">Select scenario...</option>
                    {scenarios.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.scenarioLabel || s.name}</option>
                    ))}
                  </select>
                  {selectedScenarioId && (
                    <button
                      onClick={() => setShowScenarioCompare(!showScenarioCompare)}
                      className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        showScenarioCompare
                          ? 'bg-indigo-600 text-white'
                          : 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'
                      }`}
                    >
                      Compare
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {cpmData && showCriticalPath && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
              Project duration: {cpmData.projectDuration} days | Critical tasks: {cpmData.criticalPathTaskIds?.length || 0}
            </span>
          )}
          </>
        )}

        {/* Export */}
        <button
          onClick={() => exportTasksCSV(filteredTasks, schedule.name || 'tasks')}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors ml-auto"
          title="Export tasks to CSV"
        >
          <Download className="w-3 h-3" />
          CSV
        </button>

        {/* Keyboard shortcuts */}
        <div className="relative">
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="w-6 h-6 flex items-center justify-center text-xs font-bold text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-600 rounded transition-colors"
            title="Keyboard shortcuts"
          >
            ?
          </button>
          {showShortcuts && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowShortcuts(false)} />
              <div className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-3">
                <p className="text-xs font-semibold text-gray-900 dark:text-white mb-2">Keyboard Shortcuts</p>
                <div className="space-y-1.5 text-xs">
                  {[
                    ['Ctrl + Z', 'Undo'],
                    ['Ctrl + Y', 'Redo'],
                    ['Delete', 'Delete task'],
                    ['Click', 'Select task'],
                    ['Double-click', 'Edit task'],
                    ['Drag bar', 'Move dates'],
                    ['Drag handle', 'Reorder rows'],
                    ['Shift + Click', 'Multi-select'],
                  ].map(([key, desc]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-gray-500 dark:text-gray-400">{desc}</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono text-[10px]">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Delete Schedule */}
        <button
          onClick={() => {
            if (!confirm(`Delete schedule "${schedule.name}"? All tasks, baselines, and scenarios will be permanently removed.`)) return;
            apiService.deleteSchedule(schedule.id).then(() => {
              queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
            });
          }}
          className="w-6 h-6 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 border border-gray-200 dark:border-gray-600 rounded transition-colors"
          title="Delete schedule"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Search + Filter Bar */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks..."
              className="w-48 pl-7 pr-7 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              hasActiveFilters
                ? 'border-primary-300 dark:border-primary-600 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Filter className="w-3 h-3" />
            Filters
            {hasActiveFilters && (
              <span className="ml-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-primary-600 text-white text-[9px] font-bold">
                {[filterStatus, filterPriority, filterAssignee].filter(Boolean).length}
              </span>
            )}
          </button>

          {/* Inline filters (shown when toggled) */}
          {showFilters && (
            <>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="">All statuses</option>
                {uniqueStatuses.map(s => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="">All priorities</option>
                {uniquePriorities.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                value={filterAssignee}
                onChange={(e) => setFilterAssignee(e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="">All assignees</option>
                {uniqueAssignees.map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </>
          )}

          {/* Clear all */}
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}

          {/* Filter result count */}
          {hasActiveFilters && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-auto">
              {filteredTasks.length} of {tasks.length} tasks
            </span>
          )}
        </div>
      )}

      {/* Schedule Summary Bar */}
      {filteredTasks.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700/50 text-xs mb-1 flex-wrap">
          <span className="text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-200">{taskStats.total}</span> tasks
          </span>
          <span className="w-px h-3 bg-gray-200 dark:bg-gray-600" />
          <span className="text-green-600 dark:text-green-400">
            <span className="font-semibold">{taskStats.completed}</span> done
            <span className="text-gray-400 dark:text-gray-500 ml-0.5">({taskStats.pct}%)</span>
          </span>
          <span className="w-px h-3 bg-gray-200 dark:bg-gray-600" />
          <span className="text-blue-600 dark:text-blue-400">
            <span className="font-semibold">{taskStats.inProgress}</span> in progress
          </span>
          {taskStats.overdue > 0 && (
            <>
              <span className="w-px h-3 bg-gray-200 dark:bg-gray-600" />
              <span className="text-red-600 dark:text-red-400 font-semibold">
                {taskStats.overdue} overdue
              </span>
            </>
          )}
          <span className="ml-auto">
            <div className="w-24 h-1.5 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${taskStats.pct}%` }} />
            </div>
          </span>
        </div>
      )}

      {viewMode === 'gantt' && (
        <GanttChart
          tasks={filteredTasks}
          scheduleName={schedule.name}
          scheduleId={schedule.id}
          onTaskSelect={(task) => setActiveTaskId(task.id)}
          onTaskClick={(task) => setEditingTask(task)}
          activeTaskId={activeTaskId}
          onAddTask={() => setShowAddForm(true)}
          onQuickAdd={(name) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '' } as any);
          }}
          onCreateTaskWithDates={(startDate, endDate, parentTaskId) => {
            setCreateTaskDates({ startDate, endDate, parentTaskId });
            setShowAddForm(true);
          }}
          onDeleteTask={(taskId) => deleteMutation.mutate(taskId)}
          onInsertAfter={(afterTaskId, parentTaskId) => {
            setCreateTaskDates({ startDate: '', endDate: '', parentTaskId, afterTaskId });
            setShowAddForm(true);
          }}
          onInsertBefore={(beforeTaskId, parentTaskId) => {
            setCreateTaskDates({ startDate: '', endDate: '', parentTaskId, beforeTaskId });
            setShowAddForm(true);
          }}
          columnState={columnState}
          onTaskDragEnd={handleTaskDragEndWithUndo}
          onTaskUpdate={updateTaskWithUndo}
          onTaskReorder={handleTaskReorder}
          onBulkUpdate={handleBulkUpdate}
          onBulkDelete={handleBulkDelete}
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
          onDuplicateTasks={handleDuplicateTasks}
        />
      )}
      {viewMode === 'kanban' && (
        <KanbanBoard
          tasks={filteredTasks}
          allTasks={tasks}
          onTaskClick={(task) => { setActiveTaskId(task.id); setEditingTask(task as GanttTask); }}
          onStatusChange={handleKanbanStatusChange}
          onQuickAdd={(name, status) => {
            createMutation.mutate({ name, status, priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '' } as any);
          }}
          activeTaskId={activeTaskId}
        />
      )}
      {viewMode === 'table' && (
        <TableView
          tasks={filteredTasks}
          scheduleId={schedule.id}
          onTaskSelect={(task) => setActiveTaskId(task.id)}
          onTaskClick={(task) => setEditingTask(task)}
          activeTaskId={activeTaskId}
          onTaskUpdate={updateTaskWithUndo}
          onTaskReorder={handleTaskReorder}
          onQuickAdd={(name) => {
            createMutation.mutate({ name, status: 'pending', priority: 'medium', assignedTo: '', startDate: '', endDate: '', progressPercentage: 0, description: '' } as any);
          }}
          columnState={columnState}
          cpmData={cpmData}
          baselineData={comparison}
          scheduleStartDate={schedule.startDate}
          onBulkUpdate={handleBulkUpdate}
          onBulkDelete={handleBulkDelete}
          onDeleteTask={(taskId) => deleteMutation.mutate(taskId)}
          onInsertAfter={(afterTaskId, parentTaskId) => {
            setCreateTaskDates({ startDate: '', endDate: '', parentTaskId, afterTaskId });
            setShowAddForm(true);
          }}
          onInsertBefore={(beforeTaskId, parentTaskId) => {
            setCreateTaskDates({ startDate: '', endDate: '', parentTaskId, beforeTaskId });
            setShowAddForm(true);
          }}
          canUndo={canUndo}
          canRedo={canRedo}
          undoDescription={undoDescription}
          redoDescription={redoDescription}
          onUndo={undo}
          onRedo={redo}
          onDuplicateTasks={handleDuplicateTasks}
        />
      )}
      {viewMode === 'calendar' && (
        <CalendarView
          tasks={filteredTasks}
          onTaskClick={(task) => { setActiveTaskId(task.id); setEditingTask(task); }}
          onTaskReschedule={(taskId, newStart, newEnd) => {
            updateTaskWithUndo(taskId, { startDate: newStart, endDate: newEnd });
          }}
        />
      )}
      {viewMode === 'network' && (
        <NetworkDiagramView scheduleId={schedule.id} />
      )}
      {viewMode === 'burndown' && (
        <BurndownPanel scheduleId={schedule.id} />
      )}

      {/* Baseline Variance Report */}
      {showComparison && comparison && (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary-500" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                Baseline Variance Report — {comparison.baselineName}
              </h3>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                Saved {new Date(comparison.baselineDate).toLocaleDateString()}
              </span>
            </div>
            <button
              onClick={() => setShowComparison(false)}
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300 text-xs"
            >
              Close
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 mb-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Health</div>
              <div className={`mt-1 text-lg font-bold ${
                comparison.summary.scheduleHealthPct >= 70 ? 'text-green-600' :
                comparison.summary.scheduleHealthPct >= 40 ? 'text-yellow-600' : 'text-red-600'
              }`}>
                {comparison.summary.scheduleHealthPct}%
              </div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Slipped</div>
              <div className="mt-1 text-lg font-bold text-red-600">{comparison.summary.tasksSlipped}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">On Track</div>
              <div className="mt-1 text-lg font-bold text-green-600">{comparison.summary.tasksOnTrack}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Ahead</div>
              <div className="mt-1 text-lg font-bold text-blue-600">{comparison.summary.tasksAhead}</div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">Avg End Var</div>
              <div className={`mt-1 text-lg font-bold ${
                comparison.summary.avgEndVarianceDays > 0 ? 'text-red-600' : 'text-green-600'
              }`}>
                {comparison.summary.avgEndVarianceDays > 0 ? '+' : ''}{comparison.summary.avgEndVarianceDays}d
              </div>
            </div>
            <div className="rounded-lg border border-gray-100 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase">New Tasks</div>
              <div className="mt-1 text-lg font-bold text-gray-900 dark:text-white">{comparison.summary.newTasks}</div>
            </div>
          </div>

          {/* Task Variance Table */}
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Task</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Start Var</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">End Var</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Duration Var</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Progress Var</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                </tr>
              </thead>
              <tbody>
                {comparison.taskVariances.map((tv: any) => (
                  <tr key={tv.taskId} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-2 py-1.5 text-gray-800 dark:text-gray-100 font-medium">{tv.taskName}</td>
                    <td className={`text-center px-2 py-1.5 font-medium ${
                      tv.startVarianceDays > 0 ? 'text-red-600' : tv.startVarianceDays < 0 ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {tv.startVarianceDays > 0 ? '+' : ''}{tv.startVarianceDays}d
                    </td>
                    <td className={`text-center px-2 py-1.5 font-medium ${
                      tv.endVarianceDays > 0 ? 'text-red-600' : tv.endVarianceDays < 0 ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {tv.endVarianceDays > 0 ? '+' : ''}{tv.endVarianceDays}d
                    </td>
                    <td className={`text-center px-2 py-1.5 font-medium ${
                      tv.durationVarianceDays > 0 ? 'text-red-600' : tv.durationVarianceDays < 0 ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {tv.durationVarianceDays > 0 ? '+' : ''}{tv.durationVarianceDays}d
                    </td>
                    <td className={`text-center px-2 py-1.5 font-medium ${
                      tv.progressVariancePct > 0 ? 'text-green-600' : tv.progressVariancePct < 0 ? 'text-red-600' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {tv.progressVariancePct > 0 ? '+' : ''}{tv.progressVariancePct}%
                    </td>
                    <td className="text-center px-2 py-1.5">
                      {tv.statusChanged ? (
                        <span className="text-amber-600">{tv.baselineStatus} → {tv.actualStatus}</span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">{tv.actualStatus}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scenario Comparison */}
      {showScenarioCompare && scenarioCompareData && (
        <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Scenario Comparison</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!confirm('Promote this scenario? This will update the base schedule with scenario dates and delete the scenario.')) return;
                  await apiService.promoteScenario(schedule.id, selectedScenarioId);
                  setShowScenarioCompare(false);
                  setSelectedScenarioId('');
                  queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
                  queryClient.invalidateQueries({ queryKey: ['scenarios', schedule.id] });
                  queryClient.invalidateQueries({ queryKey: ['schedules', projectId] });
                }}
                className="px-2.5 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
              >
                Promote to Base
              </button>
              <button onClick={() => setShowScenarioCompare(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs">Close</button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 uppercase">Modified</div>
              <div className="mt-1 text-lg font-bold text-yellow-600">{scenarioCompareData.summary.totalModified}</div>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 uppercase">Added</div>
              <div className="mt-1 text-lg font-bold text-green-600">{scenarioCompareData.summary.totalAdded}</div>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 uppercase">Removed</div>
              <div className="mt-1 text-lg font-bold text-red-600">{scenarioCompareData.summary.totalRemoved}</div>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-center">
              <div className="text-xs font-medium text-gray-400 uppercase">Duration Δ</div>
              <div className={`mt-1 text-lg font-bold ${scenarioCompareData.summary.netDurationChange > 0 ? 'text-red-600' : scenarioCompareData.summary.netDurationChange < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                {scenarioCompareData.summary.netDurationChange > 0 ? '+' : ''}{scenarioCompareData.summary.netDurationChange}d
              </div>
            </div>
          </div>

          {/* Diff table */}
          {scenarioCompareData.diffs.length > 0 && (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-semibold text-gray-500 uppercase">Task</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Base Start</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Scenario Start</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Start Δ</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Duration Δ</th>
                    <th className="text-center px-2 py-1.5 font-semibold text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioCompareData.diffs.map((d: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-2 py-1.5 text-gray-800 dark:text-gray-100 font-medium">{d.taskName}</td>
                      <td className="text-center px-2 py-1.5 text-gray-500">{d.baseStart?.slice(0, 10) || '—'}</td>
                      <td className="text-center px-2 py-1.5 text-gray-500">{d.scenarioStart?.slice(0, 10) || '—'}</td>
                      <td className={`text-center px-2 py-1.5 font-medium ${(d.startDelta ?? 0) > 0 ? 'text-red-600' : (d.startDelta ?? 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {d.startDelta != null ? `${d.startDelta > 0 ? '+' : ''}${d.startDelta}d` : '—'}
                      </td>
                      <td className={`text-center px-2 py-1.5 font-medium ${(d.durationDelta ?? 0) > 0 ? 'text-red-600' : (d.durationDelta ?? 0) < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {d.durationDelta != null ? `${d.durationDelta > 0 ? '+' : ''}${d.durationDelta}d` : '—'}
                      </td>
                      <td className="text-center px-2 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          d.status === 'modified' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                          d.status === 'added' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                          'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }`}>
                          {d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {scenarioCompareData.diffs.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No differences — scenario matches the base schedule.</p>
          )}
        </div>
      )}

      {/* Edit modal */}
      {editingTask && (
        <TaskFormModal
          task={editingTask}
          allTasks={tasks}
          scheduleId={schedule.id}
          projectId={projectId}
          onSave={(data) => updateMutation.mutate({ taskId: editingTask.id, data })}
          onDelete={(taskId) => deleteMutation.mutate(taskId)}
          onClose={() => setEditingTask(null)}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* Add modal */}
      {showAddForm && (
        <TaskFormModal
          task={null}
          allTasks={tasks}
          scheduleId={schedule.id}
          projectId={projectId}
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

      {/* Import CSV Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        scheduleId={schedule.id}
        onImported={() => queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] })}
      />

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">Resource Leveling</h3>
              <button onClick={() => setLevelingResult(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {levelingResult.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No resource conflicts detected — schedule is already balanced.</p>
              ) : (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">{levelingResult.length} task(s) need date adjustments to resolve resource over-allocations:</p>
                  <div className="space-y-2">
                    {levelingResult.map((adj: any) => (
                      <div key={adj.taskId} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 text-xs">
                        <p className="font-medium text-gray-900 dark:text-white">{adj.taskName}</p>
                        <div className="flex items-center gap-2 mt-1 text-gray-500 dark:text-gray-400">
                          <span>{adj.originalStart?.slice(0, 10)}</span>
                          <span>→</span>
                          <span className="text-orange-600 dark:text-orange-400 font-medium">{adj.newStart?.slice(0, 10)}</span>
                        </div>
                        {adj.reason && <p className="mt-1 text-gray-400 dark:text-gray-500 italic">{adj.reason}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {levelingResult.length > 0 && (
              <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setLevelingResult(null)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      await apiService.applyResourceLeveling(schedule.id, levelingResult);
                      queryClient.invalidateQueries({ queryKey: ['tasks', schedule.id] });
                    } catch { /* ignore */ }
                    setLevelingResult(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md"
                >
                  Apply All
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Undo toast */}
      {undoToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 dark:bg-gray-700 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-200">
          <span>{undoToast}</span>
          <button
            onClick={undo}
            className="font-semibold text-primary-300 hover:text-primary-200 transition-colors"
          >
            Undo
          </button>
          <span className="text-gray-400 text-xs">Ctrl+Z</span>
          <button
            onClick={() => { setUndoToast(null); clearTimeout(toastTimerRef.current); }}
            className="text-gray-400 hover:text-gray-200 ml-1"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
