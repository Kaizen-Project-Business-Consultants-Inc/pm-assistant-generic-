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
 * "Are you sure?"; a heading with tasks under it (that are not being deleted too) asks whether
 * the tasks stay or go with it. The choice is never remembered — it is asked each time.
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
  const heading = one ? 'the heading' : 'the headings';
  const stays = n === 1 ? `"${choice.below[0].name}" stays in the plan as a standalone task.` : `The ${n} tasks stay in the plan, moved up a level.`;
  const goes = n === 1 ? `"${choice.below[0].name}" is deleted too. Links to it are removed.` : `The ${n} tasks are deleted too. Links to them are removed.`;
  return (
    <AccessibleModal isOpen onClose={onCancel} role="alertdialog" labelledBy={titleId} describedBy={bodyId} busy={isPending}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-md mx-4">
      <h3 id={titleId} className="text-lg font-bold text-gray-900 dark:text-white mb-2">{headingTitle(choice)}</h3>
      <p id={bodyId} className="text-sm text-gray-600 dark:text-gray-400 mb-4">{headingBody(choice)}</p>
      <div className="grid gap-2 mb-3">
        <button type="button" disabled={isPending} onClick={() => onConfirm('keep')}
          className="text-left rounded-lg border border-teal-600 px-3 py-2 hover:bg-teal-50 dark:hover:bg-teal-900/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-50">
          <span className="block text-sm font-semibold text-gray-900 dark:text-white">Delete {heading} only</span>
          <span className="block text-sm text-gray-600 dark:text-gray-400">{stays}</span>
        </button>
        <button type="button" disabled={isPending} onClick={() => onConfirm('delete')}
          className="text-left rounded-lg border border-red-600 px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50">
          <span className="block text-sm font-semibold text-red-700 dark:text-red-400">Delete {heading} and {one ? 'its' : 'their'} {n} {n === 1 ? 'task' : 'tasks'}</span>
          <span className="block text-sm text-gray-600 dark:text-gray-400">{goes}</span>
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">Either choice can be undone from History (Ctrl+Z).</p>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
          Cancel
        </button>
      </div>
    </AccessibleModal>
  );
}
