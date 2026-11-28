import type { HeldTask } from '../services/ScheduleRecomputeService';

/**
 * What a re-flow did, in plain words for History lines and assistant replies: "2 tasks moved earlier",
 * "1 task moved later", "2 tasks moved earlier, 1 moved later" (a move of 0 days counts as later).
 */
export function movedWords(moves: Array<{ movedDays: number }>): string {
  const earlier = moves.filter(m => m.movedDays < 0).length;
  const later = moves.length - earlier;
  const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;
  if (earlier && later) return `${tasks(earlier)} moved earlier, ${later} moved later`;
  return earlier ? `${tasks(earlier)} moved earlier` : `${tasks(later)} moved later`;
}

/** "Build screens is completed, so it was not moved": one line for each task left in place */
export function heldNotes(held: HeldTask[] | undefined): string[] {
  return (held ?? []).map(h => `${h.name} ${h.reason}, so it was not moved`);
}

/** " · 2 tasks moved earlier · 1 task not moved" for the end of a History summary ('' when nothing moved and nothing was held) */
export function movedAndHeldWords(moved: Array<{ movedDays: number }>, held: HeldTask[] | undefined): string {
  return `${moved.length ? ` · ${movedWords(moved)}` : ''}${heldSuffix(held)}`;
}

/** " · 3 tasks not moved" for a History summary ('' when nothing was held) */
export function heldSuffix(held: HeldTask[] | undefined): string {
  const n = held?.length ?? 0;
  return n ? ` · ${n} task${n === 1 ? '' : 's'} not moved` : '';
}
