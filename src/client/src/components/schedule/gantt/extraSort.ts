import type { GanttTask } from './types';
import type { ExtraColumnCtx } from './extraColumns';

/** Sort fields of the columns once found only in the Table (WBS does not sort, as in the Table) */
export const EXTRA_SORT_KEYS: readonly string[] = [
  'actualStartDate', 'actualEndDate', 'earlyStart', 'earlyFinish', 'lateStart', 'lateFinish', 'freeFloat', 'critical',
  'constraintType', 'constraintDate', 'baselineStart', 'baselineEnd', 'startVariance', 'endVariance',
  'baselineDuration', 'baselineCost', 'budgetAllocated', 'actualCost', 'budgetVariance',
];

type TaskWithExtras = GanttTask & {
  actualStartDate?: string; actualEndDate?: string;
  baselineStartDate?: string; baselineFinishDate?: string; baselineDurationDays?: number | string; baselineCost?: number | string;
};

const text = (s: string | undefined | null): string | null => s || null;
const num = (n: number | string | undefined | null): number | null => (n != null ? Number(n) : null);

/** What a Gantt row sorts by for one of those columns (null = blank, sorts last in both directions), as the Table sorts them */
export function extraSortValue(task: GanttTask, field: string, ctx: ExtraColumnCtx): string | number | null {
  const t = task as TaskWithExtras;
  const cpm = ctx.cpmByTask.get(task.id);
  const base = ctx.baselineByTask.get(task.id);
  switch (field) {
    case 'actualStartDate': return text(t.actualStartDate);
    case 'actualEndDate': return text(t.actualEndDate);
    case 'earlyStart': return cpm?.ES ?? null;
    case 'earlyFinish': return cpm?.EF ?? null;
    case 'lateStart': return cpm?.LS ?? null;
    case 'lateFinish': return cpm?.LF ?? null;
    case 'freeFloat': return cpm?.freeFloat ?? null;
    case 'critical': return cpm ? (cpm.isCritical ? 0 : 1) : null;
    case 'constraintType': return t.constraintType || 'ASAP';
    case 'constraintDate': return text(t.constraintDate);
    case 'baselineStart': return text(t.baselineStartDate || base?.baselineStart);
    case 'baselineEnd': return text(t.baselineFinishDate || base?.baselineEnd);
    case 'startVariance': return base?.startVarianceDays ?? null;
    case 'endVariance': return base?.endVarianceDays ?? null;
    case 'baselineDuration': return num(t.baselineDurationDays);
    case 'baselineCost': return num(t.baselineCost);
    case 'budgetAllocated': return num(t.budgetAllocated);
    case 'actualCost': return num(t.actualCost);
    case 'budgetVariance': return t.budgetAllocated == null && t.actualCost == null ? null : (t.budgetAllocated ?? 0) - (t.actualCost ?? 0);
    default: return '';
  }
}
