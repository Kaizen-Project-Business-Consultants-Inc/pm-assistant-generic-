import { Loader2 } from 'lucide-react';
import type { CalendarChangePreview as Preview } from '../../../services/api';
import { formatCalendarDate } from '../../../utils/dateUtils';

/** "Wed 7 Oct 2026" — calendar days, never shifted by time zone */
export function fmtDay(date: string | null | undefined): string {
  if (!date) return '—';
  const wd = formatCalendarDate(date, { weekday: 'short' }, 'en-GB');
  return `${wd} ${formatCalendarDate(date, { day: 'numeric', month: 'short', year: 'numeric' }, 'en-GB')}`;
}

function shortDay(date: string | null | undefined): string {
  return date ? formatCalendarDate(date, { day: 'numeric', month: 'short' }, 'en-GB') : '—';
}

/**
 * "Before you apply" box shared by the project working calendar and Company holidays:
 * what the change is, how many tasks move, the finish before → after, the first few
 * moves, then Apply / Cancel. Nothing is saved until Apply.
 */
export function CalendarChangePreview({ label, preview, company, applying, onApply, onCancel }: {
  label: string;
  preview: Preview;
  /** Company-wide change: say how many projects, not one project's finish */
  company?: boolean;
  applying: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const shown = preview.moves.slice(0, 5);
  const more = preview.moves.length - shown.length;
  return (
    <div role="status" aria-live="polite" className="rounded-lg border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2 text-sm text-gray-900 dark:text-gray-100">
      <p>
        <span className="font-semibold text-amber-800 dark:text-amber-300">Before you apply:</span>{' '}
        {label}.{' '}
        {preview.tasksMoved === 0
          ? 'No tasks move.'
          : <>
              This moves <b>{preview.tasksMoved} task{preview.tasksMoved === 1 ? '' : 's'}</b>
              {company
                ? <> in <b>{preview.projectsAffected} project{preview.projectsAffected === 1 ? '' : 's'}</b>.</>
                : preview.finishBefore !== preview.finishAfter
                  ? <>. The latest finish moves from <b>{fmtDay(preview.finishBefore)}</b> to <b>{fmtDay(preview.finishAfter)}</b>.</>
                  : <>. The latest finish stays <b>{fmtDay(preview.finishAfter)}</b>.</>}
            </>}
      </p>
      {shown.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {shown.map(m => (
              <tr key={`${m.taskId}`} className="border-t border-amber-200 dark:border-amber-800/60">
                <td className="py-1 pr-2 min-w-0 break-words">{m.name}{company || m.scheduleName ? <span className="text-gray-500 dark:text-gray-400"> · {m.scheduleName}</span> : null}</td>
                <td className="py-1 text-right whitespace-nowrap tabular-nums">{shortDay(m.oldStart)}–{shortDay(m.oldEnd)} → {shortDay(m.newStart)}–{shortDay(m.newEnd)}</td>
              </tr>
            ))}
            {more > 0 && (
              <tr className="border-t border-amber-200 dark:border-amber-800/60"><td className="py-1 text-gray-600 dark:text-gray-400" colSpan={2}>+ {more} more</td></tr>
            )}
          </tbody>
        </table>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onApply} disabled={applying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400">
          {applying && <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          Apply
        </button>
        <button type="button" onClick={onCancel} disabled={applying}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
          Cancel
        </button>
        {preview.tasksMoved > 0 && <span className="text-xs text-gray-600 dark:text-gray-400">You can undo the moves from Schedule History.</span>}
      </div>
    </div>
  );
}
