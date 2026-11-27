import { useId, useState } from 'react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { todayYmd } from '../../utils/rateCard';

export type ActualDateKind = 'finished' | 'started';

const TEXT = {
  finished: { title: 'Mark done', label: 'Finished on', button: 'Mark done' },
  started: { title: 'Start task', label: 'Started on', button: 'Start' },
} as const;

/**
 * Asked when ONE task is marked Completed / In progress (Nov 2026): the day it really finished or started,
 * today by default and never later than today. Bulk changes and imports use today without asking.
 */
export function ActualDateDialog({ kind, taskName, notBefore, onConfirm, onCancel }: {
  kind: ActualDateKind; taskName: string; /** a finish day cannot be before the day it started */ notBefore?: string | null; onConfirm: (date: string) => void; onCancel: () => void;
}) {
  const uid = useId();
  const today = todayYmd();
  const [date, setDate] = useState(today);
  const t = TEXT[kind];
  const earliest = kind === 'finished' && notBefore ? notBefore.slice(0, 10) : undefined;
  const valid = !!date && date <= today && (!earliest || date >= earliest);
  return (
    <AccessibleModal
      isOpen
      onClose={onCancel}
      labelledBy={`${uid}-title`}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm mx-4 w-full"
    >
      <h3 id={`${uid}-title`} className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t.title}</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 truncate">{taskName}</p>
      <label htmlFor={`${uid}-date`} className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t.label}</label>
      <input
        id={`${uid}-date`}
        type="date"
        value={date}
        max={today}
        min={earliest}
        onChange={(e) => setDate(e.target.value)}
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100"
      />
      {!valid && date && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{date > today ? 'A date cannot be in the future.' : 'A task cannot finish before it started.'}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300">Cancel</button>
        <button type="button" disabled={!valid} onClick={() => onConfirm(date)} className="px-3 py-1.5 rounded-md bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">{t.button}</button>
      </div>
    </AccessibleModal>
  );
}
