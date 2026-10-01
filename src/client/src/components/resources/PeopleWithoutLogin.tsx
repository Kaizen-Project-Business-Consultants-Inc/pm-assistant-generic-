import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { PlaceholderEmailBadge } from './ResourceBadges';

/**
 * The project Team list's second half: people doing work on this project's tasks who aren't
 * team members with a login yet (e.g. Parth on task 4). The PM can add a real email in place of
 * a placeholder, or invite them. Generic roles never appear here.
 */
export function PeopleWithoutLogin({ projectId, memberUserIds, canEdit }: {
  projectId: string;
  memberUserIds: Set<string>;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ id: string; email: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['people-on-project', projectId],
    queryFn: () => apiService.getPeopleOnProject(projectId),
  });
  const people = (data?.people ?? []).filter(p => !p.userId || !memberUserIds.has(p.userId));

  const saveEmail = useMutation({
    mutationFn: (e: { id: string; email: string }) => apiService.updateResource(e.id, { email: e.email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['people-on-project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      setEditing(null);
      setNotice({ ok: true, text: 'Email saved. Use Invite when you want them to log in.' });
    },
    onError: (err: any) => setNotice({ ok: false, text: err?.response?.data?.message || 'The email could not be saved.' }),
  });
  const invite = useMutation({
    mutationFn: (id: string) => apiService.inviteResource(id),
    onSuccess: (r) => setNotice({ ok: true, text: r.message }),
    onError: (err: any) => setNotice({ ok: false, text: err?.response?.data?.message || 'The invite could not be sent.' }),
  });

  if (people.length === 0) return null;

  return (
    <div className="mt-4 border-t border-gray-200 dark:border-gray-700 pt-3">
      <h4 className="text-xs font-bold tracking-wide text-gray-600 dark:text-gray-400 uppercase mb-2">Assigned to tasks · no login yet</h4>
      {notice && (
        <p role="status" className={`mb-2 text-xs ${notice.ok ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{notice.text}</p>
      )}
      <ul className="space-y-1">
        {people.map(p => (
          <li key={p.resourceId} className={`flex flex-wrap items-center justify-between gap-2 py-2 px-3 rounded-lg ${p.placeholderEmail ? 'bg-amber-50/70 dark:bg-amber-900/10' : ''}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                <span>{p.role ? `${p.role} · ` : ''}{p.taskCount} task{p.taskCount === 1 ? '' : 's'}</span>
                {editing?.id === p.resourceId ? null : <span>· {p.email}</span>}
                {p.placeholderEmail && editing?.id !== p.resourceId && <PlaceholderEmailBadge />}
              </div>
            </div>
            {canEdit && (editing?.id === p.resourceId ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); saveEmail.mutate({ id: p.resourceId, email: editing.email.trim() }); }}
              >
                <label htmlFor={`email-${p.resourceId}`} className="sr-only">Real email for {p.name}</label>
                <input
                  id={`email-${p.resourceId}`}
                  type="email"
                  required
                  autoFocus
                  value={editing.email}
                  onChange={(e) => setEditing({ id: p.resourceId, email: e.target.value })}
                  placeholder="name@company.com"
                  className="text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-md px-2.5 py-1.5 w-56 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <button type="submit" disabled={saveEmail.isPending} className="text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-md px-3 py-1.5 disabled:opacity-50">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">Cancel</button>
              </form>
            ) : p.placeholderEmail ? (
              <button onClick={() => { setNotice(null); setEditing({ id: p.resourceId, email: '' }); }} className="text-xs font-semibold text-primary-700 dark:text-primary-300 underline hover:text-primary-800">
                Add real email
              </button>
            ) : (
              <button
                onClick={() => { setNotice(null); invite.mutate(p.resourceId); }}
                disabled={invite.isPending}
                className="px-2.5 py-1 text-xs font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30 border border-primary-600 dark:border-primary-400 rounded-md hover:bg-primary-100 disabled:opacity-50"
                title={`Email ${p.email} an invite to log in`}
              >
                Invite
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
