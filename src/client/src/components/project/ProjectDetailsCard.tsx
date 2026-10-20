import { useId, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, MapPin } from 'lucide-react';
import { apiService } from '../../services/api';
import { formatCurrency } from '../../utils/formatCurrency';
import { Avatar } from '../ui/Avatar';
import { formatCalendarDate, toLocalDate } from '../../utils/dateUtils';
import { workingDaysBetween, type WorkCalendar } from '../../utils/workingDays';
import { PROJECT_TYPE_LABELS } from '../../constants/projectTypes';
import { useClientWord } from '../../hooks/useClientWord';

/**
 * The project's details, grouped so they read at a glance (UAT U15, 2026-10-14): WHO it is for and
 * who runs it, WHEN (dates, length and time left in working days, the holiday calendar), MONEY
 * (budget, spent, currency) and WHAT (type, methodology, priority, category, location) — words,
 * not code values ("Web development", not "web_development"). The PM edits it with the pencil.
 */
interface ProjectDetails {
  id: string;
  priority?: string;
  category?: string;
  projectType?: string;
  methodology?: string;
  location?: string;
  currency?: string;
  budgetAllocated?: number;
  budgetSpent?: number;
  startDate?: string;
  endDate?: string;
  /** the day progress is judged "as at" (StatusDateService); else today */
  statusDate?: string | null;
  clientId?: string | null;
  groupId?: string | null;
}

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
};

/** 'web_development' → 'Web development' */
export const inWords = (code?: string | null) => {
  if (!code) return '';
  const s = code.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
};

/** "starts in 19 days" / "45 working days left" / "ended 3 days ago", from today's calendar day */
export function timeLeft(start: string | undefined, end: string | undefined, today: string, cal?: WorkCalendar | null): string | null {
  const s = start?.slice(0, 10); const e = end?.slice(0, 10);
  const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  if (s && today < s) { const n = days(today, s); return `starts in ${n} day${n === 1 ? '' : 's'}`; }
  if (e && today > e) { const n = days(e, today); return `ended ${n} day${n === 1 ? '' : 's'} ago`; }
  if (e) { const n = workingDaysBetween(today, e, cal) ?? 0; return `${n} working day${n === 1 ? '' : 's'} left`; }
  return null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-600 dark:text-gray-300">{label}</dt>
      <dd className="text-sm font-semibold text-gray-900 dark:text-white break-words">{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h4 id={id} className="text-xs font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300 mb-2">{title}</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </section>
  );
}

/** A value still loading: "…" on screen, "Loading" for screen readers */
function Pending() {
  return <><span aria-hidden="true">…</span><span className="sr-only">Loading</span></>;
}

function ManagerValue({ manager, loading }: { manager: { name: string; email?: string } | null; loading?: boolean }) {
  if (loading) return <Pending />;
  if (!manager) return <>Not assigned</>;
  return (
    <>
      <span className="inline-flex items-center gap-1.5"><Avatar name={manager.name} size="sm" /> {manager.name}</span>
      {manager.email && manager.email !== manager.name && (
        <span className="block text-xs font-medium text-gray-600 dark:text-gray-300 break-all">{manager.email}</span>
      )}
    </>
  );
}

