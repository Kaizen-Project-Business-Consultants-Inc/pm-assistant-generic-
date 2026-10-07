import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Folder } from 'lucide-react';
import { apiService } from '../../services/api';
import { ProjectGroupManager } from '../../components/projects/ProjectGroupManager';
import { useCanManageClients } from '../../hooks/useCanManageClients';
import { routeTo } from '../../routes';

interface Client {
  id: string;
  name: string;
  color: string;
}

const CLOSED_STATUSES = new Set(['completed', 'cancelled']);

/**
 * Clients (Oct 2026): who each project is for. A client is a project group; clients never sign in,
 * they get reports. From here: a client's risks & issues across its projects, and its client report.
 */
export function ClientsPage() {
  const canManageClients = useCanManageClients();
  const queryClient = useQueryClient();
  const [managerOpen, setManagerOpen] = useState(false);

  const { data: groupsData, isLoading } = useQuery<{ groups: Client[] }>({
    queryKey: ['project-groups'],
    queryFn: () => apiService.getProjectGroups(),
    staleTime: 120_000,
  });
  const clients = groupsData?.groups || [];

  // Same query as the Projects page, so the list is shared from cache
  const { data: projectsData } = useQuery({
    queryKey: ['pm-all-projects', false],
    queryFn: () => apiService.getProjects('portfolio', false),
    staleTime: 120_000,
  });
  const projects: any[] = projectsData?.data || projectsData?.projects || [];
  const liveCount = new Map<string, number>();
  for (const p of projects) {
    const cid = p.clientId || p.groupId;
    if (!cid || p.archivedAt || CLOSED_STATUSES.has(String(p.status || '').toLowerCase())) continue;
    liveCount.set(cid, (liveCount.get(cid) || 0) + 1);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Clients</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Who your projects are for. Clients don't sign in — they get reports.
          </p>
        </div>
        {canManageClients && (
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Folder className="w-4 h-4" />
            Manage clients
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />)}
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-12 text-center">
          <Building2 className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No clients yet.</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            A client is who a project is for. Add one with Manage clients, then pick it when creating a project.
          </p>
        </div>
      ) : (
        <ul className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-800">
          {clients.map(c => {
            const n = liveCount.get(c.id) || 0;
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} aria-hidden="true" />
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{c.name}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {n} live project{n !== 1 ? 's' : ''}
                </span>
                <span className="ml-auto flex items-center gap-4">
                  <Link to={routeTo.clientRaid(c.id)} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
                    Risks &amp; issues
                  </Link>
                  <Link to={routeTo.clientReport(c.id)} className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline">
                    Client report
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canManageClients && (
        <ProjectGroupManager
          isOpen={managerOpen}
          onClose={() => { setManagerOpen(false); queryClient.invalidateQueries({ queryKey: ['project-groups'] }); }}
        />
      )}
    </div>
  );
}
