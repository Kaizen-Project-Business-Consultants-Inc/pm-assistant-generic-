import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { GanttTask } from '../../gantt/types';
import { planIndent, NOT_IN_PLAN_ORDER, type IndentDirection } from '../indentPlan';
import { useUnmountSafeTimeouts } from './useUnmountSafeTimeouts';

/** What the page is asked to save: the tasks, which way, the heading for an indent, and the Undo message */
export interface MoveTasksRequest { direction: IndentDirection; ids: string[]; underTaskId?: string; message: string }
/** Moves the tasks and shows `message` with Undo (the schedule page: useScheduleMutations.handleMoveUnder) */
export type MoveTasksUnder = (req: MoveTasksRequest) => Promise<void>;

const NOTICE_MS = 5000;

/**
 * Indent / outdent for the Gantt grid and the Table, from the keys or the right-click menu: works out
 * the move (planIndent), hands it to the page (one change, one Undo message), or, when there is
 * nothing to move, says why in `notice` (shown by <IndentNotice>) instead of staying silent.
 * `inPlanOrder` is false while the list is sorted or grouped: "the row above" is then not the plan's.
 */
export function useIndentTasks({ rowTasks, allTasks, onMoveTasks, inPlanOrder = true }: {
  rowTasks: GanttTask[];
  allTasks: GanttTask[];
  onMoveTasks?: MoveTasksUnder;
  inPlanOrder?: boolean;
}) {
  const later = useUnmountSafeTimeouts();
  const [notice, setNotice] = useState('');
  const say = useCallback((text: string) => {
    // cleared first, so the same words said twice are announced twice
    setNotice('');
    later(() => setNotice(text), 30);
    later(() => setNotice(n => (n === text ? '' : n)), NOTICE_MS);
  }, [later]);
  const move = useCallback((direction: IndentDirection, ids: string[]) => {
    if (!onMoveTasks) return;
    if (direction === 'indent' && !inPlanOrder) { say(NOT_IN_PLAN_ORDER); return; }
    const plan = planIndent(direction, ids, rowTasks, allTasks);
    if (plan.nothing) { say(plan.message); return; }
    setNotice('');
    // a save that fails is said by the page (and its Undo entry dropped); nothing more to do here
    onMoveTasks({
      direction, ids: plan.moves.map(m => m.id), message: plan.message,
      underTaskId: direction === 'indent' ? plan.moves[0].parentTaskId ?? undefined : undefined,
    }).catch(() => {});
  }, [rowTasks, allTasks, onMoveTasks, inPlanOrder, say]);
  return { move: onMoveTasks ? move : undefined, notice };
}

/**
 * "Nothing to outdent: …" — a polite status line, with an icon and text (not colour alone). The live
 * region stays on the page while the plan can be edited, so screen readers announce what is put in it.
 */
export function IndentNotice({ notice }: { notice: string }) {
  return (
    <div role="status" data-testid="indent-notice-region">
      {notice && (
        <div
          data-testid="indent-notice"
          className="flex items-center gap-2 px-3 py-1.5 text-xs border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100 rounded"
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
