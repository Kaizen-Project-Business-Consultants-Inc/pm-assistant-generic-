import { useEffect, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiService } from '../../../services/api';
import { formatCalendarDate } from '../../../utils/dateUtils';

/**
 * Propose fixes — what Apply would do to the dates, before the PM applies (2026-10-18: one
 * "Select all in Critical" pushed a finish from 15 Jan to 13 Sep with no warning). The server
 * works it out on a copy of the plan (POST …/preview) and saves nothing.
 */

/** The server's dry run (ScheduleFixProposerService.preview) */
interface FixPreview {
  tasksMoved: number;
  /** The most any one task's finish moves, in days (U61) */
  maxShiftDays?: number;
  /** Links the plan's own dates already break: Apply makes the dates follow them too */
  brokenLinks?: number;
  brokenExample?: { task: string; waitsFor: string } | null;
  /** The tasks that move, most first (at most 50) */
  moves?: Array<{ name: string; finishBefore: string | null; finishAfter: string; days: number }>;
  finishBefore: string | null;
  finishAfter: string | null;
  finishShiftDays: number;
  projectEnd: string | null;
  scoreBefore: number;
  scoreAfter: number;
}

/**
 * The preview for these fixes. `debounceMs` waits for the PM to stop ticking; the answer for a
 * set of fixes is kept (it can't change while the proposal is open). An error just gives no answer.
 */
export function useFixPreview(scheduleId: string, proposalId: string | null, fixIds: string[], debounceMs: number, names?: Record<string, string>) {
  // The question: which fixes, and the names typed for the renames among them (they change the score)
  const key = JSON.stringify({ ids: [...fixIds].sort(), names: names ?? {} });
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    // Back to the selection last asked about: nothing to ask (its answer is still cached)
    if (key === settled) return;
    if (debounceMs <= 0) { setSettled(key); return; }
    const t = setTimeout(() => setSettled(key), debounceMs);
    return () => clearTimeout(t);
  }, [key, settled, debounceMs]);
  const asked = JSON.parse(settled) as { ids: string[]; names: Record<string, string> };
  const query = useQuery<FixPreview>({
    queryKey: ['schedule-fix-preview', scheduleId, proposalId, settled],
    queryFn: () => apiService.previewScheduleFixes(scheduleId, proposalId!, asked.ids, Object.keys(asked.names).length ? asked.names : undefined),
    enabled: !!proposalId && asked.ids.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData, // the last answer stays up while the next is worked out
    retry: false,
  });
  // Nothing ticked, or the question failed: no answer (the box hides)
  const none = fixIds.length === 0 || query.isError;
  return {
    data: none ? null : query.data ?? null,
    working: !none && (settled !== key || query.isFetching),
  };
}

const fmt = (d: string | null) => (d ? formatCalendarDate(d) : '—');

/** "+3 weeks" / "+4 days" */
export function shiftText(days: number): string {
  const sign = days > 0 ? '+' : '−';
  const n = Math.abs(days);
  if (n >= 7) { const w = Math.round(n / 7); return `${sign}${w} week${w === 1 ? '' : 's'}`; }
  return `${sign}${n} day${n === 1 ? '' : 's'}`;
}

/** The finish passes the project's own end date */
export const passesEnd = (p: Pick<FixPreview, 'finishAfter' | 'projectEnd'>) => !!p.finishAfter && !!p.projectEnd && p.finishAfter > p.projectEnd;

/** Red past the project end, amber when it only moves later, plain otherwise */
function finishTone(p: FixPreview): string {
  if (passesEnd(p)) return 'text-red-700 dark:text-red-300';
  if (p.finishShiftDays > 0) return 'text-amber-700 dark:text-amber-300';
  return 'text-gray-900 dark:text-gray-100';
}

/** One line for the overlapping links of a level: what linking them does to the finish */
export function overlapImpactText(p: FixPreview): string {
  if (p.finishShiftDays <= 0) return `Linking them puts them one after the other: ${p.tasksMoved === 0 ? 'no dates move' : `${p.tasksMoved} task${p.tasksMoved === 1 ? '' : 's'} move, the finish stays ${fmt(p.finishAfter)}`}.`;
  const past = passesEnd(p) ? ` — past the project end (${fmt(p.projectEnd)})` : '';
  return `Linking them puts them one after the other: the finish moves from ${fmt(p.finishBefore)} to ${fmt(p.finishAfter)} (${shiftText(p.finishShiftDays)})${past}.`;
}

