import { Link } from 'react-router-dom';
import { Calendar, ExternalLink, Star, Archive, ArchiveRestore } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import type { ProjectSummaryPM } from '../../types/pm';

interface ProjectCardPMProps {
  project: ProjectSummaryPM;
  isFavourite?: boolean;
}

function healthLabel(score: number): string {
  if (score >= 75) return 'Healthy';
  if (score >= 50) return 'Watch';
  return 'At Risk';
}

function healthBorderColor(score: number): string {
  if (score >= 75) return 'border-l-green-500';
  if (score >= 50) return 'border-l-amber-500';
  return 'border-l-red-500';
}

function healthDotColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function healthPillColor(score: number): string {
  if (score >= 75)
    return 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400';
  if (score >= 50)
    return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  return 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400';
}

function progressBarColor(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function statusChipColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'active') return 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
  if (s === 'planning') return 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
  if (s === 'on-hold' || s === 'on hold') return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
  if (s === 'completed') return 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400';
  return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
}

function priorityChipColor(priority: string): string {
  const p = priority.toLowerCase();
  if (p === 'critical') return 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400';
  if (p === 'high') return 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400';
  if (p === 'medium') return 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
  return 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function ProjectCardPM({ project, isFavourite = false }: ProjectCardPMProps) {
  const {
    id,
    name,
    client,
    status,
    priority,
    methodology,
    healthScore,
    progress,
    endDate,
    daysLeft,
  } = project;

  const isArchived = !!project.archivedAt;

  const queryClient = useQueryClient();
  const toggleFav = useMutation({
    mutationFn: () => isFavourite ? apiService.unfavouriteProject(id) : apiService.favouriteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pm-all-projects'] });
      queryClient.invalidateQueries({ queryKey: ['favourite-projects'] });
    },
  });
  const toggleArchive = useMutation({
    mutationFn: () => isArchived ? apiService.unarchiveProject(id) : apiService.archiveProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pm-all-projects'] });
    },
  });

  const label = healthLabel(healthScore);
  const pct = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className={`
        relative rounded-xl border border-gray-200 dark:border-gray-700 border-l-4
        ${healthBorderColor(healthScore)}
        bg-white dark:bg-gray-800 p-4 flex flex-col gap-3
        transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg
      `}
    >
      {/* Top: name + star + health pill */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleFav.mutate()}
              className="flex-shrink-0 p-0.5 -ml-0.5 hover:scale-110 transition-transform"
              aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            >
              <Star className={`w-3.5 h-3.5 ${isFavourite ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-gray-600 hover:text-amber-400'}`} />
            </button>
            <Link
              to={`/project/${id}`}
              className="text-sm font-semibold text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-1"
            >
              {name}
            </Link>
          </div>
          {client && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate pl-5">{client}</p>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium flex-shrink-0 ${healthPillColor(healthScore)}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${healthDotColor(healthScore)}`} />
          {label}
        </span>
      </div>

      {/* Chips row */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusChipColor(status)}`}>
          {status}
        </span>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${priorityChipColor(priority)}`}>
          {priority}
        </span>
        {methodology && methodology !== 'waterfall' && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
            {methodology === 'agile' ? 'Agile' : 'Hybrid'}
          </span>
        )}
        {isArchived && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
            Archived
          </span>
        )}
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between items-center mb-1">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Progress</span>
          <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{pct}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${progressBarColor(healthScore)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {formatDate(endDate)}
        </span>
        {daysLeft !== undefined && (
          <span className={daysLeft < 0 ? 'text-red-500 font-medium' : daysLeft <= 7 ? 'text-amber-500 font-medium' : ''}>
            {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
          </span>
        )}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-700">
        <Link
          to={`/project/${id}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-medium transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View Project
        </Link>
        <button
          onClick={() => toggleArchive.mutate()}
          title={isArchived ? 'Unarchive project' : 'Archive project'}
          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}
