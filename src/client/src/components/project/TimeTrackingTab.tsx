import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, Trash2, BarChart3, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { ActualVsEstimatedChart } from '../timetracking/ActualVsEstimatedChart';

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
}

type SubTab = 'entries' | 'comparison';

export function TimeTrackingTab({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>('entries');
  const [showLogForm, setShowLogForm] = useState(false);
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formHours, setFormHours] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBillable, setFormBillable] = useState(true);
  const [formScheduleId, setFormScheduleId] = useState('');
  const [formTaskId, setFormTaskId] = useState('');

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

  // Time entries for this project
  const { data: entriesData, isLoading: entriesLoading } = useQuery({
    queryKey: ['project-time-entries', projectId],
    queryFn: () => apiService.getProjectTimeEntries(projectId),
    enabled: !!projectId,
  });
  const entries: TimeEntry[] = entriesData?.entries || entriesData?.data || [];

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
      <div className="flex items-center justify-between">
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex gap-6">
            <button
              onClick={() => setSubTab('entries')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'entries' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <Clock className="w-4 h-4" /> Time Entries
            </button>
            <button
              onClick={() => setSubTab('comparison')}
              className={`flex items-center gap-1.5 pb-3 text-sm font-medium border-b-2 transition-colors ${subTab === 'comparison' ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              <BarChart3 className="w-4 h-4" /> Actual vs Estimated
            </button>
          </div>
        </div>
        {subTab === 'entries' && (
          <button
            onClick={() => setShowLogForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Log Time
          </button>
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
            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Log Time</h3>
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
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{e.userName || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{e.hours}h</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 truncate max-w-[200px]">{e.description || '—'}</td>
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
    </div>
  );
}
