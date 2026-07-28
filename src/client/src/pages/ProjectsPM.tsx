import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, FolderKanban, Archive, LayoutGrid, List, ChevronUp, ChevronDown } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { FilterBarPM } from '../components/pm/FilterBarPM';
import { ProjectCardPM } from '../components/pm/ProjectCardPM';
import { TemplatePicker } from '../components/templates/TemplatePicker';
import { getViewPref, setViewPref } from '../hooks/useViewPreferences';
import type { ProjectSummaryPM } from '../types/pm';

const VIEW_MODE_KEY = 'pm-projects-view-mode';

type SortKey = 'name' | 'status' | 'healthScore' | 'methodology' | 'progress' | 'endDate';
type SortDir = 'asc' | 'desc';

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
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  // Auto-open TemplatePicker when navigating with ?new=1
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setTemplatePickerOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [viewMode, setViewMode] = useState<'card' | 'table'>(() => {
    const serverPref = getViewPref('projectsViewMode');
    if (serverPref) return serverPref;
    try { return (localStorage.getItem(VIEW_MODE_KEY) as 'card' | 'table') || 'card'; } catch { return 'card'; }
  });
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const toggleViewMode = useCallback((mode: 'card' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
    setViewPref('projectsViewMode', mode);
  }, []);

  const handleSort = useCallback((key: SortKey) => {
    setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
    setSortKey(key);
  }, [sortKey]);

  // Debounce search input (200ms) for large project lists
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

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

  // Apply filters (memoized with debounced search)
  const filtered = useMemo(() =>
    projects.filter((p) => {
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase();
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
    }),
    [projects, debouncedSearch, healthFilter, statusFilter]
  );

  const hasActiveFilters = search.trim() !== '' || healthFilter !== 'all' || statusFilter !== 'all';

  // Sort for table mode
  const sorted = useMemo(() => {
    const list = [...filtered].sort((a, b) => {
      // Favourites always first
      const af = favouriteSet.has(a.id) ? 1 : 0;
      const bf = favouriteSet.has(b.id) ? 1 : 0;
      if (af !== bf) return bf - af;
      // Then by sortKey
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'healthScore': cmp = a.healthScore - b.healthScore; break;
        case 'methodology': cmp = (a.methodology || '').localeCompare(b.methodology || ''); break;
        case 'progress': cmp = a.progress - b.progress; break;
        case 'endDate': cmp = (a.endDate || '').localeCompare(b.endDate || ''); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir, favouriteSet]);

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
                  <> · <span className="text-primary-600 dark:text-primary-400">{ownedCount} owned by you</span></>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
            <button
              onClick={() => toggleViewMode('card')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'card' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              aria-label="Card view"
              title="Card view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleViewMode('table')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
              aria-label="Table view"
              title="Table view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors shadow-sm"
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
              className="mt-3 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map((project) => (
            <ProjectCardPM key={project.id} project={project} isFavourite={favouriteSet.has(project.id)} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {([
                  { key: 'name' as SortKey, label: 'Project' },
                  { key: 'status' as SortKey, label: 'Status' },
                  { key: 'healthScore' as SortKey, label: 'Health' },
                  { key: 'progress' as SortKey, label: 'Progress' },
                  { key: 'methodology' as SortKey, label: 'Methodology' },
                  { key: 'endDate' as SortKey, label: 'End Date' },
                ]).map(col => (
                  <th
                    key={col.key}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    onClick={() => handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortKey === col.key && (
                        sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
              {sorted.map((p) => {
                const healthLabel = p.healthScore >= 75 ? 'Healthy' : p.healthScore >= 50 ? 'Watch' : 'At Risk';
                const healthColor = p.healthScore >= 75 ? 'text-green-600 dark:text-green-400' : p.healthScore >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';
                const statusDisplay = (p.status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                return (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/project/${p.id}`} className="text-sm font-medium text-gray-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                        {p.name}
                      </Link>
                      {p.client && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{p.client}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 capitalize">{statusDisplay}</td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-medium ${healthColor}`}>{healthLabel}</span>
                      <span className="text-xs text-gray-400 ml-1">({p.healthScore}%)</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full" style={{ width: `${Math.min(p.progress, 100)}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{Math.round(p.progress)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 capitalize">{p.methodology || '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                      {p.endDate ? new Date(p.endDate).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Template picker modal */}
      <TemplatePicker isOpen={templatePickerOpen} onClose={() => setTemplatePickerOpen(false)} />
    </div>
  );
}