/** What a screen reader hears when the answer arrives: one short sentence */
function impactSentence(p: FixPreview): string {
  const past = passesEnd(p) ? ', past the project end' : '';
  return `If applied: score ${p.scoreBefore} to ${p.scoreAfter}, finish ${fmt(p.finishAfter)}${past}, ${p.tasksMoved} task${p.tasksMoved === 1 ? '' : 's'} move.`;
}

/**
 * "If you apply what is ticked" — score, finish and tasks moved; never blocks Apply. The live
 * region is always there (a region that appears with its text is often not read out) and says one
 * sentence per answer, not the whole box.
 */
export function ImpactBox({ preview, working }: { preview: FixPreview | null; working: boolean }) {
  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">{preview && !working ? impactSentence(preview) : ''}</div>
      <ImpactDetails preview={preview} working={working} />
    </>
  );
}

/**
 * Dates will move because the plan already breaks some links (U61): what moves, how far, why —
 * and the tasks, on request
 */
function MovesWarning({ preview }: { preview: FixPreview }) {
  const [open, setOpen] = useState(false);
  if (!preview.tasksMoved) return null;
  const far = preview.maxShiftDays ? `, up to ${preview.maxShiftDays} day${preview.maxShiftDays === 1 ? '' : 's'}` : '';
  return (
    <div className="mt-1 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-1">
      <p>
        <strong>Applying these moves {preview.tasksMoved} task{preview.tasksMoved === 1 ? '' : 's'}{far}.</strong>
        {preview.brokenLinks ? (
          <> Your plan already has {preview.brokenLinks} link{preview.brokenLinks === 1 ? '' : 's'} its dates don't follow
            {preview.brokenExample ? <> (for example, '{preview.brokenExample.task}' starts before '{preview.brokenExample.waitsFor}' finishes)</> : null}.
            {' '}Applying fixes makes the plan follow those too.</>
        ) : null}
      </p>
      {preview.moves && preview.moves.length > 0 && (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="font-medium underline">
          {open ? 'Hide' : 'See'} the {preview.tasksMoved} task{preview.tasksMoved === 1 ? '' : 's'}
        </button>
      )}
      {open && preview.moves && (
        <ul className="max-h-48 overflow-y-auto space-y-0.5">
          {preview.moves.map((m, i) => (
            <li key={`${i}-${m.name}`} className="flex justify-between gap-2">
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="shrink-0 tabular-nums">{fmt(m.finishBefore)} → {fmt(m.finishAfter)} ({m.days > 0 ? '+' : ''}{m.days}d)</span>
            </li>
          ))}
          {preview.tasksMoved > preview.moves.length && <li>…and {preview.tasksMoved - preview.moves.length} more</li>}
        </ul>
      )}
    </div>
  );
}

function ImpactDetails({ preview, working }: { preview: FixPreview | null; working: boolean }) {
  if (!preview && !working) return null;
  return (
    <div data-testid="fix-impact" className="mx-4 mb-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm space-y-1">
      <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">If you apply what is ticked</p>
      {!preview ? (
        <p className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Working out…
        </p>
      ) : (
        <>
          <p className="text-gray-900 dark:text-gray-100">Score {preview.scoreBefore} → <span className="font-semibold">{preview.scoreAfter}</span></p>
          <p className={finishTone(preview)}>
            Finish {fmt(preview.finishBefore)} → <span className="font-semibold">{fmt(preview.finishAfter)}</span>
            {preview.finishShiftDays !== 0 && ` (${shiftText(preview.finishShiftDays)})`}
            {passesEnd(preview) && ` — past the project end, ${fmt(preview.projectEnd)}`}
          </p>
          <p className="text-gray-600 dark:text-gray-300">
            {preview.tasksMoved === 0 ? 'No task dates move.' : `${preview.tasksMoved} task${preview.tasksMoved === 1 ? '' : 's'} move.`}
            {working && <span className="ml-1 text-xs">Updating…</span>}
          </p>
          <MovesWarning preview={preview} />
        </>
      )}
    </div>
  );
}
