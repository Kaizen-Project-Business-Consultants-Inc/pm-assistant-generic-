import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, AlertTriangle, Clock, CalendarCheck, Play, CalendarDays, CheckCircle2, FolderPlus, LayoutTemplate } from 'lucide-react';
import { apiService } from '../services/api';
import { routeTo, ROUTES } from '../routes';

interface MyWorkTask {
  id: number;
  name: string;
  status: string;
  priority: string;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number;
  projectId: number;
  projectName: string;
  scheduleId: number;
}

interface Bucket {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  tasks: MyWorkTask[];
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
};

const statusLabels: Record<string, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'completed': 'Complete',
  'done': 'Complete',
  'on-hold': 'On Hold',
  'blocked': 'Blocked',
  'cancelled': 'Cancelled',
};

const statusColors: Record<string, string> = {
  'not-started': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  'in-progress': 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'completed': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'done': 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  'on-hold': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  'blocked': 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  'cancelled': 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday(): string {
  return toLocalDateStr(new Date());
}

function getEndOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + daysUntilSunday);
  return toLocalDateStr(d);
}

function getSevenDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return toLocalDateStr(d);
}

function bucketTasks(tasks: MyWorkTask[]): Bucket[] {
  const today = getToday();
  const endOfWeek = getEndOfWeek();
  const sevenDaysAgo = getSevenDaysAgo();

  const overdue: MyWorkTask[] = [];
  const dueToday: MyWorkTask[] = [];
  const dueThisWeek: MyWorkTask[] = [];
  const inProgress: MyWorkTask[] = [];
  const upcoming: MyWorkTask[] = [];
  const recentlyCompleted: MyWorkTask[] = [];

  for (const task of tasks) {
    const isComplete = task.status === 'completed' || task.status === 'done';

    if (isComplete) {
      // Show recently completed tasks (with or without endDate)
      if (!task.endDate || task.endDate >= sevenDaysAgo) {
        recentlyCompleted.push(task);
      }
      continue;
    }

    // Tasks with no due date: bucket by status
    if (!task.endDate) {
      if (task.status === 'in-progress') {
        inProgress.push(task);
      } else {
        upcoming.push(task);
      }
      continue;
    }

    if (task.endDate < today) {
      overdue.push(task);
    } else if (task.endDate === today) {
      dueToday.push(task);
    } else if (task.endDate <= endOfWeek) {
      dueThisWeek.push(task);
    } else if (task.status === 'in-progress') {
      inProgress.push(task);
    } else {
      upcoming.push(task);
    }
  }

  return [
    { key: 'overdue', label: 'Overdue', icon: AlertTriangle, color: 'text-red-600 dark:text-red-400', tasks: overdue },
    { key: 'dueToday', label: 'Due Today', icon: Clock, color: 'text-orange-600 dark:text-orange-400', tasks: dueToday },
    { key: 'dueThisWeek', label: 'Due This Week', icon: CalendarCheck, color: 'text-yellow-600 dark:text-yellow-400', tasks: dueThisWeek },
    { key: 'inProgress', label: 'In Progress', icon: Play, color: 'text-blue-600 dark:text-blue-400', tasks: inProgress },
    { key: 'upcoming', label: 'Upcoming', icon: CalendarDays, color: 'text-gray-600 dark:text-gray-400', tasks: upcoming },
    { key: 'recentlyCompleted', label: 'Recently Completed', icon: CheckCircle2, color: 'text-green-600 dark:text-green-400', tasks: recentlyCompleted },
  ].filter(b => b.tasks.length > 0);
}

function TaskRow({ task }: { task: MyWorkTask }) {
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 last:border-b-0">
      {/* Priority dot */}
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${priorityColors[task.priority] || priorityColors.medium}`} title={task.priority} />

      {/* Task name — link to task */}
      <Link
        to={routeTo.project(String(task.projectId), 'schedule') + `&taskId=${task.id}`}
        className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400"
      >
        {task.name}
      </Link>

      {/* Status chip */}
      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${statusColors[task.status] || statusColors['not-started']}`}>
        {statusLabels[task.status] || task.status}
      </span>

      {/* Second row on mobile: project + due date */}
      <div className="w-full sm:w-auto sm:contents flex items-center gap-2 pl-5 sm:pl-0">
        <Link
          to={routeTo.project(String(task.projectId))}
          className="text-xs text-primary-600 dark:text-primary-400 hover:underline truncate max-w-[160px] flex-shrink-0"
        >
          {task.projectName}
        </Link>
        <span className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right flex-shrink-0 hidden sm:inline">
          {task.endDate || '--'}
        </span>
      </div>
    </div>
  );
}

function BucketSection({ bucket }: { bucket: Bucket }) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = bucket.icon;
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="mb-4">
      <button
        className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <Chevron className="w-4 h-4 text-gray-400" />
        <Icon className={`w-4 h-4 ${bucket.color}`} />
        <span className={`text-sm font-semibold ${bucket.color}`}>{bucket.label}</span>
        <span className="ml-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full px-2 py-0.5">
          {bucket.tasks.length}
        </span>
      </button>
      {!collapsed && (
        <div className="ml-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
          {bucket.tasks.map(task => (
            <TaskRow key={`${task.scheduleId}-${task.id}`} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MyWorkPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['my-work'],
    queryFn: () => apiService.getMyWork(),
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiService.getProjects(),
    staleTime: 60000,
  });
  const hasProjects = (projectsData?.projects?.length ?? 0) > 0;

  const buckets = useMemo(() => {
    if (!data?.tasks) return [];
    return bucketTasks(data.tasks);
  }, [data]);

  const totalActive = useMemo(() => {
    if (!data?.tasks) return 0;
    return data.tasks.filter((t: MyWorkTask) => t.status !== 'completed' && t.status !== 'done').length;
  }, [data]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My Work</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{today}</p>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-red-700 dark:text-red-400 text-sm">
          Failed to load tasks. Please try again later.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && data && buckets.length === 0 && (
        hasProjects ? (
          <div className="text-center py-20">
            <CheckCircle2 className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
            <h2 className="text-lg font-medium text-gray-600 dark:text-gray-400">You're all caught up!</h2>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 mb-4">
              No tasks are assigned to you right now. Tasks will appear here when you're assigned to them in a project schedule.
            </p>
            <Link to={ROUTES.projects} className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400">
              Go to Projects →
            </Link>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="mx-auto w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mb-4">
              <FolderPlus className="w-8 h-8 text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Welcome! Let's get started.</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
              Create your first project to start planning, tracking tasks, and managing your work.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to={ROUTES.projects}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
              >
                <FolderPlus className="w-4 h-4" />
                Create a Project
              </Link>
              <Link
                to={ROUTES.projects}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <LayoutTemplate className="w-4 h-4" />
                Use a Template
              </Link>
            </div>
          </div>
        )
      )}

      {/* Task count summary */}
      {!isLoading && !error && buckets.length > 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {totalActive} active {totalActive === 1 ? 'task' : 'tasks'} across {new Set(data.tasks.filter((t: MyWorkTask) => t.status !== 'completed' && t.status !== 'done').map((t: MyWorkTask) => t.projectId)).size} {new Set(data.tasks.filter((t: MyWorkTask) => t.status !== 'completed' && t.status !== 'done').map((t: MyWorkTask) => t.projectId)).size === 1 ? 'project' : 'projects'}
        </p>
      )}

      {/* Buckets */}
      {buckets.map(bucket => (
        <BucketSection key={bucket.key} bucket={bucket} />
      ))}
    </div>
  );
}
