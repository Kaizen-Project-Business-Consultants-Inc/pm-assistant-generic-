import { useState } from 'react';
import { FolderTree } from 'lucide-react';

export type OnGroupTasks = (taskIds: string[], name: string) => Promise<string>;

interface Props {
  selectedIds: string[];
  onGroupTasks: OnGroupTasks;
  /** Called after the tasks were grouped (e.g. to clear the selection) */
  onGrouped?: () => void;
  disabled?: boolean;
}

/**
 * "Group" on the schedule selection bar (shared by the Gantt and Table views): put the
 * selected tasks under a new summary task with the name typed here. Tasks at different
 * levels come back as a plain message; nothing is changed.
 */
export function BulkGroupControls({ selectedIds, onGroupTasks, onGrouped, disabled }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const run = async () => {
    if (!name.trim() || selectedIds.length < 2) return;
    setBusy(true);
    setMessage(null);
    try {
      const text = await onGroupTasks(selectedIds, name.trim());
      setMessage({ text, ok: true });
      setName('');
      onGrouped?.();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Grouping failed. Nothing was changed.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy;
  // Near-black (white in dark mode) so it stands apart from the teal bar and the indigo Link
  // group — emerald/amber/red are risk, blue is status, violet is AI.
  const btn = 'text-xs font-semibold px-2.5 py-1 rounded bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-1 disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-800 dark:disabled:text-gray-500 disabled:cursor-not-allowed whitespace-nowrap';

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap rounded-md border-2 border-gray-700 bg-white dark:bg-gray-900 dark:border-gray-300 px-2 py-1 shadow-sm"
      role="group"
      aria-label="Group selected tasks"
    >
      <FolderTree className="w-4 h-4 text-gray-800 dark:text-gray-200" aria-hidden="true" />
      <span className="text-xs font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap">Group</span>
      <input
        type="text"
        aria-label="Name of the new summary task, for example Design"
        placeholder="Heading name"
        maxLength={255}
        className="text-xs px-2 py-1 rounded border border-gray-400 dark:border-gray-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-500 w-32"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') run(); }}
        disabled={off}
      />
      <button
        type="button"
        className={btn}
        onClick={run}
        disabled={off || !name.trim() || selectedIds.length < 2}
        title={selectedIds.length < 2 ? 'Select at least two tasks' : 'Put the selected tasks under a new summary task with this name'}
      >
        Group under heading
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
