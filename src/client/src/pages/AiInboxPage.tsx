import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, ChevronRight } from 'lucide-react';
import { apiService, type AiSuggestion, type AiRejectReason } from '../services/api';
import { getApiErrorMessage } from '../utils/getApiErrorMessage';
import { formatCalendarDate } from '../utils/dateUtils';
import { routeTo, ROUTES } from '../routes';
import { SectionCard, TH, TD, type StripeTone } from '../components/ui/SectionCard';
import { ToggleButton } from '../components/ui/ToggleButton';
import { MetaPill } from '../components/ui/MetaPill';

/**
 * The AI inbox (Phase 2 step 1, mock OK'd 2026-10-16): the agents' ready-made fixes for the
 * projects you manage. Nothing changes and nothing is sent until you press Accept or Send;
 * what you accept can be undone. Reject with a reason and it isn't suggested again unless it
 * gets worse.
 */
const KIND: Record<string, { label: string; tone: StripeTone; area: string }> = {
  reschedule: { label: 'Schedule', tone: 'coral', area: 'schedule' },
  add_links: { label: 'Plan quality', tone: 'gray', area: 'schedule' },
  reassign: { label: 'People & workload', tone: 'amber', area: 'people' },
  add_mitigation: { label: 'Risks & actions', tone: 'teal', area: 'raid' },
  remind_raid: { label: 'Risks & actions', tone: 'amber', area: 'raid' },
  remind_cr: { label: 'Change requests', tone: 'teal', area: 'raid' },
};
const kindOf = (k: string) => KIND[k] ?? { label: 'Suggestion', tone: 'gray' as StripeTone, area: 'other' };
const isEmail = (k: string) => k === 'remind_raid' || k === 'remind_cr';

const REASONS: Array<{ value: AiRejectReason; label: string }> = [
  { value: 'not_a_problem', label: 'Not a problem' },
  { value: 'already_handled', label: 'I’ll handle it myself' },
  { value: 'facts_wrong', label: 'The facts are wrong' },
];

const day = (v?: string | null) => (v ? formatCalendarDate(v, { month: 'short', day: 'numeric' }) : '—');

/** Where to change it by hand instead ("Edit first" for a change that isn't an email) */
function editLink(s: AiSuggestion): string {
  if (s.kind === 'reassign') return ROUTES.resources;
  if (s.kind === 'add_mitigation') return routeTo.project(s.projectId, 'raid');
  return routeTo.project(s.projectId, 'schedule');
}

function ChangeTable({ s }: { s: AiSuggestion }) {
  const p = s.payload ?? {};
  if (s.kind === 'reschedule') {
    return (
      <table className="min-w-full">
        <thead><tr><th scope="col" className={TH}>Task</th><th scope="col" className={TH}>Starts</th><th scope="col" className={TH}>Ends</th></tr></thead>
        <tbody>
          {(p.changes ?? []).map((c: any) => (
            <tr key={c.taskId}>
              <td className={TD}>{c.name}</td>
              <td className={`${TD} whitespace-nowrap`}><Was a={day(c.startBefore)} b={day(c.startAfter)} /></td>
              <td className={`${TD} whitespace-nowrap`}><Was a={day(c.endBefore)} b={day(c.endAfter)} /></td>
            </tr>
          ))}
          {p.more > 0 && <tr><td colSpan={3} className={`${TD} text-xs text-gray-600 dark:text-gray-400`}>+ {p.more} more tasks move with them</td></tr>}
        </tbody>
      </table>
    );
  }
  if (s.kind === 'reassign') {
    return (
      <table className="min-w-full">
        <thead><tr><th scope="col" className={TH}>Task</th><th scope="col" className={TH}>From</th><th scope="col" className={TH}>To</th></tr></thead>
        <tbody>
          <tr><td className={TD}>{p.taskName}</td><td className={TD}>{p.fromName}</td><td className={`${TD} font-semibold`}>{p.toName}</td></tr>
          {(p.after?.from || p.after?.to) && (
            <tr><td colSpan={3} className={`${TD} text-xs text-gray-600 dark:text-gray-400`}>
              After, week of {day(p.weekStart)}: {p.fromName} {p.after.from} · {p.toName} {p.after.to}. No dates change.
            </td></tr>
          )}
        </tbody>
      </table>
    );
  }
  if (s.kind === 'add_links') {
    return (
      <table className="min-w-full">
        <thead><tr><th scope="col" className={TH}>Task</th><th scope="col" className={TH}>Will follow</th></tr></thead>
        <tbody>
          {(p.links ?? []).map((l: any, i: number) => (
            <tr key={`${l.task}-${l.after}-${i}`}><td className={TD}>{l.task}</td><td className={TD}>{l.after}{l.type && l.type !== 'FS' ? ` (${l.type})` : ''}</td></tr>
          ))}
          {p.more > 0 && <tr><td colSpan={2} className={`${TD} text-xs text-gray-600 dark:text-gray-400`}>+ {p.more} more</td></tr>}
        </tbody>
      </table>
    );
  }
  if (s.kind === 'add_mitigation') {
    return (
      <table className="min-w-full">
        <thead><tr><th scope="col" className={TH}>New action</th><th scope="col" className={TH}>Owner</th><th scope="col" className={TH}>Due</th></tr></thead>
        <tbody><tr><td className={`${TD} font-semibold`}>{p.action?.title}</td><td className={TD}>{p.action?.ownerName} (you)</td><td className={`${TD} whitespace-nowrap`}>{day(p.action?.dueDate)}</td></tr></tbody>
      </table>
    );
  }
  return null;
}

