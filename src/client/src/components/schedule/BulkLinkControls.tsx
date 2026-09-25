import { useState } from 'react';
import { Link2 } from 'lucide-react';
import type { BulkLinkMode } from './bulkLink';

export type OnBulkLink = (mode: BulkLinkMode, taskIds: string[], target?: string) => Promise<string>;

interface Props {
  selectedIds: string[];
  onBulkLink: OnBulkLink;
  /** Called after links were added (e.g. to clear the selection) */
  onLinked?: () => void;
  disabled?: boolean;
}

/**
 * "Link" group on the schedule selection bar (shared by the Gantt and Table views):
 * chain the selected tasks in row order, make them all wait on one row, or make one row
 * wait on all of them. Loops and bad rows come back as a plain message; nothing is linked.
 */
export function BulkLinkControls({ selectedIds, onBulkLink, onLinked, disabled }: Props) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const run = async (mode: BulkLinkMode) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await onBulkLink(mode, selectedIds, mode === 'chain' ? undefined : target);
      setMessage({ text, ok: true });
      setTarget('');
      onLinked?.();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Linking failed. Nothing was changed.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy;
  // Indigo, deliberately unlike the rest of the teal selection bar so the Link group stands
  // out (user feedback: pale teal-on-teal didn't register). Indigo isn't a semantic colour
  // here — blue is status, violet is AI, red/orange/green are risk.
  const btn = 'text-xs font-semibold px-2.5 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-400 dark:hover:bg-indigo-300 dark:text-gray-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 disabled:bg-indigo-100 disabled:text-indigo-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500 disabled:cursor-not-allowed whitespace-nowrap';

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap rounded-md border-2 border-indigo-400 bg-white dark:bg-gray-900 dark:border-indigo-400/70 px-2 py-1 shadow-sm"
      role="group"
      aria-label="Link selected tasks"
    >
      <Link2 className="w-4 h-4 text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
      <span className="text-xs font-bold text-indigo-700 dark:text-indigo-200 whitespace-nowrap">Link tasks</span>
      <button
        type="button"
        className={btn}
        onClick={() => run('chain')}
        disabled={off || selectedIds.length < 2}
        title="Each selected task waits for the one above it (by row number)"
      >
        Link in order
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Row to link to, for example 3 or 3FS+2d"
        placeholder="Row #"
        className="text-xs px-2 py-1 rounded border border-indigo-300 dark:border-indigo-500/60 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 w-20"
        value={target}
        onChange={e => setTarget(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && target.trim()) run('allWaitOn'); }}
        disabled={off}
      />
      <button
        type="button"
        className={btn}
        onClick={() => run('allWaitOn')}
        disabled={off || !target.trim()}
        title="Every selected task waits for this row (e.g. a gate or milestone)"
      >
        All wait on it
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => run('waitsOnAll')}
        disabled={off || !target.trim()}
        title="This row waits for every selected task (e.g. a sign-off after several tasks)"
      >
        It waits on all
      </button>
      {message && (
        <span
          role="status"
          aria-live="polite"
          className={`text-xs font-medium px-2 py-1 rounded ${message.ok ? 'text-green-700 bg-green-50 dark:text-green-300 dark:bg-green-900/20' : 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-900/20'}`}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}
