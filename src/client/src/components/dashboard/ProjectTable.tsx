import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, ChevronDown, ChevronsUpDown, FolderKanban, Play, Plus } from 'lucide-react';
import { MetaPill } from '../ui/MetaPill';
import { apiService } from '../../services/api';

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  priority?: string;
  projectType?: string;
  progressPercentage?: number;
  budgetAllocated?: number;
  budgetSpent?: number;
  startDate?: string;
  endDate?: string;
  healthScore?: number;
}

type SortKey =
  | 'name'
  | 'healthScore'
  | 'status'
  | 'priority'
  | 'projectType'
  | 'progressPercentage'
  | 'budgetAllocated'
  | 'budgetPct'
  | 'endDate'
  | 'daysRemaining';

const statusConfig: Record<string, { label: string; variant: 'success' | 'info' | 'warning' | 'default' | 'muted' }> = {
  active: { label: 'Active', variant: 'success' },
  planning: { label: 'Planning', variant: 'info' },
  on_hold: { label: 'On Hold', variant: 'warning' },
  completed: { label: 'Completed', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
};

const priorityVariant: Record<string, 'danger' | 'warning' | 'default' | 'success'> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'default',
  low: 'success',
};

const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const statusOrder: Record<string, number> = {
  active: 0,
  planning: 1,
  on_hold: 2,
  completed: 3,
  cancelled: 4,
};

