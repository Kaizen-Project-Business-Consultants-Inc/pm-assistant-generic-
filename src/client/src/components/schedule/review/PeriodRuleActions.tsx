import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiService } from '../../../services/api';
import { announce } from '../../../utils/announce';
import { getApiErrorMessage } from '../../../utils/getApiErrorMessage';
import { formatCalendarDate } from '../../../utils/dateUtils';
import { splitExceptionsKey, type SplitException } from './periodRuleTypes';

/** The two buttons under a "longer than one reporting period" finding: Go to task, and Cannot be split (asks why) */
export function PeriodRuleActions({ scheduleId, taskId, taskName, canEdit, onGoTo, onSaved }: {
  scheduleId: string;
  taskId: string;
  taskName: string;
  canEdit: boolean;
  onGoTo: () => void;
  /** The review that was re-run after the exception was saved */
  onSaved: (review: unknown) => void;
}) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const whyRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  // the reason box takes focus when it opens, so a keyboard user can type straight away
  useEffect(() => { if (asking) whyRef.current?.focus(); }, [asking]);
  const save = useMutation({
    mutationFn: () => apiService.markTaskCannotBeSplit(scheduleId, taskId, reason.trim()),
    onSuccess: (data: { review: unknown; exceptions: SplitException[] }) => {
      queryClient.setQueryData(splitExceptionsKey(scheduleId), { exceptions: data.exceptions });
      void queryClient.invalidateQueries({ queryKey: ['schedule-review', scheduleId, 'history'] });
      setAsking(false);
      setReason('');
      onSaved(data.review);
      announce(`${taskName} is now an accepted exception`);
    },
  });
  const cancel = () => {
    setAsking(false); setReason(''); save.reset();
    // the button is drawn again: put keyboard focus back on it
    requestAnimationFrame(() => openRef.current?.focus());
  };
  const btn = 'px-2.5 py-1 text-xs font-medium rounded-md border border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-gray-700';

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onGoTo} aria-label={`Go to task: ${taskName}`} className={btn}>Go to task</button>
        {canEdit && !asking && (
          <button type="button" ref={openRef} onClick={() => setAsking(true)} aria-label={`Cannot be split: ${taskName}`} className={btn}>Cannot be split</button>
        )}
      </div>
      {asking && (
        <form
          className="mt-2 space-y-1.5"
          onSubmit={e => { e.preventDefault(); if (reason.trim().length >= 3) save.mutate(); }}
        >
          <label htmlFor={`${uid}-why`} className="block text-xs font-semibold text-gray-800 dark:text-gray-200">Why can it not be split? (a short reason)</label>
          <input
            id={`${uid}-why`}
            type="text"
            value={reason}
            maxLength={500}
            ref={whyRef}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); cancel(); } }}
            onChange={e => setReason(e.target.value)}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-900 dark:text-white"
          />
          {save.isError && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{getApiErrorMessage(save.error, 'Could not save. Please try again.')}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending || reason.trim().length < 3} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60">
              {save.isPending && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
              Save exception
            </button>
            <button type="button" onClick={cancel} className="px-2.5 py-1 text-xs text-gray-700 dark:text-gray-200 underline">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Tasks the PM accepted as longer than a period, with the reason, who and when (PM only: the list is the manager's route) */
export function AcceptedExceptions({ scheduleId, canEdit, onChanged }: { scheduleId: string; canEdit: boolean; onChanged: (review: unknown) => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: splitExceptionsKey(scheduleId),
    queryFn: () => apiService.getScheduleSplitExceptions(scheduleId),
    enabled: canEdit,
    retry: false,
  });
  const remove = useMutation({
    mutationFn: (taskId: string) => apiService.removeSplitException(scheduleId, taskId),
    onSuccess: (res: { review: unknown; exceptions: SplitException[] }) => {
      queryClient.setQueryData(splitExceptionsKey(scheduleId), { exceptions: res.exceptions });
      onChanged(res.review);
      announce('Exception removed. The task is checked again.');
    },
  });
  const list = data?.exceptions ?? [];
  if (!canEdit || list.length === 0) return null;
  return (
    <section aria-label="Accepted exceptions" className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300">Accepted exceptions ({list.length})</h3>
      <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">Longer than one reporting period, accepted as it is. Not counted in the review.</p>
      <ul className="mt-1 space-y-1.5">
        {list.map(x => (
          <li key={x.taskId} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200">
            <span className="font-semibold">{x.taskName}</span>
            <span className="block break-words">{x.reason}</span>
            <span className="block text-gray-600 dark:text-gray-400">{x.createdByName || 'Someone'}, {formatCalendarDate(x.createdAt)}</span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(x.taskId)}
              aria-label={`Remove exception: ${x.taskName}`}
              className="mt-1 text-xs text-primary-700 dark:text-primary-300 underline disabled:opacity-60"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {remove.isError && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{getApiErrorMessage(remove.error, 'Could not remove it. Please try again.')}</p>}
    </section>
  );
}
