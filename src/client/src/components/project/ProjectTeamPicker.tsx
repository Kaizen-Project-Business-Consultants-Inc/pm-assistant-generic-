import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import type { ProjectTeamPool, TeamPerson } from '../../services/api';
import { useProjectRole } from '../../hooks/useProjectRole';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { MetaPill } from '../ui/MetaPill';

/**
 * A project's team (U8): picked from its client's resource pool and My resources — never another
 * client's people. Someone on the team who can sign in sees this project (and only the projects
 * whose team they're on). The project's Manager/Owner changes it; everyone else reads it.
 */
export function ProjectTeamPicker({ projectId }: { projectId: string }) {
  const { canEdit } = useProjectRole(projectId);
  const queryClient = useQueryClient();
  const key = ['project-team-pool', projectId];
  const q = useQuery({ queryKey: key, queryFn: () => apiService.getProjectTeamPool(projectId) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const change = async (id: string, run: () => Promise<ProjectTeamPool>) => {
    setBusy(id); setError('');
    try {
      queryClient.setQueryData(key, await run());
      void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    } catch (err) {
      setError(getApiErrorMessage(err, 'The team could not be changed.'));
    } finally { setBusy(null); }
  };

  if (!q.data) return null;
  const { client, team, clientPool, mine } = q.data;
  const signIn = (p: TeamPerson) => (p.isGeneric ? <MetaPill variant="muted">Placeholder</MetaPill>
    : p.canSignIn ? <MetaPill variant="success">Can sign in</MetaPill> : <MetaPill>No login</MetaPill>);

  const addList = (title: string, people: TeamPerson[], stripe: string, note: string) => (
    <section className={`card-stripe ${stripe} rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 shadow-sm`}>
      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
      {people.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">Nobody else to add.</p> : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {people.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white truncate">{p.name}</span>
                <span className="block text-xs text-gray-600 dark:text-gray-300">{p.role || '—'}</span>
              </span>
              <button type="button" disabled={busy === p.id} onClick={() => change(p.id, () => apiService.addToProjectTeam(projectId, p.id))}
                aria-label={`Add ${p.name} to the team`}
                className="min-h-[36px] px-3 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold disabled:opacity-60">+ Add</button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{note}</p>
    </section>
  );

  return (
    <div className="flex flex-wrap gap-4 items-start mb-6">
      <section className="card-stripe stripe-teal flex-[999_1_520px] min-w-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-x-auto">
        <div className="p-4 pb-2">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Project team</h2>
          <p className="text-xs text-gray-600 dark:text-gray-300">Anyone here who can sign in sees this project — and only the projects whose team they're on.</p>
        </div>
        {team.length === 0 ? <p className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-300">Nobody on the team yet{canEdit ? ' — add people from the lists' : ''}.</p> : (
          <table className="w-full text-sm min-w-[480px]">
            <caption className="sr-only">Project team</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
              <tr><th className="text-left px-4 py-2">Name</th><th className="text-left px-2 py-2">From</th><th className="text-left px-2 py-2">Role</th><th className="text-left px-2 py-2">Sign-in</th>{canEdit && <th className="px-4 py-2"><span className="sr-only">Remove</span></th>}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {team.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-semibold text-gray-900 dark:text-white">{p.name}</td>
                  <td className="px-2 py-2">{p.clientId ? <MetaPill variant="warning">{client.name ?? 'Client'}</MetaPill> : <MetaPill variant="info">My resources</MetaPill>}</td>
                  <td className="px-2 py-2 text-gray-700 dark:text-gray-200">{p.roleOnProject || p.role || '—'}</td>
                  <td className="px-2 py-2">{signIn(p)}</td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      <button type="button" disabled={busy === p.id} onClick={() => change(p.id, () => apiService.removeFromProjectTeam(projectId, p.id))}
                        aria-label={`Remove ${p.name} from the team`}
                        className="min-h-[36px] px-3 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-60">Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <p role="alert" className="px-4 pb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>
      {canEdit && (
        <div className="flex-[1_1_300px] min-w-0 flex flex-col gap-4">
          {client.id && addList(`Add from ${client.name}'s pool`, clientPool, 'stripe-amber', `Only ${client.name}'s people are listed — other clients' never appear here.`)}
          {addList('Add from My resources', mine, 'stripe-blue', 'Your own people — usable on every client\'s projects.')}
        </div>
      )}
    </div>
  );
}
