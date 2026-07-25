import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Play, CheckCircle2, Target, GripVertical, Search } from 'lucide-react';
import { apiService } from '../../services/api';

interface Task {
  id: string;
  name: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  story_points?: number;
  storyPoints?: number;
}

interface Sprint {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'completed' | 'cancelled';
  goal?: string;
  start_date?: string;
  end_date?: string;
  velocity_commitment?: number;
  tasks?: Task[];
}

interface SprintPlanningPanelProps {
  projectId: string;
  scheduleId: string;
  sprintId: string;
}

const priorityBadge: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  urgent: { bg: 'bg-red-100', text: 'text-red-700', darkBg: 'dark:bg-red-900/30', darkText: 'dark:text-red-300' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', darkBg: 'dark:bg-orange-900/30', darkText: 'dark:text-orange-300' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', darkBg: 'dark:bg-yellow-900/30', darkText: 'dark:text-yellow-300' },
  low: { bg: 'bg-green-100', text: 'text-green-700', darkBg: 'dark:bg-green-900/30', darkText: 'dark:text-green-300' },
};

const statusBadge: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', darkBg: 'dark:bg-gray-700', darkText: 'dark:text-gray-300' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', darkBg: 'dark:bg-blue-900/30', darkText: 'dark:text-blue-300' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', darkBg: 'dark:bg-green-900/30', darkText: 'dark:text-green-300' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', darkBg: 'dark:bg-red-900/30', darkText: 'dark:text-red-300' },
};

function getPoints(task: Task): number {
  return task.story_points ?? task.storyPoints ?? 0;
}

