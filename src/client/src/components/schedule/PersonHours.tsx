import { useState } from 'react';
import { personHours, totalHours, daysForPersonHours } from '../../utils/taskWork';

/**
 * A person's hours on the task (Duration × Units × hours per day). Typing new hours changes the task's Duration to fit
 * (Units stay, the others' hours follow), so it is committed when you leave the box or press Enter, not on every key.
 */
function HoursBox({ hours, label, onCommit }: { hours: number; label: string; onCommit: (hours: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const n = parseFloat(draft ?? '');
    setDraft(null);
    if (Number.isFinite(n) && n > 0 && n !== hours) onCommit(n);
  };
  return (
    <>
      <input
        aria-label={label}
        type="number"
        min="0"
        step="0.5"
        value={draft ?? String(hours)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        className="input w-16 text-xs"
        title="Hours on this task. Typing hours changes the Duration to fit."
      />
      <span className="text-xs text-gray-500">h</span>
    </>
  );
}

/** One person's hours on the task (shown for a picked person on a task that lasts a while) */
export function PersonHours({ show, label, days, allocationPct, hoursPerDay, onDuration }: {
  show: boolean; label: string; days: number; allocationPct: number; hoursPerDay: number; onDuration: (days: number) => void;
}) {
  if (!show) return null;
  return (
    <HoursBox
      label={label}
      hours={personHours(days, allocationPct, hoursPerDay)}
      onCommit={(h) => { const d = daysForPersonHours(h, allocationPct, hoursPerDay); if (d) onDuration(d); }}
    />
  );
}

/** The task's Work: the total of its people's hours */
export function WorkTotal({ pcts, days, hoursPerDay }: { pcts: number[]; days: number; hoursPerDay: number }) {
  if (pcts.length === 0 || days === 0) return null; // nobody picked, or a milestone (no length)
  return (
    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1" aria-live="polite">
      Work: <strong>{totalHours(days, pcts, hoursPerDay)} h</strong>
      {' '}({days} working {days === 1 ? 'day' : 'days'} × each person&apos;s % × {hoursPerDay} h a day). Typing a person&apos;s hours changes the Duration.
    </p>
  );
}
