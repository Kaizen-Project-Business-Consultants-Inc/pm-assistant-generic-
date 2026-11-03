import { useAuthStore } from '../../../stores/authStore';
import { canSeePayRates } from '../../../utils/rateCard';
import { cpmOffsetToDate, type WorkCalendar } from '../../../utils/workingDays';
import { buildWbsMap } from '../wbs';
import { formatDate, type CpmTaskData, type BaselineTaskVariance } from '../table/types';
import type { ColumnKey } from '../tableColumns';
import type { GanttTask } from './types';

/**
 * The Gantt grid's columns that used to exist only in the Table (actual dates, CPM dates, free
 * slack, critical, constraints, baseline, cost, WBS). They are off until ticked in the shared
 * Columns menu. The values and wording are the Table's: same data (critical path, baseline
 * comparison), same date format, a dash where the Table shows one.
 */

/** Money columns: hidden from roles the server sends no pay rates to (same rule as the people form) */
export const MONEY_COLUMN_KEYS: ReadonlySet<string> = new Set<ColumnKey>(['budgetAllocated', 'actualCost', 'budgetVariance', 'baselineCost']);

/** Does the signed-in person see the money columns? */
export function useSeesMoneyColumns(): boolean {
  return canSeePayRates(useAuthStore(s => s.user));
}

export interface ExtraColumnData {
  cpmData?: { tasks: CpmTaskData[]; hasLinks?: boolean };
  baselineData?: { taskVariances: BaselineTaskVariance[] };
}

/** Lookups the cells read, built once per data change (not per row) */
export interface ExtraColumnCtx {
  cpmByTask: ReadonlyMap<string, CpmTaskData>;
  baselineByTask: ReadonlyMap<string, BaselineTaskVariance>;
  wbsByTask: ReadonlyMap<string, string>;
  /** Critical-path offsets count working days from the earliest task start */
  cpmOrigin: string | null;
  workCalendar?: WorkCalendar | null;
}

export function buildExtraColumnCtx(
  data: ExtraColumnData, tasks: readonly GanttTask[], workCalendar?: WorkCalendar | null,
): ExtraColumnCtx {
  // A plan with no links has no critical path: its CPM columns stay blank (as in the Table)
  const cpmByTask = new Map<string, CpmTaskData>();
  if (data.cpmData?.tasks && data.cpmData.hasLinks !== false) for (const t of data.cpmData.tasks) cpmByTask.set(t.taskId, t);
  const baselineByTask = new Map<string, BaselineTaskVariance>();
  for (const t of data.baselineData?.taskVariances ?? []) baselineByTask.set(t.taskId, t);
  let cpmOrigin: string | null = null;
  for (const t of tasks) {
    const s = t.startDate?.slice(0, 10);
    if (s && (!cpmOrigin || s < cpmOrigin)) cpmOrigin = s;
  }
  return { cpmByTask, baselineByTask, wbsByTask: buildWbsMap(tasks), cpmOrigin, workCalendar };
}

interface ExtraCell {
  text: string;
  /** Colour: bad = red, good = green, muted = grey; none = the grid's normal grey */
  tone?: 'bad' | 'good' | 'muted';
  title?: string;
}

const DASH = '—';
const money = (n: number | null | undefined): string => (n != null ? `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : DASH);
const dayText = (d?: string | null): string => (d ? formatDate(d) : DASH);
const variance = (days: number | undefined | null): ExtraCell =>
  days == null ? { text: DASH } : { text: `${days > 0 ? '+' : ''}${days}d`, tone: days > 0 ? 'bad' : days < 0 ? 'good' : 'muted' };

type TaskWithExtras = GanttTask & {
  actualStartDate?: string; actualEndDate?: string;
  baselineStartDate?: string; baselineFinishDate?: string; baselineDurationDays?: number | string; baselineCost?: number | string;
};

function cpmDate(ctx: ExtraColumnCtx, cpm: CpmTaskData | undefined, offset: number | undefined, kind: 'start' | 'finish'): ExtraCell {
  if (offset === undefined) return { text: DASH };
  const date = ctx.cpmOrigin ? cpmOffsetToDate(ctx.cpmOrigin, offset, kind, kind === 'finish' ? (cpm?.duration ?? 1) : 1, ctx.workCalendar) : null;
  return { text: date ? formatDate(date) : `Day ${offset}` };
}

/** Critical-path columns (CPM dates, free slack, critical) */
function cpmCell(key: string, ctx: ExtraColumnCtx, cpm: CpmTaskData | undefined): ExtraCell | null {
  switch (key) {
    case 'earlyStart': return cpmDate(ctx, cpm, cpm?.ES, 'start');
    case 'earlyFinish': return cpmDate(ctx, cpm, cpm?.EF, 'finish');
    case 'lateStart': return cpmDate(ctx, cpm, cpm?.LS, 'start');
    case 'lateFinish': return cpmDate(ctx, cpm, cpm?.LF, 'finish');
    case 'freeFloat': return { text: cpm && cpm.freeFloat !== null ? `${cpm.freeFloat}d` : DASH };
    case 'critical': return cpm ? { text: cpm.isCritical ? 'Yes' : 'No', tone: cpm.isCritical ? 'bad' : 'muted' } : { text: DASH };
    default: return null;
  }
}

/** Budget, actual cost and the cost variance (the Table's colours: over budget red, under green) */
function costCell(key: string, t: TaskWithExtras): ExtraCell | null {
  switch (key) {
    case 'baselineCost': return { text: money(t.baselineCost != null ? Number(t.baselineCost) : null) };
    case 'budgetAllocated': return { text: money(t.budgetAllocated) };
    case 'actualCost': return { text: money(t.actualCost) };
    case 'budgetVariance': {
      if (t.budgetAllocated == null && t.actualCost == null) return { text: DASH, tone: 'muted' };
      const v = (t.budgetAllocated ?? 0) - (t.actualCost ?? 0);
      return { text: `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, tone: v < 0 ? 'bad' : v > 0 ? 'good' : 'muted' };
    }
    default: return null;
  }
}

/** The text (and colour) of one extra column's cell for a task; key is the Table's column key */
export function extraCell(key: string, task: GanttTask, ctx: ExtraColumnCtx): ExtraCell {
  const t = task as TaskWithExtras;
  const base = ctx.baselineByTask.get(task.id);
  const found = cpmCell(key, ctx, ctx.cpmByTask.get(task.id)) ?? costCell(key, t);
  if (found) return found;
  switch (key) {
    case 'actualStartDate': return { text: dayText(t.actualStartDate) };
    case 'actualEndDate': return { text: dayText(t.actualEndDate) };
    case 'constraintType': return { text: t.constraintType || 'ASAP' };
    case 'constraintDate': return { text: dayText(t.constraintDate) };
    case 'baselineStart': return { text: dayText(t.baselineStartDate || base?.baselineStart) };
    case 'baselineEnd': return { text: dayText(t.baselineFinishDate || base?.baselineEnd) };
    case 'startVariance': return variance(base?.startVarianceDays);
    case 'endVariance': return variance(base?.endVarianceDays);
    case 'baselineDuration': return { text: t.baselineDurationDays != null ? `${Number(t.baselineDurationDays)}d` : DASH };
    case 'wbs': return { text: ctx.wbsByTask.get(task.id) || DASH };
    default: return { text: '' };
  }
}