const typeLabels: Record<string, string> = {
  it: 'IT',
  construction: 'Construction',
  infrastructure: 'Infrastructure',
  roads: 'Roads',
  other: 'Other',
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysRemaining(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDollar(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-300" />;
  return dir === 'asc'
    ? <ChevronUp className="h-3.5 w-3.5 text-primary-500" />
    : <ChevronDown className="h-3.5 w-3.5 text-primary-500" />;
}

interface Props {
  projects: ProjectRow[];
  linkPrefix?: string;
}

export function ProjectTable({ projects }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const startMutation = useMutation({
    mutationFn: (projectId: string) => apiService.updateProjectStatus(projectId, 'active'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pm-projects'] });
      queryClient.invalidateQueries({ queryKey: ['pm-predictions'] });
    },
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = [...projects].sort((a, b) => {
    let valA: number | string;
    let valB: number | string;

    switch (sortKey) {
      case 'name':
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        break;
      case 'healthScore':
        valA = a.healthScore ?? -1;
        valB = b.healthScore ?? -1;
        break;
      case 'status':
        valA = statusOrder[a.status] ?? 99;
        valB = statusOrder[b.status] ?? 99;
        break;
      case 'priority':
        valA = priorityOrder[a.priority ?? ''] ?? 99;
        valB = priorityOrder[b.priority ?? ''] ?? 99;
        break;
      case 'projectType':
        valA = (typeLabels[a.projectType ?? ''] ?? a.projectType ?? '').toLowerCase();
        valB = (typeLabels[b.projectType ?? ''] ?? b.projectType ?? '').toLowerCase();
        break;
      case 'progressPercentage':
        valA = a.progressPercentage ?? 0;
        valB = b.progressPercentage ?? 0;
        break;
      case 'budgetAllocated':
        valA = a.budgetAllocated ?? 0;
        valB = b.budgetAllocated ?? 0;
        break;
      case 'budgetPct': {
        const pctA = a.budgetAllocated ? (a.budgetSpent ?? 0) / a.budgetAllocated : 0;
        const pctB = b.budgetAllocated ? (b.budgetSpent ?? 0) / b.budgetAllocated : 0;
        valA = pctA;
        valB = pctB;
        break;
      }
      case 'endDate':
        valA = a.endDate ?? '';
        valB = b.endDate ?? '';
        break;
      case 'daysRemaining':
        valA = daysRemaining(a.endDate) ?? Infinity;
        valB = daysRemaining(b.endDate) ?? Infinity;
        break;
      default:
        valA = '';
        valB = '';
    }

    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  function Th({ label, sortable, col }: { label: string; sortable?: SortKey; col?: string }) {
    const active = sortable !== undefined && sortKey === sortable;
    return (
      <th
        className={`px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap ${col ?? ''} ${sortable ? 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200' : ''}`}
        onClick={sortable ? () => handleSort(sortable) : undefined}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortable && <SortIcon active={active} dir={sortDir} />}
        </span>
      </th>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="card text-center py-12">
        <FolderKanban className="mx-auto h-12 w-12 text-gray-300 mb-3" />
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">No projects yet</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Create your first project to get started.</p>
        <Link
          to="/projects?new=1"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <table className="min-w-full divide-y divide-gray-100 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <Th label="Name" sortable="name" />
            <Th label="Health" sortable="healthScore" />
            <Th label="Status" sortable="status" />
            <Th label="Priority" sortable="priority" col="hidden sm:table-cell" />
            <Th label="Type" sortable="projectType" col="hidden sm:table-cell" />
            <Th label="Progress" sortable="progressPercentage" />
            <Th label="Budget" sortable="budgetAllocated" col="hidden md:table-cell" />
            <Th label="Spent" sortable="budgetPct" col="hidden md:table-cell" />
            <Th label="End Date" sortable="endDate" col="hidden sm:table-cell" />
            <Th label="Days Left" sortable="daysRemaining" />
            <th className="px-3 py-2.5 w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
          {sorted.slice(0, 10).map((project) => {
            const status = statusConfig[project.status] || statusConfig.planning;
            const progress = project.progressPercentage ?? 0;
            const budgetAllocated = project.budgetAllocated ?? 0;
            const budgetSpent = project.budgetSpent ?? 0;
            const budgetPct = budgetAllocated > 0 ? Math.round((budgetSpent / budgetAllocated) * 100) : null;
            const days = daysRemaining(project.endDate);

            return (
              <tr
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className="cursor-pointer hover:bg-primary-50 dark:hover:bg-gray-700 transition-colors"
              >
                {/* Name */}
                <td className="px-3 py-3 max-w-[220px]">
                  <Link
                    to={`/project/${project.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 hover:underline truncate block focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                  >
                    {project.name}
                  </Link>
                </td>

                {/* Health Score */}
                <td className="px-3 py-3 whitespace-nowrap">
                  {project.healthScore != null ? (
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${project.healthScore >= 75 ? 'bg-green-500' : project.healthScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{project.healthScore}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-300">--</span>
                  )}
                </td>

                {/* Status */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <MetaPill variant={status.variant}>{status.label}</MetaPill>
                </td>

                {/* Priority */}
                <td className="hidden sm:table-cell px-3 py-3 whitespace-nowrap">
                  {project.priority ? (
                    <MetaPill variant={priorityVariant[project.priority] ?? 'default'} className="capitalize">
                      {project.priority}
                    </MetaPill>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>

                {/* Type */}
                <td className="hidden sm:table-cell px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {project.projectType ? (typeLabels[project.projectType] ?? project.projectType) : '—'}
                </td>

                {/* Progress */}
                <td className="px-3 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2 min-w-[80px]">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-600">
                      <div
                        className="h-full rounded-full bg-primary-500"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 w-8 text-right">{progress}%</span>
                  </div>
                </td>

                {/* Budget Allocated */}
                <td className="hidden md:table-cell px-3 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                  {budgetAllocated > 0 ? formatDollar(budgetAllocated) : <span className="text-gray-300">—</span>}
                </td>

                {/* Budget Spent % */}
                <td className="hidden md:table-cell px-3 py-3 whitespace-nowrap">
                  {budgetPct !== null ? (
                    <span className={`text-sm font-medium ${budgetPct > 90 ? 'text-red-600' : 'text-gray-600 dark:text-gray-400'}`}>
                      {budgetPct}%
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>

                {/* End Date */}
                <td className="hidden sm:table-cell px-3 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {formatDate(project.endDate)}
                </td>

                {/* Days Remaining */}
                <td className="px-3 py-3 whitespace-nowrap">
                  {days !== null ? (
                    <span className={`text-sm font-medium ${days < 0 ? 'text-red-600' : days <= 7 ? 'text-orange-500' : 'text-gray-600 dark:text-gray-400'}`}>
                      {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </td>

                {/* Start button */}
                <td className="px-3 py-3 whitespace-nowrap">
                  {project.status === 'planning' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startMutation.mutate(project.id);
                      }}
                      disabled={startMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                      title="Start Project"
                    >
                      <Play className="h-3 w-3" />
                      Start
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length > 10 && (
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700 text-center">
          <Link
            to="/projects"
            className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 hover:underline"
          >
            View all {sorted.length} projects
          </Link>
        </div>
      )}
    </div>
  );
}
