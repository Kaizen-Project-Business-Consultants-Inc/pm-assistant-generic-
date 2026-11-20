import { useId } from 'react';
import { AccessibleModal } from '../ui/AccessibleModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DeleteCandidate, DeleteChildren, headingBody, headingTitle, summariesNeedingChoice } from '../../utils/deleteSummaryChoice';

interface Props {
  /** Every task of the plan (to find what sits under a heading) */
  tasks: DeleteCandidate[];
  /** The tasks about to be deleted */
  ids: string[];
  isPending?: boolean;
  onConfirm: (children: DeleteChildren) => void;
  onCancel: () => void;
}

/**
 * The delete question for the Gantt, the Table and the task form (the Kanban has no delete of its own: its cards open the task form). Plain tasks get the usual
 * "Are you sure?"; a heading with tasks under it (that are not being deleted too) confirms that
 * the tasks go with it (like Microsoft Project; 2026-11-19: the "heading only" choice was removed).
 */
export function DeleteTasksModal({ tasks, ids, isPending = false, onConfirm, onCancel }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const choice = summariesNeedingChoice(tasks, ids);

  if (!choice) {
    const only = ids.length === 1 ? tasks.find(t => t.id === ids[0]) : undefined;
    return (
      <ConfirmModal
        title={ids.length === 1 ? 'Delete Task' : 'Delete Tasks'}
        message={ids.length === 1 ? `Delete "${only?.name || 'this task'}"?` : `Are you sure you want to delete ${ids.length} tasks?`}
        confirmLabel="Delete"
        isPending={isPending}
        onConfirm={() => onConfirm('keep')}
        onCancel={onCancel}
      />
    );
  }

  const n = choice.below.length;
  const one = choice.headings.length === 1;
  return (
    <AccessibleModal isOpen onClose={onCancel} role="alertdialog" labelledBy={titleId} describedBy={bodyId} busy={isPending}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md mx-4">
      <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white mb-2">{headingTitle(choice)}</h3>
      <p id={bodyId} className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {headingBody(choice)} {n === 1 ? 'That task is' : 'Those tasks are'} deleted with {one ? 'the heading' : 'the headings'}, and links to {n === 1 ? 'it are' : 'them are'} removed.
      </p>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">Can be undone from History (Ctrl+Z).</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
            Cancel
          </button>
          <button type="button" disabled={isPending} onClick={() => onConfirm('delete')}
            className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50">
            Delete {one ? 'heading' : 'headings'} and {n} {n === 1 ? 'task' : 'tasks'}
          </button>
        </div>
      </div>
    </AccessibleModal>
  );
}