export function ProjectDetailsCard({ project, manager, managerLoading, onEdit }: {
  project: ProjectDetails;
  manager: { name: string; email?: string } | null;
  managerLoading?: boolean;
  /** shown only to whoever may change the project (its PM) */
  onEdit?: () => void;
}) {
  const word = useClientWord();
  const clientId = project.clientId || project.groupId || null;
  const clientsQ = useQuery<{ groups: Array<{ id: string; name: string; holidayCalendarId?: string | null }> }>({
    queryKey: ['project-groups'], queryFn: () => apiService.getProjectGroups(), staleTime: 120_000, enabled: !!clientId,
  });
  const client = clientsQ.data?.groups?.find(g => g.id === clientId) ?? null;
  const calendarsQ = useQuery({ queryKey: ['holiday-calendars'], queryFn: () => apiService.getHolidayCalendars(), staleTime: 120_000 });
  const calendarId = client?.holidayCalendarId || 'home';
  const calendarName = calendarsQ.data?.calendars?.find((c: { id: string; name: string }) => c.id === calendarId)?.name ?? 'Company holidays';
  const sponsorQ = useQuery({ queryKey: ['project-sponsor', project.id], queryFn: () => apiService.getProjectSponsor(project.id) });
  const sponsor = sponsorQ.data?.sponsor ?? null;

  const start = project.startDate?.slice(0, 10);
  const end = project.endDate?.slice(0, 10);
  // the project's own days off, so "working days" matches the schedule
  const nwdQ = useQuery({
    queryKey: ['nonWorkingDates', project.id, start, end],
    queryFn: () => apiService.getNonWorkingDates(project.id, start!, end!),
    enabled: !!start && !!end && start <= end, staleTime: 5 * 60 * 1000,
  });
  const cal: WorkCalendar | null = nwdQ.data && start && end ? { nonWorking: new Set<string>(nwdQ.data.dates || []), from: start, to: end } : null;
  // until the project's days off arrive, a count would change under the reader: show … instead
  const calPending = !!start && !!end && start <= end && nwdQ.isLoading;
  const length = start && end && !calPending ? workingDaysBetween(start, end, cal) : null;
  const weeks = start && end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / (7 * 86400000))) : null;
  const left = calPending ? null : timeLeft(start, end, project.statusDate?.slice(0, 10) || toLocalDate(), cal);

  const currency = project.currency?.toUpperCase() || '';
  const money = (n: number) => formatCurrency(n, currency || 'USD');
  const budget = project.budgetAllocated ?? null;
  const spent = project.budgetSpent ?? 0;
  const spentPct = budget && budget > 0 ? Math.round((spent / budget) * 100) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">Project Details</h3>
        {onEdit && (
          <button type="button" onClick={onEdit} aria-label="Edit project details" title="Edit project details"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30">
            <Pencil aria-hidden="true" className="w-3.5 h-3.5" /> Edit
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
        <Group title="Who">
          <Field label={word.one}>{client?.name ?? (clientId ? <Pending /> : `No ${word.lower}`)}</Field>
          <Field label="Sponsor">{sponsor?.name ?? 'Not named'}</Field>
          <Field label="Project manager">
            <ManagerValue manager={manager} loading={managerLoading} />
          </Field>
        </Group>
        <Group title="When">
          <Field label="Start">{start ? formatCalendarDate(start) : 'Not set'}</Field>
          <Field label="End">{end ? formatCalendarDate(end) : 'Not set'}</Field>
          <Field label="Length">
            {calPending ? <Pending /> : length != null ? <>{weeks} week{weeks === 1 ? '' : 's'} · {length} working days</> : '—'}
            {left && <span className="block text-xs font-medium text-gray-600 dark:text-gray-300">{left}</span>}
          </Field>
          <Field label="Holiday calendar">{calendarName}</Field>
        </Group>
        <Group title="Money">
          <Field label="Budget">{budget != null ? money(budget) : 'Not set'}</Field>
          <Field label="Spent">
            {money(spent)}
            {spentPct != null && <span className={`block text-xs font-medium ${spentPct > 100 ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'}`}>{spentPct}% of budget</span>}
          </Field>
          <Field label="Currency">{currency || '—'}</Field>
        </Group>
        <Group title="What">
          <Field label="Type">{PROJECT_TYPE_LABELS[project.projectType ?? ''] ?? (inWords(project.projectType) || '—')}</Field>
          <Field label="Methodology">{inWords(project.methodology) || 'Waterfall'}</Field>
          <Field label="Priority">
            {project.priority ? (
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${PRIORITY_STYLE[project.priority] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'}`}>{inWords(project.priority)}</span>
            ) : '—'}
          </Field>
          {project.category && <Field label="Category">{inWords(project.category)}</Field>}
          {project.location && (
            <Field label="Location">
              <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />{project.location}</span>
            </Field>
          )}
        </Group>
      </div>
    </div>
  );
}
