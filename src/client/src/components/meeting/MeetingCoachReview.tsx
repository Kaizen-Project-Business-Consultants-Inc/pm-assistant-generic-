import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Megaphone, Sparkles, TrendingUp } from 'lucide-react';
import { apiService } from '../../services/api';
import { getApiErrorMessage } from '../../utils/getApiErrorMessage';
import { mapAnalysisToRaidCandidates, RaidCandidate, toSendToRaidPayload } from '../../utils/meetingToRaidMapper';

/**
 * Meeting Coach (2026-10-01): the meeting's items split into "called out in the meeting" (ticked)
 * and "AI spotted" (unticked), with gaps flagged (no owner / two Toms / no date), the PM-only
 * Add to RAID buttons, and the scorecard. Nothing reaches RAID until the PM clicks Add.
 */

export interface Scorecard {
  calledOut: number;
  aiOnly: number;
  actions: { total: number; withOwnerAndDate: number };
  risks: { total: number; withOwner: number };
  tips: string[];
  trend: { recentShare: number | null; meetings: number; previousShare: number | null };
}

interface Props {
  analysis: any;
  projectId: string;
  /** The project's Manager/Owner — the only one who adds to RAID */
  canEdit: boolean;
  isSample?: boolean;
}

const TYPE_LABEL: Record<string, string> = { action: 'Action', risk: 'Risk', issue: 'Issue', decision: 'Decision', dependency: 'Dependency' };
const tag = 'inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap';
const warnTag = `${tag} bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300`;
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export const MeetingCoachReview: React.FC<Props> = ({ analysis, projectId, canEdit, isSample }) => {
  const queryClient = useQueryClient();
  const base = useMemo(() => mapAnalysisToRaidCandidates(analysis), [analysis]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [owners, setOwners] = useState<Record<number, string>>({});
  const [dues, setDues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // A new analysis: called-out items ticked, AI-spotted not
  useEffect(() => {
    setSelected(new Set(base.map((c, i) => (c.calledOut ? i : -1)).filter(i => i >= 0)));
    setOwners({});
    setDues({});
    setMessage(null);
  }, [base]);

  const coach: Scorecard | undefined = analysis?.coach;
  const calledIdx = base.map((c, i) => (c.calledOut ? i : -1)).filter(i => i >= 0);
  const spottedIdx = base.map((c, i) => (!c.calledOut ? i : -1)).filter(i => i >= 0);

  const effective = (i: number): RaidCandidate => {
    const c = base[i];
    const pick = owners[i];
    const chosen = pick ? c.ownerChoices?.find(o => o.userId === pick) : undefined;
    return {
      ...c,
      ownerId: chosen?.userId ?? c.ownerId,
      ownerName: chosen?.name ?? c.ownerName,
      dueDate: dues[i] || c.dueDate,
    };
  };

  const add = async (indices: number[]) => {
    setMessage(null);
    const unpicked = indices.filter(i => base[i].ownerChoices?.length && !owners[i]);
    if (unpicked.length) {
      setMessage({ kind: 'error', text: `Choose who is meant for: ${unpicked.map(i => `"${base[i].title}"`).join(', ')}.` });
      return;
    }
    setBusy(true);
    try {
      const items = indices.map(effective);
      let dupes: Record<string, unknown> = {};
      try {
        dupes = (await apiService.checkRaidDuplicates(analysis.id, projectId, items.map(c => c.title)))?.data || {};
      } catch { /* add anyway; the register is the PM's to tidy */ }
      const fresh = items.filter(c => !dupes[c.title.toLowerCase().trim()]);
      const skipped = items.length - fresh.length;
      if (fresh.length) await apiService.sendToRaid(analysis.id, projectId, fresh.map(toSendToRaidPayload));
      queryClient.invalidateQueries({ queryKey: ['risks', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project-risks-stats', projectId] });
      setMessage({
        kind: 'ok',
        text: `Added ${fresh.length} to RAID.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already there (skipped).` : ''}`,
      });
    } catch (err) {
      setMessage({ kind: 'error', text: getApiErrorMessage(err, 'Could not add to RAID. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  const ownerCell = (i: number) => {
    const c = base[i];
    if (c.type === 'decision') return <span className="text-gray-600 dark:text-gray-300">{c.saidBy || c.decidedBy || '—'}</span>;
    if (c.ownerChoices?.length) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className={warnTag}>{c.ownerChoices.length} people fit</span>
          {canEdit && (
            <select id={`coach-owner-${i}`} aria-label={`Owner for ${c.title}`} value={owners[i] ?? ''} onChange={e => setOwners(o => ({ ...o, [i]: e.target.value }))} className="input py-0.5 text-xs">
              <option value="">Choose…</option>
              {c.ownerChoices.map(o => <option key={o.userId} value={o.userId}>{o.name}</option>)}
            </select>
          )}
        </span>
      );
    }
    if (c.ownerName) return <span className="text-gray-900 dark:text-white">{c.ownerName}</span>;
    return <span className={warnTag}>No owner said</span>;
  };

  const dueCell = (i: number) => {
    const c = base[i];
    if (c.type !== 'action') return <span className="text-gray-500 dark:text-gray-400">—</span>;
    if (c.dueDate) return <span className="tabular-nums">{c.dueDate}</span>;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className={warnTag}>No date said</span>
        {canEdit && <input type="date" id={`coach-due-${i}`} aria-label={`Due date for ${c.title}`} value={dues[i] ?? ''} onChange={e => setDues(d => ({ ...d, [i]: e.target.value }))} className="input py-0.5 text-xs" />}
      </span>
    );
  };

  const table = (indices: number[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {canEdit && <th className="py-2 pr-2 w-8"><span className="sr-only">Add</span></th>}
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Item</th>
            <th className="py-2 pr-3 font-medium">Owner</th>
            <th className="py-2 pr-3 font-medium">Due</th>
            <th className="py-2 font-medium">When said</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {indices.map(i => {
            const c = base[i];
            return (
              <tr key={i} className="align-top">
                {canEdit && (
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Add "${c.title}" to RAID`}
                      checked={selected.has(i)}
                      onChange={() => setSelected(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                      className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                    />
                  </td>
                )}
                <td className="py-2 pr-3 text-gray-600 dark:text-gray-300">{TYPE_LABEL[c.sourceType] ?? c.type}</td>
                <td className="py-2 pr-3 text-gray-900 dark:text-white">
                  {c.title}
                  {c.quote && <div className="text-xs italic text-gray-500 dark:text-gray-400">"{c.quote}"</div>}
                </td>
                <td className="py-2 pr-3">{ownerCell(i)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{dueCell(i)}</td>
                <td className="py-2 whitespace-nowrap tabular-nums text-gray-500 dark:text-gray-400">{c.at || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const selectedList = [...selected].sort((a, b) => a - b);

  return (
    <div className="card space-y-5">
      <div className="space-y-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <Megaphone className="w-4 h-4 text-green-600 dark:text-green-400" aria-hidden="true" />
          <span className={`${tag} bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400`}>Called out in the meeting</span>
          {calledIdx.length} {calledIdx.length === 1 ? 'item' : 'items'}{canEdit && calledIdx.length > 0 ? ' · ticked for you' : ''}
        </h3>
        {calledIdx.length ? table(calledIdx) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nothing was called out. Next time, say "that's an action for…" or "log that as a risk" in the meeting. See the Chair's card.</p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
          <span className={`${tag} bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300`}>AI spotted</span>
          {spottedIdx.length} {spottedIdx.length === 1 ? 'item' : 'items'}{canEdit && spottedIdx.length > 0 ? ' · not ticked, you decide' : ''}
        </h3>
        {spottedIdx.length ? table(spottedIdx) : <p className="text-sm text-gray-500 dark:text-gray-400">Nothing else spotted.</p>}
      </div>

      {canEdit && !isSample && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => add(calledIdx)} disabled={busy || calledIdx.length === 0} className="btn btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Add {calledIdx.length} called-out {calledIdx.length === 1 ? 'item' : 'items'} to RAID
          </button>
          <button type="button" onClick={() => add(selectedList)} disabled={busy || selectedList.length === 0} className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">
            Add selected ({selectedList.length})
          </button>
        </div>
      )}
      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'} aria-live="polite" className={`rounded-lg p-3 text-sm ${message.kind === 'ok' ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
          {message.text}
        </div>
      )}

      {coach && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <TrendingUp className="w-4 h-4 text-primary-500" aria-hidden="true" /> Meeting scorecard
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              [String(coach.calledOut), 'called out in the meeting'],
              [String(coach.aiOnly), 'spotted by AI only'],
              [`${coach.actions.withOwnerAndDate} of ${coach.actions.total}`, 'actions with owner + date'],
              [`${coach.risks.withOwner} of ${coach.risks.total}`, 'risks with an owner'],
            ].map(([v, l]) => (
              <div key={l} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <div className="text-xl font-bold tabular-nums text-gray-900 dark:text-white">{v}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{l}</div>
              </div>
            ))}
          </div>
          {coach.tips.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Next time:</p>
              <ul className="mt-1 list-disc pl-5 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
                {coach.tips.map(t => <li key={t}>{t}</li>)}
              </ul>
            </div>
          )}
          {coach.trend.meetings > 1 && (
            <p className="text-sm text-gray-600 dark:text-gray-300">
              This project: {pct(coach.trend.recentShare)} of items called out over the last {coach.trend.meetings} meetings
              {coach.trend.previousShare !== null ? `, ${(coach.trend.recentShare ?? 0) >= coach.trend.previousShare ? 'up' : 'down'} from ${pct(coach.trend.previousShare)} before` : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
