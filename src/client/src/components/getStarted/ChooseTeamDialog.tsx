import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AccessibleModal } from '../ui/AccessibleModal';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * Get started step 3 (U48, approved mock 2026-10-19): right after creating the project, tick who's
 * on it from the company's people — Owner, Manager or Viewer each — or skip (the project's Team tab
 * does the same later). One company, one list of people: no team to set up first.
 */
interface OrgMember { id: string; email: string; fullName: string; role: string; isActive: boolean }
interface Choice { on: boolean; role: 'owner' | 'manager' | 'viewer' }

const PROJECT_ROLES = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'viewer', label: 'Viewer' },
] as const;

/** quietIfNobody: opened by itself after creating a project — stays closed when nobody else is in the company */
export function ChooseTeamDialog({ projectId, projectName, isOpen, onClose, quietIfNobody = false }: {
  projectId: string; projectName: string; isOpen: boolean; onClose: () => void; quietIfNobody?: boolean;
}) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['org-members'],
    queryFn: async () => await apiService.getOrgMembers() as { members: OrgMember[] },
    enabled: isOpen,
  });
  const people = useMemo(() => (data?.members ?? []).filter(m => m.isActive && m.id !== user?.id), [data, user?.id]);
  // as in the mock: company Viewers start unticked (as Viewer); everyone else ticked, as Manager
  const choiceFor = (m: OrgMember): Choice => choices[m.id] ?? (m.role === 'viewer' ? { on: false, role: 'viewer' } : { on: true, role: 'manager' });
  const picked = people.filter(m => choiceFor(m).on);
  const setChoice = (m: OrgMember, patch: Partial<Choice>) => setChoices(c => ({ ...c, [m.id]: { ...choiceFor(m), ...patch } }));

  const nobody = !!data && people.length === 0;
  useEffect(() => { if (isOpen && quietIfNobody && nobody) onClose(); }, [isOpen, quietIfNobody, nobody, onClose]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving || picked.length === 0) return;
    setSaving(true);
    setError(null);
    const failed: string[] = [];
    const added: string[] = [];
    for (const m of picked) {
      try {
        // eslint-disable-next-line no-await-in-loop -- one person per request (the same route as the Team tab)
        await apiService.addProjectMember(projectId, { userId: m.id, userName: m.fullName, email: m.email, role: choiceFor(m).role });
        added.push(m.id);
      } catch (err) {
        failed.push(`${m.fullName || m.email}: ${getApiErrorMessage(err, 'could not be added')}`);
      }
    }
    setSaving(false);
    void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['get-started'] });
    if (failed.length) {
      // the ones added are unticked, so trying again doesn't email them a second time
      setChoices(c => ({ ...c, ...Object.fromEntries(added.map(id => [id, { ...(c[id] ?? { role: 'manager' as const }), on: false }])) }));
      setError(failed.join(' · '));
      return;
    }
    onClose();
  }

  return (
    <AccessibleModal isOpen={isOpen && !!data && !(quietIfNobody && nobody)} onClose={onClose} labelledBy="choose-team-title" busy={saving}
      className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-full max-w-xl mx-4">
      <form onSubmit={add} className="space-y-4">
        <h2 id="choose-team-title" className="text-lg font-semibold text-gray-900 dark:text-white">Who&apos;s on {projectName}?</h2>
        {people.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">Nobody else is in your company yet. Invite people from the Get started card, then add them here or on the project&apos;s Team tab.</p>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {people.map(m => {
              const c = choiceFor(m);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                  <label className="flex items-center gap-2 flex-1 min-w-0 text-sm text-gray-900 dark:text-white">
                    <input type="checkbox" checked={c.on} onChange={e => setChoice(m, { on: e.target.checked })} />
                    <span className="truncate">{m.fullName || m.email}</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{m.email}</span>
                  </label>
                  <label className="text-xs text-gray-600 dark:text-gray-300">
                    <span className="sr-only">Role on this project for {m.fullName || m.email}</span>
                    <select value={c.role} disabled={!c.on} onChange={e => setChoice(m, { role: e.target.value as Choice['role'] })} className="input py-1">
                      {PROJECT_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <button type="button" onClick={onClose} className="text-sm text-gray-600 dark:text-gray-300 hover:underline">Skip for now</button>
          {people.length > 0 && (
            <button type="submit" disabled={saving || picked.length === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Adding…' : `Add ${picked.length} ${picked.length === 1 ? 'person' : 'people'}`}
            </button>
          )}
        </div>
      </form>
    </AccessibleModal>
  );
}
