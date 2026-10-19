import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { apiService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { ROUTES, routeTo } from '../../routes';
import { InvitePeopleDialog } from './InvitePeopleDialog';
import { ProfileChecklist } from './ProfileChecklist';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';

/**
 * First login goes to work, not to a form (U42/U47/U48, approved mock 2026-10-19). The dashboard
 * shows four steps in the order the user chose — invite your people (Team-plan owners), create
 * your first project, choose who's on it, build the plan — beside "Finish your profile". It
 * replaced the setup pages and the welcome pop-up. Shown until setup is finished (all done, or
 * hidden): the user's onboardingCompleted (set on the server when finished). Invited people never see it (their setup is done).
 *
 * Step states: done (ticked), next (highlighted, its button), later (waits for the project).
 */
type StepState = 'done' | 'next' | 'later';
interface Step { key: string; title: string; hint: string; state: StepState; action?: { label: string; run: () => void } }

const isShownTo = (u: ReturnType<typeof useAuthStore.getState>['user']) =>
  !!u && u.onboardingCompleted === false && u.role !== 'viewer' && !u.isGuest;

export function GetStartedCard() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shown = isShownTo(user);
  const [inviting, setInviting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // fresh every time the dashboard opens: creating a project or adding tasks elsewhere ticks a step
  const { data: s } = useQuery({
    queryKey: ['get-started'], queryFn: () => apiService.getGetStarted(), enabled: shown, staleTime: 0, refetchOnMount: 'always',
  });

  if (!shown || !s) return null;

  const project = s.firstProjectId;
  const raw: Array<Omit<Step, 'state'> & { done: boolean; needsProject?: boolean }> = [
    ...(s.canInvite ? [{
      key: 'invite', title: 'Invite your people', hint: 'Viewers are free. Everyone else uses a paid seat.', done: s.invited,
      action: { label: 'Invite', run: () => setInviting(true) },
    }] : []),
    {
      key: 'project', title: 'Create your first project', hint: 'Client or department is optional.', done: !!project,
      action: { label: 'Create', run: () => { void navigate(`${ROUTES.projects}?new=1`); } },
    },
    {
      key: 'people', title: 'Choose who’s on it', hint: 'Pick from the people in your company.', done: s.projectHasPeople, needsProject: true,
      action: project ? { label: 'Choose', run: () => { void navigate(routeTo.project(project), { state: { chooseTeam: true } }); } } : undefined,
    },
    {
      key: 'plan', title: 'Build the plan', hint: 'Start from a template, import a file, or add tasks.', done: s.projectHasTasks, needsProject: true,
      action: project ? { label: 'Open plan', run: () => { void navigate(routeTo.project(project, 'schedule')); } } : undefined,
    },
  ];
  // the first step not done is "next"; a step that needs the project waits until there is one
  const firstOpen = raw.findIndex(r => !r.done && !(r.needsProject && !project));
  const steps: Step[] = raw.map((r, i) => ({
    ...r, state: r.done ? 'done' : r.needsProject && !project ? 'later' : i === firstOpen ? 'next' : 'later',
  }));
  const allDone = steps.every(st => st.state === 'done');

  async function finish() {
    if (finishing || !user) return;
    setFinishing(true);
    setError(null);
    try {
      await apiService.updateProfile({ completeOnboarding: true });
      setUser({ ...user, onboardingCompleted: true });
    } catch (err) {
      setError(getApiErrorMessage(err, 'The card could not be closed. Please try again.'));
      setFinishing(false);
    }
  }

  const companyName = user?.organization?.name;
  return (
    <section aria-labelledby="get-started-title" className="rounded-xl border border-primary-200 dark:border-primary-800 bg-white dark:bg-gray-800 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="get-started-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          {allDone ? 'You’re all set' : `Welcome, ${user?.fullName?.split(' ')[0] ?? ''}. Let’s get ${companyName ?? 'Kovarti'} working.`}
        </h2>
        <button type="button" onClick={() => { void finish(); }} disabled={finishing}
          className="text-sm text-gray-600 dark:text-gray-300 hover:underline disabled:opacity-50">
          {allDone ? 'Close' : 'Hide this card'}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr] items-start">
        <ol className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
          {steps.map((st, i) => (
            <li key={st.key} className={`flex items-center gap-3 px-4 py-3 ${st.state === 'next' ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
              <span aria-hidden="true" className={`flex-none w-6 h-6 rounded-full border-2 border-primary-600 flex items-center justify-center text-xs font-bold ${st.state === 'done' ? 'bg-primary-600 text-white' : 'text-primary-700 dark:text-primary-300'}`}>
                {st.state === 'done' ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {st.title}{st.state === 'done' && <span className="sr-only"> (done)</span>}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{st.hint}</p>
              </div>
              {st.state === 'later' && !st.action && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">after step {s.canInvite ? 2 : 1}</span>}
              {st.state !== 'done' && st.action && (
                <button type="button" onClick={st.action.run}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap ${st.state === 'next'
                    ? 'text-white bg-primary-600 hover:bg-primary-700'
                    : 'text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {st.action.label}
                </button>
              )}
            </li>
          ))}
        </ol>
        <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Finish your profile</h3>
          <ProfileChecklist canPickRole={!user?.organization || user.organization.isOwner === true} />
        </div>
      </div>
      {s.canInvite && !s.invited && <p className="text-xs text-gray-500 dark:text-gray-400">No one to invite yet? Skip step 1 — you can invite people any time from Settings → Team.</p>}

      <InvitePeopleDialog isOpen={inviting} onClose={() => setInviting(false)}
        onInvited={() => { void queryClient.invalidateQueries({ queryKey: ['get-started'] }); void queryClient.invalidateQueries({ queryKey: ['org-members'] }); }} />
    </section>
  );
}
