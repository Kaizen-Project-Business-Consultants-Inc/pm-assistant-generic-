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
  ['start', 'startDate'],
  ['end', 'endDate'],
  ['dur', 'duration'],
  ['pct', 'progressPercentage'],
  ['priority', 'priority'],
  ['assigned', 'assignedTo'],
  ['resource', 'resource'],
  ['status', 'status'],
  ['notes', 'notes'],
];

/**
 * Gantt columns with no Table column. Est (estimated days) and Work (effort hours) have no
 * Table column yet, so the shared column picker can't switch them on; editIcon is the Gantt's
 * fixed row-actions column.
 */
export const GANTT_ONLY_KEYS: ReadonlySet<string> = new Set(['est', 'work', 'editIcon']);

/** Table columns with no Gantt column (CPM, baseline, cost, actual dates, constraints, WBS) */
export const TABLE_ONLY_KEYS: ReadonlySet<ColumnKey> = new Set<ColumnKey>([
  'actualStartDate', 'actualEndDate',
  'earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'totalFloat', 'freeFloat', 'critical',
  'constraintType', 'constraintDate',
  'baselineStart', 'baselineEnd', 'startVariance', 'endVariance', 'baselineDuration', 'baselineCost',
  'budgetAllocated', 'actualCost', 'budgetVariance',
  'wbs',
]);

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