const Was = ({ a, b }: { a: string; b: string }) =>
  a === b ? <>{b}</> : <><span className="text-gray-500 dark:text-gray-400 line-through">{a}</span> <span className="font-semibold">{b}</span></>;

const BTN = 'rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700';

/** A reminder email as it will go out, editable before Send */
function EmailDraft({ to, editing, subject, body, onSubject, onBody }: {
  to: Array<{ name: string; email: string }>; editing: boolean; subject: string; body: string;
  onSubject: (v: string) => void; onBody: (v: string) => void;
}) {
  const field = 'rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100';
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-3 text-sm grid gap-2">
      <div className="text-gray-700 dark:text-gray-200"><span className="font-semibold">To:</span> {to.map(r => `${r.name} (${r.email})`).join(', ')}</div>
      {editing ? (
        <>
          <label className="grid gap-1">
            <span className="font-semibold text-gray-700 dark:text-gray-200">Subject</span>
            <input value={subject} onChange={e => onSubject(e.target.value)} maxLength={200} className={field} />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-gray-700 dark:text-gray-200">Message</span>
            <textarea value={body} onChange={e => onBody(e.target.value)} rows={7} maxLength={5000} className={field} />
          </label>
        </>
      ) : (
        <>
          <div className="text-gray-700 dark:text-gray-200"><span className="font-semibold">Subject:</span> {subject}</div>
          <div className="whitespace-pre-line text-gray-800 dark:text-gray-100">{body}</div>
        </>
      )}
      <p className="text-xs text-gray-600 dark:text-gray-400">Sent from Kovarti; replies go to you.</p>
    </div>
  );
}

/** After the decision: what happened, and Undo when the change has one */
function Decided({ s, onUndo, busy }: { s: AiSuggestion; onUndo: () => void; busy: boolean }) {
  const label = { accepted: 'Done', rejected: 'Rejected', undone: 'Undone', working: 'Interrupted' }[s.status as string] ?? s.status;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3 text-sm">
      <MetaPill variant={s.status === 'accepted' ? 'success' : 'default'}>{label}</MetaPill>
      <span className="text-gray-700 dark:text-gray-200">
        {s.status === 'rejected'
          ? `Reason: ${REASONS.find(r => r.value === s.reason)?.label ?? s.reason}. It won’t be suggested again unless it gets worse.`
          : s.status === 'working'
            ? 'This was being applied when it stopped. Check Schedule History or the RAID log before trying again.'
            : s.resultSummary}
      </span>
      {s.status === 'accepted' && !!s.undoRef && (
        <button type="button" onClick={onUndo} disabled={busy} className={`ml-auto ${BTN} py-1 px-3`}>Undo</button>
      )}
    </div>
  );
}

