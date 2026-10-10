import { scheduleService, type Task, type CascadeResult, type CascadeChange } from './ScheduleService';
import { scheduleRecomputeService } from './ScheduleRecomputeService';
import { changeHistoryService } from './ChangeHistoryService';
import { taskRepository } from '../database/TaskRepository';
import { toDateString } from '../utils/calendarDate';
import { calendarDaysBetween } from '../utils/workingDays';

type Dated = Pick<Task, 'id' | 'name' | 'scheduleId' | 'startDate' | 'endDate'>;

/**
 * A task's dates were changed by hand (task form, Gantt, AI action, meeting action): the tasks that
 * follow it are pushed later where they now start too early. Same rules as every other re-flow
 * (ScheduleRecomputeService): only ever later, never pulled earlier; working-day lengths kept;
 * finished, started and must-start-on tasks stay; summaries roll up; each move audited. The edited
 * task keeps the dates it was given — unless the same edit gave it a new predecessor
 * (`followNewLinks`): then that predecessor may push it later too, in the same re-flow and the same
 * History entry (2026-10-10 review: a second re-flow moved it again, unrecorded).
 *
 * When anything moved, the whole change — the edited task's dates and the tasks pushed after it — is
 * one Schedule History entry, so Undo puts the plan back as it was.
 *
 * Replaces ScheduleService.cascadeReschedule (2026-10-09), which set every successor to start the day
 * after its predecessor: it pulled tasks earlier (closing gaps the PM left on purpose), moved finished
 * tasks, ignored date constraints and left no History entry.
 */
export async function moveSuccessorsAfter(
  before: Dated,
  after: Pick<Task, 'startDate' | 'endDate'> | null,
  opts: { followNewLinks?: boolean } = {},
): Promise<CascadeResult> {
  const oldStart = toDateString(before.startDate); const oldEnd = toDateString(before.endDate);
  const newStart = toDateString(after?.startDate); const newEnd = toDateString(after?.endDate);
  // how far the finish moved, in calendar days (the API's cascadedChanges.deltaDays, as before)
  const deltaDays = oldEnd && newEnd ? calendarDaysBetween(oldEnd, newEnd) : 0;
  const none: CascadeResult = { triggeredByTaskId: before.id, deltaDays, affectedTasks: [] };
  if (!after || (oldStart === newStart && oldEnd === newEnd)) return none;

  const { deltas } = await scheduleRecomputeService.recompute(before.scheduleId, {
    onlyFrom: [before.id], keep: opts.followNewLinks ? [] : [before.id], reason: 'task_moved',
  });
  if (deltas.length === 0) return none;
  // the edited task itself (pushed by a new predecessor) is put back to its dates from before the edit
  const others = deltas.filter(d => d.taskId !== before.id);

  const affectedTasks: CascadeChange[] = others.map(d => ({
    taskId: d.taskId,
    taskName: d.name,
    oldStartDate: d.oldStart ?? '',
    newStartDate: d.newStart,
    oldEndDate: d.oldEnd ?? '',
    newEndDate: d.newEnd,
    deltaDays: d.movedDays,
  }));

  await taskRepository.logActivities(affectedTasks.map(change => ({
    taskId: change.taskId, userId: '1', userName: 'System', action: 'auto-rescheduled', field: 'dates',
    oldValue: `${change.oldStartDate} - ${change.oldEndDate}`,
    newValue: `${change.newStartDate} - ${change.newEndDate}`,
  })));

  const schedule = await scheduleService.findById(before.scheduleId);
  if (schedule?.projectId) {
    await changeHistoryService.record({
      projectId: schedule.projectId,
      scheduleId: before.scheduleId,
      kind: 'successors_moved',
      summary: others.length
        ? `Re-dated ${before.name}; ${others.length} following task${others.length === 1 ? '' : 's'} pushed later`
        : `Re-dated ${before.name}; its new predecessor pushed it later`,
      taskIds: [before.id, ...others.map(d => d.taskId)],
      undo: {
        moved: [
          { taskId: before.id, startDate: oldStart, endDate: oldEnd },
          ...others.map(d => ({ taskId: d.taskId, startDate: d.oldStart, endDate: d.oldEnd })),
        ],
      },
    });
  }

  return { triggeredByTaskId: before.id, deltaDays, affectedTasks };
}