function TaskCard({
  task,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  actionColor,
}: {
  task: Task;
  actionLabel: string;
  actionIcon: React.ElementType;
  onAction: () => void;
  actionColor: string;
}) {
  const pBadge = priorityBadge[task.priority || 'medium'] || priorityBadge.medium;
  const sBadge = statusBadge[task.status] || statusBadge.pending;

  return (
    <div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 hover:shadow-sm dark:hover:shadow-lg dark:hover:shadow-black/10 transition-shadow group">
      <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-gray-900 dark:text-white truncate">{task.name}</div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${pBadge.bg} ${pBadge.text} ${pBadge.darkBg} ${pBadge.darkText} capitalize`}>
            {task.priority || 'medium'}
          </span>
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${sBadge.bg} ${sBadge.text} ${sBadge.darkBg} ${sBadge.darkText}`}>
            {(task.status || 'pending').replace('_', ' ')}
          </span>
        </div>
      </div>
      {getPoints(task) > 0 && (
        <span className="text-xs font-bold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded flex-shrink-0">
          {getPoints(task)} pts
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        title={actionLabel}
        className={`p-1 rounded hover:bg-opacity-20 transition-colors flex-shrink-0 ${actionColor}`}
      >
        <ActionIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function SprintPlanningPanel({ projectId, scheduleId, sprintId }: SprintPlanningPanelProps) {
  const queryClient = useQueryClient();
  const [backlogSearch, setBacklogSearch] = useState('');
  const [backlogPriority, setBacklogPriority] = useState<string>('all');

  const { data: sprintData, isLoading: sprintLoading } = useQuery({
    queryKey: ['sprint', sprintId],
    queryFn: () => apiService.getSprint(sprintId),
  });

  const { data: allTasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', scheduleId],
    queryFn: () => apiService.getTasks(scheduleId),
  });

  const sprint: Sprint | null = sprintData?.sprint ?? sprintData ?? null;
  const allTasks: Task[] = allTasksData?.tasks ?? allTasksData ?? [];
  const sprintTasks: Task[] = sprint?.tasks ?? [];
  const sprintTaskIds = useMemo(() => new Set(sprintTasks.map((t) => t.id)), [sprintTasks]);

  const backlogTasks = useMemo(() => {
    let tasks = allTasks.filter((t) => !sprintTaskIds.has(t.id));
    if (backlogSearch.trim()) {
      const q = backlogSearch.toLowerCase();
      tasks = tasks.filter((t) => t.name.toLowerCase().includes(q) || (t.assignedTo && t.assignedTo.toLowerCase().includes(q)));
    }
    if (backlogPriority !== 'all') {
      tasks = tasks.filter((t) => (t.priority || 'medium') === backlogPriority);
    }
    return tasks;
  }, [allTasks, sprintTaskIds, backlogSearch, backlogPriority]);

  const totalBacklog = useMemo(() => allTasks.filter((t) => !sprintTaskIds.has(t.id)).length, [allTasks, sprintTaskIds]);

  const totalPoints = useMemo(
    () => sprintTasks.reduce((sum, t) => sum + getPoints(t), 0),
    [sprintTasks],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['sprint', sprintId] });
    queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
  };

  const addTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiService.addSprintTask(sprintId, taskId),
    onSuccess: invalidate,
  });

  const removeTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiService.removeSprintTask(sprintId, taskId),
    onSuccess: invalidate,
  });

  const startSprintMutation = useMutation({
    mutationFn: () => apiService.startSprint(sprintId),
    onSuccess: invalidate,
  });

  const completeSprintMutation = useMutation({
    mutationFn: () => apiService.completeSprint(sprintId),
    onSuccess: invalidate,
  });

  const [createForm, setCreateForm] = useState({
    name: '',
    goal: '',
    start_date: '',
    end_date: '',
    velocity_commitment: '',
  });

  const createSprintMutation = useMutation({
    mutationFn: () =>
      apiService.createSprint({
        projectId,
        scheduleId,
        name: createForm.name,
        goal: createForm.goal || undefined,
        startDate: createForm.start_date,
        endDate: createForm.end_date,
        velocityCommitment: createForm.velocity_commitment
          ? Number(createForm.velocity_commitment)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', projectId] });
    },
  });

  const isLoading = sprintLoading || tasksLoading;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-40 bg-gray-100 dark:bg-gray-700 rounded" />
            <div className="h-40 bg-gray-100 dark:bg-gray-700 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-5 h-5 text-primary-500" />
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Create Sprint</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sprint Name *</label>
            <input
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="Sprint 1"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Goal</label>
            <textarea
              value={createForm.goal}
              onChange={(e) => setCreateForm((f) => ({ ...f, goal: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none resize-none"
              rows={2}
              placeholder="What should this sprint achieve?"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Start Date *</label>
              <input
                type="date"
                value={createForm.start_date}
                onChange={(e) => setCreateForm((f) => ({ ...f, start_date: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">End Date *</label>
              <input
                type="date"
                value={createForm.end_date}
                onChange={(e) => setCreateForm((f) => ({ ...f, end_date: e.target.value }))}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Velocity Commitment</label>
            <input
              type="number"
              value={createForm.velocity_commitment}
              onChange={(e) => setCreateForm((f) => ({ ...f, velocity_commitment: e.target.value }))}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="e.g. 30"
              min={0}
            />
          </div>
          <button
            onClick={() => createSprintMutation.mutate()}
            disabled={!createForm.name || !createForm.start_date || !createForm.end_date || createSprintMutation.isPending}
            className="w-full mt-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-md transition-colors"
          >
            {createSprintMutation.isPending ? 'Creating…' : 'Create Sprint'}
          </button>
        </div>
      </div>
    );
  }

  const canStart = sprint.status === 'planning';
  const canComplete = sprint.status === 'active';

  return (
    <div className="space-y-4">
      {/* Sprint header */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-white">{sprint.name}</h3>
            {sprint.goal && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sprint.goal}</p>}
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500 flex-wrap">
              {sprint.start_date && (
                <span>
                  {new Date(sprint.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' - '}
                  {sprint.end_date
                    ? new Date(sprint.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '?'}
                </span>
              )}
              {sprint.velocity_commitment != null && (
                <span>Commitment: {sprint.velocity_commitment} pts</span>
              )}
              <span className="font-medium text-primary-600 dark:text-primary-400">Sprint total: {totalPoints} pts</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canStart && (
              <button
                onClick={() => startSprintMutation.mutate()}
                disabled={startSprintMutation.isPending}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 px-3 py-1.5 rounded-md transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{startSprintMutation.isPending ? 'Starting...' : 'Start Sprint'}</span>
                <span className="sm:hidden">{startSprintMutation.isPending ? '...' : 'Start'}</span>
              </button>
            )}
            {canComplete && (
              <button
                onClick={() => completeSprintMutation.mutate()}
                disabled={completeSprintMutation.isPending}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 px-3 py-1.5 rounded-md transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{completeSprintMutation.isPending ? 'Completing...' : 'Complete Sprint'}</span>
                <span className="sm:hidden">{completeSprintMutation.isPending ? '...' : 'Done'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Backlog column */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Backlog</h4>
            <span className="text-xs font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-700 rounded-full w-5 h-5 flex items-center justify-center">
              {totalBacklog}
            </span>
          </div>
          {/* Search/filter bar */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
              <input
                type="text"
                value={backlogSearch}
                onChange={(e) => setBacklogSearch(e.target.value)}
                placeholder="Search backlog..."
                className="w-full pl-7 pr-2 py-1 text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
              />
            </div>
            <select
              value={backlogPriority}
              onChange={(e) => setBacklogPriority(e.target.value)}
              className="text-xs border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md px-2 py-1 outline-none"
            >
              <option value="all">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="p-2 space-y-1.5 max-h-[60vh] overflow-y-auto">
            {backlogTasks.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">
                {totalBacklog === 0 ? 'All tasks are in this sprint' : 'No matching tasks'}
              </div>
            ) : (
              backlogTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  actionLabel="Add to Sprint"
                  actionIcon={Plus}
                  onAction={() => addTaskMutation.mutate(task.id)}
                  actionColor="text-primary-600 hover:bg-primary-100 dark:hover:bg-primary-900/30"
                />
              ))
            )}
          </div>
        </div>

        {/* Sprint column */}
        <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-primary-700 dark:text-primary-300 uppercase tracking-wide">Sprint</h4>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-primary-500 dark:text-primary-400 bg-white dark:bg-gray-800 rounded-full px-2 py-0.5">
                {totalPoints} pts
              </span>
              <span className="text-xs font-bold text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800 rounded-full w-5 h-5 flex items-center justify-center">
                {sprintTasks.length}
              </span>
            </div>
          </div>
          <div className="p-2 space-y-1.5 max-h-[60vh] overflow-y-auto">
            {sprintTasks.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-500">
                Add tasks from the backlog to plan this sprint
              </div>
            ) : (
              sprintTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  actionLabel="Remove from Sprint"
                  actionIcon={Trash2}
                  onAction={() => removeTaskMutation.mutate(task.id)}
                  actionColor="text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30"
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