/** Accept / Send, Edit first (an email) or change it myself (anything else), Reject with a reason */
function Choices({ s, busy, accepting, editing, onAccept, onToggleEdit, onReject }: {
  s: AiSuggestion; busy: boolean; accepting: boolean; editing: boolean;
  onAccept: () => void; onToggleEdit: () => void; onReject: (r: AiRejectReason) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const email = isEmail(s.kind);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
      <button type="button" onClick={onAccept} disabled={busy}
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
        {accepting ? 'Working…' : email ? 'Send' : 'Accept'}
      </button>
      {email ? (
        <ToggleButton on={editing} onClick={onToggleEdit} disabled={busy} size="lg">Edit first</ToggleButton>
      ) : (
        <Link to={editLink(s)} className={BTN}>Change it myself</Link>
      )}
      <button type="button" onClick={() => setRejecting(r => !r)} disabled={busy} aria-expanded={rejecting} className={BTN}>Reject…</button>
      <span className="ml-auto text-xs text-gray-600 dark:text-gray-400">
        {email ? 'Nothing is sent until you press Send' : 'Recorded in History · Undo afterwards'}
      </span>
      {rejecting && (
        <div className="basis-full flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300" role="group" aria-label="Why not?">
          <span>Why not?</span>
          {REASONS.map(r => (
            <button key={r.value} type="button" onClick={() => onReject(r.value)} disabled={busy} className={`${BTN} py-1 px-3`}>{r.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s }: { s: AiSuggestion }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState<string>(s.payload?.subject ?? '');
  const [body, setBody] = useState<string>(s.payload?.body ?? '');
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ai-inbox'] });
    void queryClient.invalidateQueries({ queryKey: ['ai-inbox-count'] });
    // an accepted fix changed this project's plan, people or RAID log: its own data loads fresh
    void queryClient.invalidateQueries({ predicate: q => {
      const key = JSON.stringify(q.queryKey);
      return key.includes(s.projectId) || (!!s.scheduleId && key.includes(s.scheduleId));
    } });
    if (s.kind === 'reassign') void queryClient.invalidateQueries({ queryKey: ['resources'] });
  };
  const accept = useMutation({ mutationFn: () => apiService.acceptAiSuggestion(s.id, editing && isEmail(s.kind) ? { subject, body } : {}), onSuccess: refresh });
  const reject = useMutation({ mutationFn: (reason: AiRejectReason) => apiService.rejectAiSuggestion(s.id, reason), onSuccess: refresh });
  const undo = useMutation({ mutationFn: () => apiService.undoAiSuggestion(s.id), onSuccess: refresh });
  const busy = accept.isPending || reject.isPending || undo.isPending;
  const error = accept.error || reject.error || undo.error;
  const k = kindOf(s.kind);
  const done = s.status !== 'waiting';

  return (
    <SectionCard tone={done ? 'gray' : k.tone}>
      <article className="grid gap-2.5 pt-1" aria-label={s.title}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">{s.title}</h3>
          <MetaPill variant="info">Weekly review agent</MetaPill>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <MetaPill>{k.label}</MetaPill>
          <span>{s.projectName}</span>
          {s.detail && <span>· {s.detail}</span>}
        </div>
        {!done && !isEmail(s.kind) && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700"><ChangeTable s={s} /></div>
        )}
        {!done && isEmail(s.kind) && (
          <EmailDraft to={s.payload?.to ?? []} editing={editing} subject={subject} body={body} onSubject={setSubject} onBody={setBody} />
        )}
        {s.evidence.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-primary-700 dark:text-primary-300">Why? Based on…</summary>
            <ul className="mt-2 list-disc pl-5 grid gap-1 text-gray-600 dark:text-gray-300">
              {s.evidence.map(e => <li key={e}>{e}</li>)}
            </ul>
          </details>
        )}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(error, 'That didn’t work.')}</p>}
        {done
          ? <Decided s={s} onUndo={() => undo.mutate()} busy={busy} />
          : <Choices s={s} busy={busy} accepting={accept.isPending} editing={editing}
              onAccept={() => accept.mutate()} onToggleEdit={() => setEditing(e => !e)} onReject={r => reject.mutate(r)} />}
      </article>
    </SectionCard>
  );
}

export function AiInboxPage() {
  const [view, setView] = useState<'waiting' | 'done'>('waiting');
  const [project, setProject] = useState<string>('all');
  const { data, isLoading, error } = useQuery({ queryKey: ['ai-inbox', view], queryFn: () => apiService.getAiInbox(view), staleTime: 30_000 });
  const all = useMemo(() => data?.suggestions ?? [], [data]);
  const projects = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const s of all) m.set(s.projectId, { name: s.projectName, n: (m.get(s.projectId)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [all]);
  const shown = project === 'all' ? all : all.filter(s => s.projectId === project);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI inbox</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
            Ready-made fixes from the Weekly review agent for the projects you manage. Nothing changes and nothing is sent until you press Accept or Send.
          </p>
        </div>
        <div role="group" aria-label="Show" className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          {(['waiting', 'done'] as const).map(v => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              className={`px-3 py-2 text-sm font-semibold ${view === v ? 'bg-accent-teal-soft text-accent-teal-text dark:bg-accent-teal/20 dark:text-teal-200' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              {v === 'waiting' ? 'Waiting' : 'Decided'}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">{getApiErrorMessage(error, 'Your AI inbox could not be loaded.')}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-xl bg-gray-100 dark:bg-gray-700 animate-pulse" />
      ) : all.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-10 text-center">
          <Inbox className="w-10 h-10 mx-auto mb-3 text-gray-400" aria-hidden="true" />
          <p className="font-semibold text-gray-700 dark:text-gray-200">{view === 'waiting' ? 'Nothing waiting' : 'Nothing decided yet'}</p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 max-w-prose mx-auto">
            Every Friday morning the Weekly review agent checks the projects you manage and puts ready-made fixes here. You can also run a project&rsquo;s review now from its Overview.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)] items-start">
          <nav aria-label="Filter by project" className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2">
            <h2 className="px-2.5 pt-1.5 pb-1 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">Projects</h2>
            {[['all', { name: 'All projects', n: all.length }] as const, ...projects].map(([id, info]) => (
              <button key={id} type="button" onClick={() => setProject(id)} aria-current={project === id ? 'true' : undefined}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${project === id ? 'bg-accent-teal-soft text-accent-teal-text dark:bg-accent-teal/20 dark:text-teal-200 font-bold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium'}`}>
                <span className="truncate">{info.name}</span><span className="tabular-nums text-gray-600 dark:text-gray-400">{info.n}</span>
              </button>
            ))}
          </nav>
          <div className="grid gap-4 min-w-0">
            {shown.map(s => <SuggestionCard key={s.id} s={s} />)}
            {view === 'waiting' && (
              <p className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                Undo works on the newest change to a plan; for older ones use Schedule History.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
