import type { ColumnKey } from './tableColumns';

/**
 * Gantt grid column key ↔ Table column key. The Gantt shares the Table's column state on the
 * project schedule (visibility and order, saved per schedule), so every Gantt column that has
 * a Table counterpart must be listed here, both ways — a column missing from one direction had
 * its saved order or visibility ignored (Resource and Notes did, until 2026-10-06).
 *
 * The single list of pairs below is the source of truth; both lookups are built from it. A
 * column that exists on only one side is listed as such, and a guard test checks every column
 * of both views is in exactly one of these lists.
 */
export const GANTT_TABLE_KEY_PAIRS: ReadonlyArray<readonly [ganttKey: string, tableKey: ColumnKey]> = [
  ['rowNum', 'rowNum'],
  ['name', 'name'],
  ['pred', 'dependency'],
  ['succ', 'successor'],
  ['slack', 'totalFloat'],
  ['start', 'startDate'],
  ['end', 'endDate'],
  ['dur', 'duration'],
  ['est', 'estimatedDays'],
  ['work', 'estimatedDurationHours'],
  ['pct', 'progressPercentage'],
  ['priority', 'priority'],
  ['assigned', 'assignedTo'],
  ['resource', 'resource'],
  ['status', 'status'],
  ['notes', 'notes'],
  // Once Table-only; the Gantt grid has them too (gantt/extraColumns.ts), off until ticked
  ['actualStartDate', 'actualStartDate'],
  ['actualEndDate', 'actualEndDate'],
  ['earlyStart', 'earlyStart'],
  ['earlyFinish', 'earlyFinish'],
  ['lateStart', 'lateStart'],
  ['lateFinish', 'lateFinish'],
  ['freeFloat', 'freeFloat'],
  ['critical', 'critical'],
  ['constraintType', 'constraintType'],
  ['constraintDate', 'constraintDate'],
  ['baselineStart', 'baselineStart'],
  ['baselineEnd', 'baselineEnd'],
  ['startVariance', 'startVariance'],
  ['endVariance', 'endVariance'],
  ['baselineDuration', 'baselineDuration'],
  ['baselineCost', 'baselineCost'],
  ['budgetAllocated', 'budgetAllocated'],
  ['actualCost', 'actualCost'],
  ['budgetVariance', 'budgetVariance'],
  ['wbs', 'wbs'],
];

/**
 * Gantt columns with no Table column: only editIcon, the Gantt's fixed row-actions column.
 * (Est and Work were Gantt-only until 2026-10-06, so the shared column picker couldn't switch
 * them on in the project schedule; the Table now has Est Days and Work.)
 */
export const GANTT_ONLY_KEYS: ReadonlySet<string> = new Set(['editIcon']);

/** Table columns with no Gantt column: none since 2026-11-03 (the Gantt grid can show every Table column). Kept so the guard test stays meaningful if one is added to the Table first. */
export const TABLE_ONLY_KEYS: ReadonlySet<ColumnKey> = new Set<ColumnKey>();

export const GANTT_TO_TABLE_KEY: Readonly<Record<string, ColumnKey>> =
  Object.fromEntries(GANTT_TABLE_KEY_PAIRS.map(([g, t]) => [g, t]));

export const TABLE_TO_GANTT_KEY: Readonly<Record<string, string>> =
  Object.fromEntries(GANTT_TABLE_KEY_PAIRS.map(([g, t]) => [t, g]));

/**
 * The Table column order after the columns were dragged into a new order in the Gantt. The
 * Gantt only shows some of the Table's columns, so only their places change: each slot a
 * shared column held is filled, in turn, by the shared columns in their new Gantt order, and
 * Table-only columns stay exactly where they were. `currentOrder` is the saved Table order
 * (possibly partial or empty); `allTableKeys` is every Table column in its default order.
 */
export function mergeGanttOrderIntoTableOrder(
  currentOrder: readonly ColumnKey[],
  allTableKeys: readonly ColumnKey[],
  newGanttOrder: readonly string[],
): ColumnKey[] {
  // The order the Table actually shows: saved keys first, then the rest in default order
  const seen = new Set(currentOrder);
  const full: ColumnKey[] = [...currentOrder, ...allTableKeys.filter(k => !seen.has(k))];
  const movedShared = newGanttOrder
    .map(k => GANTT_TO_TABLE_KEY[k])
    .filter((k): k is ColumnKey => !!k);
  const movedSet = new Set(movedShared);
  let next = 0;
  const merged = full.map(k => (movedSet.has(k) ? movedShared[next++] : k));
  // rowNum always leads
  return ['rowNum', ...merged.filter(k => k !== 'rowNum')];
}
