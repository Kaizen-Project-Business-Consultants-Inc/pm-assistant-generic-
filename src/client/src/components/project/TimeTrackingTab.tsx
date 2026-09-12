import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2, BarChart3, X, Users, User, TrendingDown, TrendingUp, Grid3X3, Sparkles, CalendarDays } from 'lucide-react';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { ActualVsEstimatedChart } from '../timetracking/ActualVsEstimatedChart';
import { TimeBurndownChart } from '../timetracking/TimeBurndownChart';
import { TimeTrendChart } from '../timetracking/TimeTrendChart';
import { UtilizationHeatmap } from '../timetracking/UtilizationHeatmap';
import { ProjectTimesheetGrid } from '../timetracking/ProjectTimesheetGrid';
import { TimeAnomalyPanel } from './TimeAnomalyPanel';
import { WeeklyReviewPanel } from './WeeklyReviewPanel';

interface TimeEntry {
  id: string;
  taskId: string;
  taskName?: string;
  scheduleName?: string;
  date: string;
  hours: number;
  description?: string;
  billable: boolean;
  userName?: string;
  category?: 'meeting' | 'admin' | 'productive';
}

type SubTab = 'timesheet' | 'entries' | 'comparison' | 'burndown' | 'trends' | 'heatmap';

const CATEGORY_COLORS: Record<string, string> = {
  meeting: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
  admin: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  productive: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
};

