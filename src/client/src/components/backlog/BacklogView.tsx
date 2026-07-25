import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox, Plus, ArrowRight } from 'lucide-react';
import { apiService } from '../../services/api';

interface BacklogTask {
  id: string;
  name: string;
  status: string;
  priority: string | null;
  assignedTo: string | null;
  dueDate: string | null;
  estimatedDays: number | null;
  progressPercentage: number | null;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
}

interface BacklogViewProps {
  projectId: string;
}

const priorityBadge: Record<string, { bg: string; text: string }> = {
  urgent: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
  high: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  medium: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400' },
  low: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
};

const statusBadge: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300' },
  in_progress: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
  completed: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
};

export function BacklogView({ projectId }: BacklogViewProps) {
  const queryClient = useQueryClient();
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [assignSprintId, setAssignSprintId] = useState('');

  // Fetch schedules
  const { data: schedulesData } = useQuery({
    queryKey: ['schedules', projectId],
    queryFn: () => apiService.getSchedules(projectId),
    enabled: !!projectId,
  });

  const schedules: any[] = schedulesData?.schedules || [];

  React.useEffect(() => {
    if (schedules.length > 0 && !selectedScheduleId) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedScheduleId]);

  // Fetch backlog tasks
  const { data: backlogData, isLoading } = useQuery({
    queryKey: ['backlog', selectedScheduleId],
    queryFn: () => apiService.getBacklogTasks(selectedScheduleId),
    enabled: !!selectedScheduleId,
  });

  const tasks: BacklogTask[] = backlogData?.tasks ?? [];

  // Fetch sprints for "assign to sprint" dropdown
  const { data: sprintsData } = useQuery({
    queryKey: ['sprints', projectId],
    queryFn: () => apiService.getSprints(projectId),
    enabled: !!projectId,
  });

  const sprints: Sprint[] = (sprintsData?.data ?? sprintsData?.sprints ?? [])
    .filter((s: Sprint) => s.status === 'planning' || s.status === 'active');

  // Assign to sprint mutation
  const assignMutation = useMutation({
    mutationFn: async ({ sprintId, taskIds }: { sprintId: string; taskIds: string[] }) => {
      for (const taskId of taskIds) {
        await apiService.addSprintTask(sprintId, taskId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backlog', selectedScheduleId] });
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
      setSelectedTasks(new Set());
      setAssignSprintId('');
    },
  });

  // Filter tasks
  const filtered = useMemo(() => {
    if (priorityFilter === 'all') return tasks;
    return tasks.filter(t => (t.priority || 'medium') === priorityFilter);
  }, [tasks, priorityFilter]);

  const toggleTask = (id: string) => {
    setSelectedTasks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTasks.size === filtered.length) {
      setSelectedTasks(new Set());
    } else {
      setSelectedTasks(new Set(filtered.map(t => t.id)));
    }
  };

  const handleAssign = () => {
    if (!assignSprintId || selectedTasks.size === 0) return;
    assignMutation.mutate({ sprintId: assignSprintId, taskIds: Array.from(selectedTasks) });
  };

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Backlog</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {tasks.length} unassigned task{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {schedules.length > 1 && (
            <select
              value={selectedScheduleId}
              onChange={(e) => { setSelectedScheduleId(e.target.value); setSelectedTasks(new Set()); }}
              className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
            >
              {schedules.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
          >
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Bulk assign bar */}
      {selectedTasks.size > 0 && sprints.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectedTasks.size} selected
          </span>
          <ArrowRight className="w-4 h-4 text-indigo-400" />
          <select
            value={assignSprintId}
            onChange={(e) => setAssignSprintId(e.target.value)}
            className="rounded-md border border-indigo-300 dark:border-indigo-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm flex-1 max-w-xs"
          >
            <option value="">Select sprint…</option>
            {sprints.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={handleAssign}
            disabled={!assignSprintId || assignMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {assignMutation.isPending ? 'Assigning…' : 'Assign to Sprint'}
          </button>
        </div>
      )}

      {/* Task table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
          <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {tasks.length === 0 ? 'All tasks are assigned to sprints.' : 'No tasks match this filter.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-3 py-2 text-left w-8">
                  <input
                    type="checkbox"
                    checked={selectedTasks.size === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Task</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase w-24">Priority</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase w-24">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase w-32 hidden md:table-cell">Assignee</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase w-16 hidden lg:table-cell">Est.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(task => {
                const pBadge = priorityBadge[task.priority || 'medium'] || priorityBadge.medium;
                const sBadge = statusBadge[task.status] || statusBadge.pending;
                return (
                  <tr
                    key={task.id}
                    className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                      selectedTasks.has(task.id) ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedTasks.has(task.id)}
                        onChange={() => toggleTask(task.id)}
                        className="rounded border-gray-300 dark:border-gray-600"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-gray-900 dark:text-gray-100">{task.name}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${pBadge.bg} ${pBadge.text} capitalize`}>
                        {task.priority || 'medium'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${sBadge.bg} ${sBadge.text}`}>
                        {(task.status || 'pending').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {task.assignedTo || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {task.estimatedDays != null ? `${task.estimatedDays}d` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
