import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, BarChart3, Plus, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { apiService } from '../services/api';
import { TimesheetGrid } from '../components/timetracking/TimesheetGrid';
import { ActualVsEstimatedChart } from '../components/timetracking/ActualVsEstimatedChart';
import { useBreakpoint } from '../hooks/useBreakpoint';

type Tab = 'my-timesheet' | 'project-summary';

export function TimesheetPage() {
  const queryClient = useQueryClient();
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const [tab, setTab] = useState<Tab>('my-timesheet');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [showLogForm, setShowLogForm] = useState(false);
  const [logProjectId, setLogProjectId] = useState('');
  const [logScheduleId, setLogScheduleId] = useState('');
  const [logTaskId, setLogTaskId] = useState('');
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logHours, setLogHours] = useState('');
  const [logDescription, setLogDescription] = useState('');

  const { data: projectsData, isError: projectsError } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
  });
  const projects: any[] = projectsData?.data || projectsData?.projects || [];

  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', selectedProjectId],
    queryFn: () => apiService.getSchedules(selectedProjectId),
    enabled: !!selectedProjectId,
  });
  const schedules: any[] = schedulesData?.schedules || [];

  const { data: comparisonData } = useQuery({
    queryKey: ['actual-vs-estimated', selectedScheduleId],
    queryFn: () => apiService.getActualVsEstimated(selectedScheduleId),
    enabled: !!selectedScheduleId,
  });

  // Log-time queries
  const { data: logSchedulesData } = useQuery({
    queryKey: ['schedules', logProjectId],
    queryFn: () => apiService.getSchedules(logProjectId),
    enabled: !!logProjectId,
  });
  const logSchedules: any[] = logSchedulesData?.schedules || [];

  const { data: logTasksData } = useQuery({
    queryKey: ['tasks', logScheduleId],
    queryFn: () => apiService.getTasks(logScheduleId),
    enabled: !!logScheduleId,
  });
  const logTasks: any[] = logTasksData?.data || logTasksData?.tasks || [];

  const logTimeMutation = useMutation({
    mutationFn: () => apiService.createTimeEntry({
      taskId: logTaskId,
      scheduleId: logScheduleId,
      projectId: logProjectId,
      date: logDate,
      hours: parseFloat(logHours),
      description: logDescription || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheet'] });
      setShowLogForm(false);
      setLogTaskId('');
      setLogHours('');
      setLogDescription('');
    },
  });

  if (projectsError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-red-600">Failed to load projects. Please try refreshing.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Timesheets</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Track time and compare against estimates</p>
        </div>
        <button
          onClick={() => setShowLogForm(v => !v)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Log Time
        </button>
      </div>

      {/* Log Time Form */}
      {showLogForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-primary-200 dark:border-primary-700 p-5 space-y-4 shadow-sm dark:shadow-gray-900/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Log Time Entry</h3>
            <button onClick={() => setShowLogForm(false)} className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-300" aria-label="Close time log form"><X className="w-4 h-4" /></button>
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-4'} gap-3`}>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Project</label>
              <select
                value={logProjectId}
                onChange={(e) => { setLogProjectId(e.target.value); setLogScheduleId(''); setLogTaskId(''); }}
                className="input w-full text-sm"
              >
                <option value="">Select project...</option>
                {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Schedule</label>
              <select
                value={logScheduleId}
                onChange={(e) => { setLogScheduleId(e.target.value); setLogTaskId(''); }}
                className="input w-full text-sm"
                disabled={!logProjectId}
              >
                <option value="">Select schedule...</option>
                {logSchedules.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Task</label>
              <select
                value={logTaskId}
                onChange={(e) => setLogTaskId(e.target.value)}
                className="input w-full text-sm"
                disabled={!logScheduleId}
              >
                <option value="">Select task...</option>
                {logTasks.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Date</label>
              <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="input w-full text-sm" />
            </div>
          </div>
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-3'} gap-3`}>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Hours</label>
              <input type="number" step="0.25" min="0.25" max="24" value={logHours} onChange={(e) => setLogHours(e.target.value)} className="input w-full text-sm" placeholder="e.g. 2.5" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Description (optional)</label>
              <input type="text" value={logDescription} onChange={(e) => setLogDescription(e.target.value)} className="input w-full text-sm" placeholder="What did you work on?" />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => logTimeMutation.mutate()}
              disabled={!logTaskId || !logDate || !logHours || parseFloat(logHours) <= 0 || logTimeMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {logTimeMutation.isPending ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
          {logTimeMutation.isError && (
            <p className="text-xs text-red-600">Failed to save time entry. Please try again.</p>
          )}
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('my-timesheet')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors
            ${tab === 'my-timesheet' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm dark:shadow-gray-900/30' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white'}`}
        >
          <Clock className="w-4 h-4" /> My Timesheet
        </button>
        <button
          onClick={() => setTab('project-summary')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors
            ${tab === 'project-summary' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm dark:shadow-gray-900/30' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white'}`}
        >
          <BarChart3 className="w-4 h-4" /> Project Summary
        </button>
      </div>

      {tab === 'my-timesheet' && (
        <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 ${isMobile ? 'p-3' : 'p-6'}`}>
          {isMobile ? <MobileTimesheetView /> : <TimesheetGrid />}
        </div>
      )}

      {tab === 'project-summary' && (
        <div className="space-y-4">
          <div className={`flex ${isMobile ? 'flex-col' : 'items-center'} gap-4`}>
            <select
              value={selectedProjectId}
              onChange={(e) => { setSelectedProjectId(e.target.value); setSelectedScheduleId(''); }}
              className="input text-sm"
            >
              <option value="">Select a project...</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {selectedProjectId && (
              <select
                value={selectedScheduleId}
                onChange={(e) => setSelectedScheduleId(e.target.value)}
                className="input text-sm"
              >
                <option value="">Select a schedule...</option>
                {schedules.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </div>

          {selectedScheduleId && comparisonData?.tasks && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">Actual vs Estimated Hours</h3>
              <ActualVsEstimatedChart tasks={comparisonData.tasks} />
            </div>
          )}

          {!selectedScheduleId && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center text-gray-400 dark:text-gray-500">
              Select a project and schedule to view time comparison
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MobileTimesheetView() {
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d.toISOString().slice(0, 10);
  });

  const { data, isLoading } = useQuery({
    queryKey: ['timesheet', weekStart],
    queryFn: () => apiService.getWeeklyTimesheet(weekStart),
  });

  const entries: any[] = data?.entries || [];
  const days: string[] = data?.days || [];

  const navigateWeek = (offset: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + offset * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  // Group entries by day
  const dayMap = new Map<string, { date: string; entries: any[]; total: number }>();
  for (const day of days) {
    dayMap.set(day, { date: day, entries: [], total: 0 });
  }
  for (const e of entries) {
    const d = e.date?.substring(0, 10);
    if (dayMap.has(d)) {
      dayMap.get(d)!.entries.push(e);
      dayMap.get(d)!.total += Number(e.hours) || 0;
    }
  }

  const dayList = Array.from(dayMap.values());

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-3">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigateWeek(-1)} className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200" aria-label="Previous week">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Week of {new Date(weekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <button onClick={() => navigateWeek(1)} className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200" aria-label="Next week">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && dayList.map((day) => (
        <div key={day.date} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{formatDay(day.date)}</span>
            <span className={`text-sm font-semibold ${day.total > 0 ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`}>
              {day.total.toFixed(1)}h
            </span>
          </div>
          {day.entries.length > 0 ? (
            <div className="space-y-1">
              {day.entries.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span className="truncate flex-1">{e.taskName || e.task_name || 'Task'}</span>
                  <span className="ml-2 font-medium">{Number(e.hours).toFixed(1)}h</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">No entries</p>
          )}
        </div>
      ))}
    </div>
  );
}
