import type { GanttTask } from '../GanttChart';
import type { ColumnKey } from '../tableColumns';
import type { CellRaw } from '../../../utils/exportExcel';
import { cpmOffsetToDate, type WorkCalendar } from '../../../utils/workingDays';
import type { CpmTaskData, BaselineTaskVariance } from './types';

/** What the Table already worked out for its cells; the Excel export reads the same values */
interface TableExportContext {
  names: ReadonlyMap<string, string>;
  rowNumMap: ReadonlyMap<string, number>;
  wbsMap: ReadonlyMap<string, string>;
  successorMap: ReadonlyMap<string, Array<{ successorId: string; type: string; lag: number }>>;
  cpmMap: ReadonlyMap<string, CpmTaskData>;
  baselineMap: ReadonlyMap<string, BaselineTaskVariance>;
  cpmOrigin: string | null;
  workCalendar?: WorkCalendar | null;
  /** Dates already worked out for an offset: many tasks share one, and each lookup walks the calendar day by day */
  dateCache: Map<string, string | null>;
  /** The Predecessor cell's text (the Table's own getTaskFieldValue) */
  dependencyText: (task: GanttTask) => string;
  /** Working days between start and end, else the estimate (the Table's Duration cell) */
  durationDays: (task: GanttTask) => number | null;
}

type Extra = GanttTask & {
  actualStartDate?: string; actualEndDate?: string; baselineStartDate?: string; baselineFinishDate?: string;
  baselineDurationDays?: number; baselineCost?: number;
};

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/** The raw content of one cell, in the units the Excel export expects (see CellRaw) */
export function tableExportValue(task: GanttTask, key: ColumnKey, ctx: TableExportContext): CellRaw {
  const t = task as Extra;
  const cpm = ctx.cpmMap.get(task.id);
  const baseline = ctx.baselineMap.get(task.id);
  const cpmDate = (offset: number | undefined, kind: 'start' | 'finish') => {
    if (offset === undefined) return null;
    const duration = cpm?.duration ?? 1;
    const cacheKey = `${kind}|${offset}|${duration > 0}`; // a finish only depends on whether the task has length
    if (!ctx.dateCache.has(cacheKey)) ctx.dateCache.set(cacheKey, cpmOffsetToDate(ctx.cpmOrigin, offset, kind, duration, ctx.workCalendar));
    return ctx.dateCache.get(cacheKey) ?? null;
  };
  switch (key) {
    case 'rowNum': return ctx.rowNumMap.get(task.id);
    case 'priority': { const p = task.priority || 'medium'; return p.charAt(0).toUpperCase() + p.slice(1); }
    case 'startDate': return task.startDate;
    case 'endDate': return task.endDate;
    case 'progressPercentage': return task.progressPercentage ?? 0;
    case 'assignedTo': return (task.assignedTo && ctx.names.get(task.assignedTo)) || task.assignedTo || ''; // the name, as on screen
    case 'notes': return task.description;
    case 'duration': return ctx.durationDays(task);
    case 'estimatedDays': return task.estimatedDays;
    case 'estimatedDurationHours': return task.estimatedDurationHours;
    case 'dependency': return ctx.dependencyText(task);
    case 'successor':
      return (ctx.successorMap.get(task.id) ?? []).map(s => {
        const type = s.type.toUpperCase();
        return `${ctx.rowNumMap.get(s.successorId) ?? '?'}${type !== 'FS' ? type : ''}${s.lag !== 0 ? `${s.lag > 0 ? '+' : ''}${s.lag}d` : ''}`;
      }).join(',');
    case 'wbs': return ctx.wbsMap.get(task.id);
    case 'resource': return (task.assignments ?? []).map(a => ctx.names.get(a.resourceId) || a.resourceId).join(', ');
    case 'actualStartDate': return t.actualStartDate;
    case 'actualEndDate': return t.actualEndDate;
    case 'constraintType': return t.constraintType || 'ASAP';
    case 'constraintDate': return t.constraintDate;
    case 'earlyStart': return cpmDate(cpm?.ES, 'start');
    case 'earlyFinish': return cpmDate(cpm?.EF, 'finish');
    case 'lateStart': return cpmDate(cpm?.LS, 'start');
    case 'lateFinish': return cpmDate(cpm?.LF, 'finish');
    case 'totalFloat': return cpm?.totalFloat;
    case 'freeFloat': return cpm?.freeFloat;
    case 'critical': return cpm ? (cpm.isCritical ? 'Yes' : 'No') : null;
    case 'baselineStart': return t.baselineStartDate || baseline?.baselineStart;
    case 'baselineEnd': return t.baselineFinishDate || baseline?.baselineEnd;
    case 'startVariance': return baseline?.startVarianceDays;
    case 'endVariance': return baseline?.endVarianceDays;
    case 'baselineDuration': return num(t.baselineDurationDays);
    case 'baselineCost': return num(t.baselineCost);
    case 'budgetAllocated': return num(task.budgetAllocated);
    case 'actualCost': return num(task.actualCost);
    case 'budgetVariance':
      return task.budgetAllocated == null && task.actualCost == null ? null : (task.budgetAllocated ?? 0) - (task.actualCost ?? 0);
    default: return '';
  }
}
