import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ArchiveRestore } from 'lucide-react';
import { apiService } from '../../services/api';
import { refreshProjectLists } from '../../utils/projectListCache';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { formatCalendarDate, formatMomentDay } from '../../utils/dateUtils';
import { PROJECT_TYPE_LABELS } from '../../constants/projectTypes';
import { SectionCard, TH, TD } from '../ui/SectionCard';
import { MetaPill } from '../ui/MetaPill';
import type { ProjectSummaryPM } from '../../types/pm';
import { useClientWord } from '../../hooks/useClientWord';

const PAGE = 25;

/**
 * Archived projects as compact rows (UAT U1, Batch F): their own section under the active list,
 * folded until opened, 25 to a page — 48 archived projects used to fill 16 screens of cards.
 * Restore shows only where the server allows it — someone who may change data and manages that
 * project (its Manager/Owner, or admin/PMO: the list's canEdit) — hide, don't disable.
 */
export function ArchivedProjectsList({ projects, canRestore }: { projects: ProjectSummaryPM[]; canRestore: boolean }) {
  const word = useClientWord();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: (id: string) => apiService.unarchiveProject(id),
    onSuccess: () => refreshProjectLists(queryClient),
  });
  if (projects.length === 0) return null;

  const pages = Math.ceil(projects.length / PAGE);
  const current = Math.min(page, pages - 1);
  const rows = projects.slice(current * PAGE, current * PAGE + PAGE);

  return (
    <SectionCard
      tone="gray"
      flush={open}
      title={
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded hover:text-primary-700 dark:hover:text-primary-300">
          <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
          Archived ({projects.length})
        </button>
      }
      subtitle="Read-only. Restore brings a project back to the active list."
    >
      {open && (
        <>
          <table className="min-w-full">
            <thead>
              <tr>
                <th scope="col" className={TH}>Project</th>
                <th scope="col" className={TH}>{word.one}</th>
                <th scope="col" className={TH}>Type</th>
                <th scope="col" className={TH}>Archived on</th>
                <th scope="col" className={TH}>End date</th>
                <th scope="col" className={TH}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className={TD}>
                    <Link to={`/project/${p.id}`} className="font-semibold text-gray-900 dark:text-white hover:text-primary-700 dark:hover:text-primary-300">{p.name}</Link>
                    {p.code && <div className="text-xs text-gray-600 dark:text-gray-400">{p.code}</div>}
                  </td>
                  <td className={TD}>{p.client || '—'}</td>
                  <td className={TD}>{p.projectType ? <MetaPill>{PROJECT_TYPE_LABELS[p.projectType] ?? p.projectType}</MetaPill> : '—'}</td>
                  <td className={`${TD} whitespace-nowrap`}>{p.archivedAt ? formatMomentDay(p.archivedAt) : '—'}</td>
                  <td className={`${TD} whitespace-nowrap`}>{p.endDate ? formatCalendarDate(p.endDate) : '—'}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <div className="flex items-center gap-3">
                      <Link to={`/project/${p.id}`} className="text-sm font-semibold text-primary-700 dark:text-primary-300 hover:underline">Open{' '}<span className="sr-only">{p.name}</span></Link>
                      {canRestore && p.canEdit && (
                        <button
                          type="button"
                          onClick={() => restore.mutate(p.id)}
                          disabled={restore.isPending && restore.variables === p.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-600 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                          Restore{' '}<span className="sr-only">{p.name}</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {restore.isError && <p role="alert" className="px-4 py-2 text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(restore.error, 'That project could not be restored.')}</p>}
          {pages > 1 && (
            <nav aria-label="Archived projects pages" className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300">
              <span>{current * PAGE + 1}–{current * PAGE + rows.length} of {projects.length}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} className="rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1 font-semibold disabled:opacity-40">Previous</button>
                <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1 font-semibold disabled:opacity-40">Next</button>
              </span>
            </nav>
          )}
        </>
      )}
    </SectionCard>
  );
}
