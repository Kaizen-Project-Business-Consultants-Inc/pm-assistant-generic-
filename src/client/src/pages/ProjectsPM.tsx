import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, FolderKanban, Archive } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { FilterBarPM } from '../components/pm/FilterBarPM';
import { ProjectCardPM } from '../components/pm/ProjectCardPM';
import { TemplatePicker } from '../components/templates/TemplatePicker';
import type { ProjectSummaryPM } from '../types/pm';

function healthBand(score: number): 'healthy' | 'watch' | 'at-risk' {
  if (score >= 75) return 'healthy';
  if (score >= 50) return 'watch';
  return 'at-risk';
}

function normalizeStatus(status: string): string {
  return (status || '').toLowerCase().replace(/\s+/g, '-');
}

export function ProjectsPM() {
  const { user } = useAuthStore();

  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const { data: allProjectsData, isLoading } = useQuery({
    queryKey: ['pm-all-projects', showArchived],
    queryFn: () => apiService.getProjects('portfolio', showArchived),
    staleTime: 120_000,
  });

  const { data: predictionsData } = useQuery({
    queryKey: ['pm-predictions'],
    queryFn: () => apiService.getDashboardPredictions(),
    staleTime: 120_000,
  });

  // Merge health scores into projects
  const rawProjects: any[] = allProjectsData?.data || allProjectsData?.projects || [];
  const healthMap = new Map<string, number>();
  const pred = predictionsData?.data || predictionsData;
  if (pred?.projectHealthScores) {
    for (const h of pred.projectHealthScores) {
      healthMap.set(h.projectId, h.healthScore);
    }
  }

  const projects: ProjectSummaryPM[] = rawProjects.map((p: any) => ({
    id: p.id,
    name: p.name || 'Unnamed Project',
    client: p.clientName || p.client || '',
    status: p.status || '',
    priority: p.priority || '',
    projectType: p.projectType || p.type || '',
    methodology: p.methodology || 'waterfall',
    healthScore: healthMap.get(p.id) ?? p.healthScore ?? 0,
    progress: p.progressPercentage ?? p.progress ?? 0,
    budgetAllocated: p.budgetAllocated ?? p.budget ?? 0,
    budgetSpent: p.budgetSpent ?? p.spent ?? 0,
    endDate: p.endDate || p.plannedEndDate || '',
    archivedAt: p.archivedAt ?? undefined,
    daysLeft: p.daysLeft ?? (() => {
      if (!p.endDate && !p.plannedEndDate) return undefined;
      try {
        return Math.ceil(
          (new Date(p.endDate || p.plannedEndDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
      } catch {
        return undefined;
      }
    })(),
  }));

  // Count projects owned by current user
  const ownedCount = rawProjects.filter(
    (p: any) =>
      p.projectManagerId === user?.id ||
      p.ownerId === user?.id ||
      p.createdBy === user?.id
  ).length;

  // Build favourite set from API response
  const favouriteSet = new Set<string>();
  for (const p of rawProjects) {
    if ((p as any).isFavourite) favouriteSet.add(p.id);
  }

  // Apply filters
  const filtered = projects.filter((p) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.client || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    if (healthFilter !== 'all' && healthBand(p.healthScore) !== healthFilter) {
      return false;
    }
    if (statusFilter !== 'all') {
      const ns = normalizeStatus(p.status);
      if (ns !== statusFilter) return false;
    }
    return true;
  });

  const hasActiveFilters = search.trim() !== '' || healthFilter !== 'all' || statusFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setHealthFilter('all');
    setStatusFilter('all');
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Projects</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {isLoading ? (
              'Loading projects…'
            ) : (
              <>
                {projects.length} project{projects.length !== 1 ? 's' : ''}
                {ownedCount > 0 && (
                  <> · <span className="text-teal-600 dark:text-teal-400">{ownedCount} owned by you</span></>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${showArchived ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400' : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            <Archive className="w-4 h-4" />
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button
            type="button"
            onClick={() => setTemplatePickerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <FilterBarPM
        search={search}
        onSearchChange={setSearch}
        healthFilter={healthFilter}
        onHealthChange={setHealthFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Project grid or loading */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-52 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
          <FolderKanban className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            {hasActiveFilters ? 'No projects match these filters.' : 'No projects yet.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 text-sm text-teal-600 dark:text-teal-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...filtered].sort((a, b) => {
            const af = favouriteSet.has(a.id) ? 1 : 0;
            const bf = favouriteSet.has(b.id) ? 1 : 0;
            return bf - af;
          }).map((project) => (
            <ProjectCardPM key={project.id} project={project} isFavourite={favouriteSet.has(project.id)} />
          ))}
        </div>
      )}

      {/* Template picker modal */}
      <TemplatePicker isOpen={templatePickerOpen} onClose={() => setTemplatePickerOpen(false)} />
    </div>
  );
}