export function TimeTrackingTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const [subTab, setSubTab] = useState<SubTab>('timesheet');
  const [showLogForm, setShowLogForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Get project members to determine current user's role
  const { data: membersData } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => apiService.getProjectMembers(projectId),
    staleTime: 60_000,
  });
  const members: any[] = membersData?.members || [];
  const currentMember = members.find((m: any) => m.userId === currentUser?.id);
  const isManagerOrOwner = currentMember?.role === 'owner' || currentMember?.role === 'manager';

  const [viewMode, setViewMode] = useState<'mine' | 'all'>('all');
  const viewModeInitialized = useRef(false);
  useEffect(() => {
    if (membersData && !viewModeInitialized.current) {
      viewModeInitialized.current = true;
      setViewMode(isManagerOrOwner ? 'all' : 'mine');
    }
  }, [membersData, isManagerOrOwner]);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formHours, setFormHours] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBillable, setFormBillable] = useState(true);
  const [formScheduleId, setFormScheduleId] = useState('');
  const [formTaskId, setFormTaskId] = useState('');
  const [suggestionApplied, setSuggestionApplied] = useState(false);

  // Schedules for this project
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });
  const schedules: any[] = schedulesData?.schedules || [];

  // Auto-select first schedule
  React.useEffect(() => {
    if (schedules.length > 0 && !formScheduleId) {
      setFormScheduleId(schedules[0].id);
    }
  }, [schedules, formScheduleId]);

  // Tasks for selected schedule
  const { data: tasksData } = useQuery({
    queryKey: ['tasks', formScheduleId],
    queryFn: () => apiService.getTasks(formScheduleId),
    enabled: !!formScheduleId,
  });
  const tasks: any[] = tasksData?.data || tasksData?.tasks || [];

  // AI suggestion — fetch when form opens
  const { data: suggestionData } = useQuery({
    queryKey: ['time-suggestion', projectId, formDate],
    queryFn: () => apiService.getTimeSuggestion(projectId, formDate),
    enabled: showLogForm,
    staleTime: 60_000,
  });
  const suggestion = suggestionData?.suggestion || null;

  // Apply suggestion to form (only once, only if fields are at defaults)
  useEffect(() => {
    if (suggestion && showLogForm && !suggestionApplied) {
      if (!formTaskId && suggestion.taskId) {
        const matchingTask = tasks.find((t: any) => t.id === suggestion.taskId);
        if (matchingTask) setFormTaskId(suggestion.taskId);
      }
      if (!formHours && suggestion.hours) {
        setFormHours(String(suggestion.hours));
      }
      if (!formDescription && suggestion.description) {
        setFormDescription(suggestion.description);
      }
      setSuggestionApplied(true);
    }
  }, [suggestion, showLogForm, tasks, formTaskId, formHours, formDescription, suggestionApplied]);

  // Reset suggestion state when form closes
  useEffect(() => {
    if (!showLogForm) setSuggestionApplied(false);
  }, [showLogForm]);

  // Time entries for this project — filtered by user when in "mine" mode
  const filterUserId = viewMode === 'mine' ? currentUser?.id : undefined;
  const { data: entriesData, isLoading: entriesLoading } = useQuery({
    queryKey: ['project-time-entries', projectId, filterUserId],
    queryFn: () => apiService.getProjectTimeEntries(projectId, undefined, undefined, filterUserId),
    enabled: !!projectId,
  });
  const allEntries: TimeEntry[] = entriesData?.entries || entriesData?.data || [];
  const entries = categoryFilter === 'all' ? allEntries : allEntries.filter(e => e.category === categoryFilter);

  // Actual vs estimated for first schedule
  const primaryScheduleId = schedules[0]?.id;
  const { data: comparisonData, isLoading: comparisonLoading } = useQuery({
    queryKey: ['actual-vs-estimated', primaryScheduleId],
    queryFn: () => apiService.getActualVsEstimated(primaryScheduleId),
    enabled: !!primaryScheduleId && subTab === 'comparison',
  });
  const comparisonTasks = comparisonData?.tasks || [];

  // Mutations
  const createMutation = useMutation({
    mutationFn: () => apiService.createTimeEntry({
      taskId: formTaskId,
      scheduleId: formScheduleId,
      projectId,
      date: formDate,
      hours: parseFloat(formHours),
      description: formDescription || undefined,
      billable: formBillable,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-time-entries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['actual-vs-estimated'] });
      setShowLogForm(false);
      setFormHours('');
      setFormDescription('');
      setFormTaskId('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiService.deleteTimeEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-time-entries', projectId] });
      queryClient.invalidateQueries({ queryKey: ['actual-vs-estimated'] });
    },
  });

  // Stats
  const totalHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
  const billableHours = entries.filter(e => e.billable).reduce((sum, e) => sum + (e.hours || 0), 0);
  const uniqueUsers = new Set(entries.map(e => e.userName)).size;

  return (
    <div className="mt-6 space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-4 flex-wrap">
            <button
              onClick={() => setSubTab('timesheet')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'timesheet' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <CalendarDays className="w-4 h-4" /> Timesheet
            </button>
            <button
              onClick={() => setSubTab('entries')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'entries' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <Clock className="w-4 h-4" /> Entries
            </button>
            <button
              onClick={() => setSubTab('comparison')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'comparison' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <BarChart3 className="w-4 h-4" /> Actual vs Est.
            </button>
            <button
              onClick={() => setSubTab('burndown')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'burndown' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <TrendingDown className="w-4 h-4" /> Burndown
            </button>
            <button
              onClick={() => setSubTab('trends')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'trends' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <TrendingUp className="w-4 h-4" /> Trends
            </button>
            <button
              onClick={() => setSubTab('heatmap')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'heatmap' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <Grid3X3 className="w-4 h-4" /> Heatmap
            </button>
          </div>
        </div>
        {subTab === 'entries' && (
          <div className="flex items-center gap-2">
            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              <option value="all">All Categories</option>
              <option value="productive">Productive</option>
              <option value="meeting">Meeting</option>
              <option value="admin">Admin</option>
            </select>
            {/* My Time / All Time toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('mine')}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'mine'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <User className="w-3.5 h-3.5" /> My Time
              </button>
              {isManagerOrOwner && (
                <button
                  onClick={() => setViewMode('all')}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    viewMode === 'all'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" /> All Time
                </button>
              )}
            </div>
            <button
              onClick={() => setShowLogForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Log Time
            </button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg"><Clock className="w-5 h-5 text-blue-600" /></div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalHours.toFixed(1)}h</p>
              <p className="text-xs text-gray-500">Total Hours</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg"><Clock className="w-5 h-5 text-green-600" /></div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{billableHours.toFixed(1)}h</p>
              <p className="text-xs text-gray-500">Billable Hours</p>
            </div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded-lg"><Clock className="w-5 h-5 text-purple-600" /></div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{uniqueUsers}</p>
              <p className="text-xs text-gray-500">Contributors</p>
            </div>
          </div>
        </div>
      </div>

      {/* Log Time Form */}
      {showLogForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-primary-200 dark:border-primary-700 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Log Time</h3>
              {suggestion && (
                <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                  <Sparkles className="w-3 h-3" /> AI suggested
                </span>
              )}
            </div>
            <button onClick={() => setShowLogForm(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {schedules.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Schedule</label>
                <select
                  value={formScheduleId}
                  onChange={(e) => { setFormScheduleId(e.target.value); setFormTaskId(''); }}
                  className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100"
                >
                  {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Task</label>
              <select
                value={formTaskId}
                onChange={(e) => setFormTaskId(e.target.value)}
                className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">Select task...</option>
                {tasks.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date</label>
              <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Hours</label>
              <input type="number" step="0.25" min="0.25" value={formHours} onChange={(e) => setFormHours(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" placeholder="0.0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
              <input type="text" value={formDescription} onChange={(e) => setFormDescription(e.target.value)} className="input w-full text-sm dark:bg-gray-700 dark:text-gray-100" placeholder="Optional" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <input type="checkbox" checked={formBillable} onChange={(e) => setFormBillable(e.target.checked)} className="rounded border-gray-300 dark:border-gray-600" />
              Billable
            </label>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!formTaskId || !formHours || createMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? 'Saving...' : 'Log Entry'}
            </button>
          </div>
        </div>
      )}

      {/* Timesheet grid sub-tab */}
      {subTab === 'timesheet' && <ProjectTimesheetGrid projectId={projectId} />}

      {/* Anomaly and Review panels (entries sub-tab only) */}
      {subTab === 'entries' && isManagerOrOwner && (
        <>
          <TimeAnomalyPanel projectId={projectId} isManagerOrOwner={isManagerOrOwner} />
          <WeeklyReviewPanel projectId={projectId} />
        </>
      )}

      {/* Time Entries sub-tab */}
      {subTab === 'entries' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          {entriesLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No time entries yet. Log time against project tasks.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Date</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Task</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">User</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Category</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Hours</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Description</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Billable</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{e.taskName || e.taskId}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{e.userName || '\u2014'}</td>
                    <td className="px-4 py-3">
                      {e.category && (
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${CATEGORY_COLORS[e.category] || ''}`}>
                          {e.category}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{e.hours}h</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{e.description || '\u2014'}</td>
                    <td className="px-4 py-3 text-center">{e.billable ? <span className="text-green-600 text-xs font-medium">Yes</span> : <span className="text-gray-400 text-xs">No</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => deleteMutation.mutate(e.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Actual vs Estimated sub-tab */}
      {subTab === 'comparison' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          {!primaryScheduleId ? (
            <div className="text-center py-12 text-gray-400">No schedule found for this project.</div>
          ) : comparisonLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : comparisonTasks.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No task estimates or time entries to compare.</div>
          ) : (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Estimated vs Actual Hours by Task</h3>
              <ActualVsEstimatedChart tasks={comparisonTasks} />
            </div>
          )}
        </div>
      )}

      {/* Burndown sub-tab */}
      {subTab === 'burndown' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Burndown Forecast</h3>
          <TimeBurndownChart projectId={projectId} />
        </div>
      )}

      {/* Trends sub-tab */}
      {subTab === 'trends' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Trend Analysis</h3>
          <TimeTrendChart projectId={projectId} />
        </div>
      )}

      {/* Heatmap sub-tab */}
      {subTab === 'heatmap' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Team Utilization Heatmap</h3>
          <UtilizationHeatmap projectId={projectId} />
        </div>
      )}
    </div>
  );
}
