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
  const btn = 'text-xs px-2 py-1 rounded bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-900/40 dark:text-primary-300 dark:hover:bg-primary-900/60 disabled:opacity-50 whitespace-nowrap';

  return (
    <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Link selected tasks">
      <Link2 className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
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
        className="text-xs px-2 py-1 rounded border border-primary-200 dark:border-primary-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-400 w-20"
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
