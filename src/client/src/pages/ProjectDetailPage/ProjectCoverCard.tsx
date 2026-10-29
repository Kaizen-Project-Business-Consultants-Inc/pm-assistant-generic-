import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import { apiService } from '../../services/api';
import { formatCalendarDate } from '../../utils/dateUtils';
import { ConfirmModal } from '../../components/ui/ConfirmModal';

/** Account types that can't change data anywhere: covering lets them change THIS project only (server: constants/roleScopes.ts) */
const READ_ONLY_ROLES = new Set(['viewer', 'team_member', 'executive', 'finance_officer', 'tester', 'claude_sme']);

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const short = (ymd: string) => formatCalendarDate(ymd, { weekday: 'short', day: 'numeric', month: 'short' });
const apiMessage = (e: any, fallback: string) => e?.response?.data?.message || fallback;

interface OrgMember { id: string; fullName: string; email: string; role: string; isActive: boolean }

/**
 * Team tab: cover while the project's PM is away (start, end early), and handing the project to a new
 * Owner. Shown only to people who may do it (hidden, not disabled); everyone else sees the cover line.
 */
export function ProjectCoverCard({ projectId }: { projectId: string }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['project-cover', projectId], queryFn: () => apiService.getProjectCover(projectId), staleTime: 30_000 });
  const cover = data?.cover ?? null;
  const canManage = !!data?.canManage;
  const canHandOver = !!data?.canHandOver;

  const [formOpen, setFormOpen] = useState(false);
  const [coverUserId, setCoverUserId] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(plusDays(today(), 7));
  const [error, setError] = useState<string | null>(null);
  const [handOverTo, setHandOverTo] = useState('');
  const [confirmHandOver, setConfirmHandOver] = useState(false);

  const { data: orgData } = useQuery({
    queryKey: ['org-members'],
    queryFn: () => apiService.getOrgMembers(),
    enabled: formOpen || canHandOver,
    staleTime: 60_000,
  });
  const { data: membersData } = useQuery({ queryKey: ['project-members', projectId], queryFn: () => apiService.getProjectMembers(projectId), enabled: formOpen || canHandOver });
  const people: OrgMember[] = (orgData?.members ?? []).filter((m: OrgMember) => m.isActive);
  const ownerIds = new Set<string>((membersData?.members ?? []).filter((m: any) => m.role === 'owner').map((m: any) => m.userId));
  const ownerNames = (membersData?.members ?? []).filter((m: any) => m.role === 'owner').map((m: any) => m.userName).join(' and ');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['project-cover', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['project-members', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['my-project-role', projectId] });
  };

  const startMutation = useMutation({
    mutationFn: () => apiService.startProjectCover(projectId, { coverUserId, startDate: from, endDate: to }),
    onSuccess: () => { setFormOpen(false); setCoverUserId(''); setError(null); refresh(); },
    onError: (e) => setError(apiMessage(e, 'Could not start cover.')),
  });
  const endMutation = useMutation({
    mutationFn: () => apiService.endProjectCover(projectId),
    onSuccess: refresh,
    onError: (e) => setError(apiMessage(e, 'Could not end cover.')),
  });
  const handOverMutation = useMutation({
    mutationFn: () => apiService.reassignProjectOwner(projectId, handOverTo),
    onSuccess: () => { setConfirmHandOver(false); setHandOverTo(''); setError(null); refresh(); },
    onError: (e) => { setConfirmHandOver(false); setError(apiMessage(e, 'Could not hand over the project.')); },
  });

  if (!cover && !canManage && !canHandOver) return null;

  const picked = people.find(p => p.id === coverUserId);
  const pickedReadOnly = !!picked && READ_ONLY_ROLES.has(picked.role);
  const firstName = picked ? (picked.fullName || picked.email).split(' ')[0] : '';
  const newOwner = people.find(p => p.id === handOverTo);
  const datesOk = !!from && !!to && to >= from;

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4" aria-labelledby={`${uid}-cover`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary-500" aria-hidden="true" />
          <h3 id={`${uid}-cover`} className="text-base font-semibold text-gray-900 dark:text-white">Cover while the PM is away</h3>
        </div>
        {canManage && cover && (
          <button type="button" onClick={() => endMutation.mutate()} disabled={endMutation.isPending}
            className="px-2.5 py-1 text-xs font-medium text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
            {endMutation.isPending ? 'Ending…' : 'End cover now'}
          </button>
        )}
        {canManage && !cover && !formOpen && (
          <button type="button" onClick={() => setFormOpen(true)}
            className="px-2.5 py-1 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-md">
            Start cover
          </button>
        )}
      </div>

      {cover ? (
        <div className="space-y-1">
          <p className="text-sm text-gray-800 dark:text-gray-100">
            <span className="font-medium">{cover.coverUserName}</span> covers from {short(cover.startDate)} to {short(cover.endDate)}
            {!cover.active && <span className="ml-2 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">Starts later</span>}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            They can edit this project only, and can&apos;t make or remove Owners. Every change they make is recorded as covering for the Owner. Access ends by itself after {short(cover.endDate)}.
          </p>
        </div>
      ) : (
        !formOpen && <p className="text-xs text-gray-500 dark:text-gray-400">Nobody is covering. Only the Owner can edit as Owner.</p>
      )}

      {canManage && !cover && formOpen && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); startMutation.mutate(); }}>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor={`${uid}-who`} className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Who covers?</label>
              <select id={`${uid}-who`} value={coverUserId} onChange={(e) => setCoverUserId(e.target.value)} required
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                <option value="">Choose a person</option>
                {people.filter(p => !ownerIds.has(p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.fullName || p.email} ({p.role.replace(/_/g, ' ')})</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-from`} className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">From</label>
              <input id={`${uid}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} required
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            </div>
            <div>
              <label htmlFor={`${uid}-to`} className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">To</label>
              <input id={`${uid}-to`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required
                className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100" />
            </div>
          </div>
          {pickedReadOnly && datesOk && (
            <p role="note" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm px-3 py-2">
              <span className="font-semibold">{firstName} is a {picked!.role.replace(/_/g, ' ')}.</span> Covering lets {firstName} edit <span className="font-semibold">this project only</span>, from {short(from)} to {short(to)}. {firstName}&apos;s access to other projects does not change. Up to 90 days.
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="submit" disabled={!coverUserId || !datesOk || startMutation.isPending}
              className="px-3 py-1.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50">
              {startMutation.isPending ? 'Starting…' : pickedReadOnly ? `Let ${firstName} edit until ${short(to)}` : 'Start cover'}
            </button>
            <button type="button" onClick={() => { setFormOpen(false); setError(null); }}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
              Cancel
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">The Owner and the person covering get an email now. The Owner gets another when cover ends.</p>
        </form>
      )}

      {canHandOver && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-4 space-y-2">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Project Owner{ownerNames ? `: ${ownerNames}` : ''}</h4>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor={`${uid}-owner`} className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">New Owner</label>
              <select id={`${uid}-owner`} value={handOverTo} onChange={(e) => setHandOverTo(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                <option value="">Choose a person</option>
                {people.filter(p => !ownerIds.has(p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.fullName || p.email}</option>
                ))}
              </select>
            </div>
            <button type="button" disabled={!handOverTo} onClick={() => setConfirmHandOver(true)}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              Make Owner
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">A project always has one Owner. The current Owner becomes a Manager.</p>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {confirmHandOver && newOwner && (
        <ConfirmModal
          title="Hand the project to a new Owner?"
          message={`${newOwner.fullName || newOwner.email} becomes the Owner. ${ownerNames || 'The current Owner'} becomes a Manager. You can hand it back the same way.`}
          confirmLabel="Make Owner"
          variant="warning"
          isPending={handOverMutation.isPending}
          onConfirm={() => handOverMutation.mutate()}
          onCancel={() => setConfirmHandOver(false)}
        />
      )}
    </section>
  );
}

/** One line under the project title: who covers, or that you are covering (nothing when there is no cover today) */
export function ProjectCoverBanner({ projectId, acting, coverUntil }: { projectId: string; acting: boolean; coverUntil: string | null }) {
  const { data } = useQuery({ queryKey: ['project-cover', projectId], queryFn: () => apiService.getProjectCover(projectId), staleTime: 30_000 });
  const cover = data?.cover;
  if (!cover?.active) return null;
  const until = short(acting && coverUntil ? coverUntil : cover.endDate);
  return acting ? (
    <div role="status" className="rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-900 dark:text-primary-100 text-sm px-3 py-2">
      <span className="font-semibold">You are covering this project</span> until {until}. You can edit it. You can&apos;t make or remove Owners.
    </div>
  ) : (
    <div role="status" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-sm px-3 py-2">
      <span className="font-semibold">Covered by {cover.coverUserName}</span> until {until}. The Owner is away.
    </div>
  );
}
